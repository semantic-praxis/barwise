/**
 * The ratchet. Every failing step in the latest results must be
 * classified by a row in trial-baseline.json, and every baseline row
 * that was re-run must still fail, so the baseline enumerates exactly
 * what is open. Same shape as audit-duplication, audit-rubric and
 * audit-spec-status; same three-way exit.
 *
 *   node trial/lib/gate.mjs [--tier small] [--write]
 *
 * `--write` appends the unclassified findings as rows marked
 * "(unclassified)" so an operator can fill in the note and the issue;
 * the gate keeps failing until every row carries a real note, which is
 * what makes a written row a classification rather than a snooze.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { classify, loadCatalog } from "./classify.mjs";
import { BASELINE_PATH, FINDINGS_DIR, resultsPath } from "./paths.mjs";

export const keyOf = (r) => `${r.customer}/${r.tier}/${r.sprint}/${r.step}`;

/**
 * A could_not_answer step is an open item exactly as a failing one is.
 * The first version of this gate counted only `fail` rows, so every step
 * the lane could not grade was dropped on the floor and the run still
 * printed PASS -- including the oracles taught to refuse unreadable
 * input, whose refusals then certified nothing. Each blind spot now
 * needs a baseline row saying why it cannot be answered, and a new one
 * is loud.
 *
 * `hasReproduction` is injected so the pure evaluation can be tested
 * without a findings directory on disk.
 */
export function evaluateGate(results, baseline, {
  hasReproduction = (issue) => existsSync(join(FINDINGS_DIR, issue)),
  catalog = loadCatalog(),
} = {}) {
  const failing = results.filter((r) => r.status === "fail" && r.severity !== "authoring");
  const blind = results.filter((r) => r.status === "could_not_answer");
  const open = new Set([...failing, ...blind].map(keyOf));
  const ranKeys = new Set(results.map(keyOf));
  const rows = baseline.findings ?? {};
  const fresh = failing.filter((r) => !rows[keyOf(r)]);
  const freshBlind = blind.filter((r) => !rows[keyOf(r)]);
  const stale = Object.keys(rows).filter((k) => ranKeys.has(k) && !open.has(k));
  // The README's contract for a classified row is a note, an issue, and a
  // reproduction under findings/<issue>/. Only the note used to be
  // checked, so a row with `issue: null`, or an issue with nothing to
  // reproduce it, passed. A blind-spot row needs the note and the issue;
  // there is no defect to reproduce, so it needs no directory.
  const unclassified = Object.entries(rows).filter(([, v]) =>
    !v.note || /^\(unclassified\)/.test(v.note) || !v.issue
  ).map(([k]) => k);
  // Whether a row is a blind spot is decided by what the step did THIS
  // run, not by what the baseline recorded: a known could_not_answer row
  // whose step starts failing is a definite finding, and exempting it from
  // the reproduction rule on the strength of its old status let it pass
  // under the blind-spot issue. The transition itself is reported too.
  const current = new Map(results.map((r) => [keyOf(r), r]));
  const blindNow = (k, v) => (current.get(k)?.status ?? v.status) === "could_not_answer";
  const unreproduced = Object.entries(rows).filter(([k, v]) =>
    v.issue && !blindNow(k, v) && !unclassified.includes(k)
    && !hasReproduction(v.issue)
  ).map(([k, v]) => ({ key: k, issue: v.issue }));
  const changed = Object.entries(rows).flatMap(([k, v]) => {
    const now = current.get(k)?.status;
    const was = v.status === "could_not_answer" ? "could_not_answer" : "fail";
    return now && now !== "pass" && now !== "refused" && now !== was ? [{ key: k, was, now }] : [];
  });
  // A baseline row the results never mention is invisible to `stale`,
  // which only compares rows that ran, so a step that stopped being
  // emitted took its open finding with it and the gate passed. Scoped by
  // customer, tier and sprint: when that scope ran and the step did not,
  // the row VANISHED (definite); when the scope never ran -- a partial
  // results file -- the gate cannot vouch for the row (could not answer).
  const tiers = new Set(results.map((r) => r.tier));
  const ranScopes = new Set(results.map((r) => `${r.customer}/${r.tier}/${r.sprint}`));
  const vanished = [];
  const unrun = [];
  for (const k of Object.keys(rows)) {
    const [customer, tier, sprint] = k.split("/");
    if (!tiers.has(tier) || ranKeys.has(k)) continue;
    (ranScopes.has(`${customer}/${tier}/${sprint}`) ? vanished : unrun).push(k);
  }
  // A row names the catalog class that classified it, and carries that
  // class's issue. The two are copies that must agree, and nothing checked
  // them: retiring barwise-lh9 deleted its classes while eight rows still
  // named them, and the gate printed PASS because it compares only keys
  // and statuses (PR #572 review). A class the catalog no longer has, or
  // an issue the class does not carry, is a stale classification.
  // Agreeing with each other is not enough: the row must also still be
  // what the catalog makes of THIS run's result. A step whose importer or
  // detail changed can match another class first while the row keeps the
  // old class and its old issue, internally consistent and wrong (PR #572
  // second review). Only a row that ran is re-classified; one that did
  // not has no current result to classify.
  const classById = new Map(catalog.map((c) => [c.id, c]));
  const misclassified = Object.entries(rows).flatMap(([k, v]) => {
    if (!v.class) return [];
    const c = classById.get(v.class);
    if (!c) return [{ key: k, why: `class ${v.class} is not in the catalog` }];
    if (c.issue !== v.issue) {
      return [{ key: k, why: `class ${v.class} carries ${c.issue}, the row says ${v.issue}` }];
    }
    const now = current.get(k);
    if (now && open.has(k)) {
      const fits = classify(now, catalog)?.id ?? null;
      if (fits !== v.class) {
        return [{
          key: k,
          why: `this run classifies as ${fits ?? "no class"}, the row says ${v.class}`,
        }];
      }
    }
    return [];
  });
  const authoring = results.filter((r) => r.severity === "authoring");
  return {
    misclassified,
    failing,
    blind,
    fresh,
    freshBlind,
    stale,
    unclassified,
    unreproduced,
    changed,
    vanished,
    unrun,
    authoring,
  };
}

export function runGate({ tier = "small", write = false } = {}) {
  const path = resultsPath(tier);
  if (!existsSync(path)) {
    console.error(`trial gate: no results for tier ${tier} at ${path}; run trial:offline first`);
    return 2;
  }
  const { results } = JSON.parse(readFileSync(path, "utf8"));
  if (!results?.length) {
    console.error(`trial gate: results file for tier ${tier} is empty; the run recorded nothing`);
    return 2;
  }
  const baseline = existsSync(BASELINE_PATH)
    ? JSON.parse(readFileSync(BASELINE_PATH, "utf8"))
    : { findings: {} };
  const v = evaluateGate(results, baseline);
  const toWrite = [...v.fresh, ...v.freshBlind];
  if (write && toWrite.length) {
    baseline.findings = baseline.findings ?? {};
    const classes = loadCatalog();
    let classified = 0;
    for (const r of toWrite) {
      const c = classify(r, classes);
      if (c) classified++;
      // A blind-spot row carries its status, which is how the gate knows
      // it needs no reproduction under findings/<issue>/.
      const kind = r.status === "could_not_answer"
        ? { status: "could_not_answer" }
        : { severity: r.severity };
      baseline.findings[keyOf(r)] = c
        ? {
          ...kind,
          class: c.id,
          issue: c.issue,
          note: c.note,
          detail: String(r.detail).slice(0, 300),
        }
        : {
          ...kind,
          detail: String(r.detail).slice(0, 300),
          note:
            "(unclassified) add a class to trial/findings/catalog.json or fix it and remove the row",
          issue: null,
        };
    }
    console.log(
      `trial gate: ${classified} of ${toWrite.length} new row(s) matched a catalog class`,
    );
    writeFileSync(BASELINE_PATH, JSON.stringify(sortKeys(baseline), null, 2) + "\n");
    console.log(`trial gate: wrote ${toWrite.length} row(s) to ${BASELINE_PATH}`);
  }
  // A found regression is a definite answer and the most actionable one,
  // so it outranks "could not answer": exit 1 wins over exit 2. The first
  // version let an authoring row override it, which reported a run that
  // HAD found a regression as merely unable to answer.
  let definite = false;
  let blindSpot = false;
  const justWritten = (k) => write && [...v.fresh, ...v.freshBlind].some((r) => keyOf(r) === k);
  for (const r of v.fresh) {
    console.log(`NEW FINDING  ${keyOf(r)}  ${r.severity}: ${r.detail}`);
    definite = true;
  }
  for (const k of v.stale) {
    console.log(`STALE ROW    ${k}  no longer open; remove it from trial-baseline.json`);
    definite = true;
  }
  for (const k of v.unclassified) {
    if (justWritten(k)) continue;
    console.log(`UNCLASSIFIED ${k}  baseline row needs a note and an issue`);
    definite = true;
  }
  for (const { key, issue } of v.unreproduced) {
    console.log(`NO REPRO     ${key}  nothing under findings/${issue}/ reproduces it`);
    definite = true;
  }
  for (const { key, why } of v.misclassified) {
    console.log(`MISCLASSIFIED ${key}  ${why}; reclassify the row`);
    definite = true;
  }
  for (const { key, was, now } of v.changed) {
    console.log(`CHANGED      ${key}  baseline says ${was}, this run ${now}; reclassify the row`);
    if (now === "fail") definite = true;
    else blindSpot = true;
  }
  for (const k of v.vanished) {
    console.log(`VANISHED     ${k}  its sprint ran but the step was not emitted`);
    definite = true;
  }
  if (v.unrun.length) {
    console.log(
      `NOT RUN      ${v.unrun.length} baseline row(s) in customer/sprint scopes these results never ran (a partial run?)`,
    );
    blindSpot = true;
  }
  for (const r of v.freshBlind) {
    console.log(`NEW BLIND    ${keyOf(r)}  could not answer: ${r.detail}`);
    blindSpot = true;
  }
  for (const r of v.authoring) {
    console.log(`AUTHORING    ${keyOf(r)}  ${r.detail}`);
    blindSpot = true;
  }
  const code = definite ? 1 : blindSpot ? 2 : 0;
  const open = Object.keys(baseline.findings ?? {}).length;
  console.log(
    `trial gate (${tier}): ${results.length} steps, ${v.failing.length} failing, ${v.blind.length} could not answer, ${
      v.fresh.length + v.freshBlind.length
    } new, ${v.stale.length} stale, ${open} open in baseline${
      v.authoring.length ? `, ${v.authoring.length} authoring` : ""
    } -> ${code === 0 ? "PASS" : code === 2 ? "COULD NOT ANSWER" : "FAIL"}`,
  );
  return code;
}

function sortKeys(baseline) {
  const sorted = {};
  for (const k of Object.keys(baseline.findings ?? {}).sort()) sorted[k] = baseline.findings[k];
  return { ...baseline, findings: sorted };
}

if (process.argv[1] && process.argv[1].endsWith("gate.mjs")) {
  const tierIdx = process.argv.indexOf("--tier");
  const tier = tierIdx === -1 ? "small" : process.argv[tierIdx + 1];
  process.exit(runGate({ tier, write: process.argv.includes("--write") }));
}
