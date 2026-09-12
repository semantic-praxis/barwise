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
import { classify, loadCatalog } from "./classify.mjs";
import { BASELINE_PATH, resultsPath } from "./paths.mjs";

export const keyOf = (r) => `${r.customer}/${r.tier}/${r.sprint}/${r.step}`;

export function evaluateGate(results, baseline) {
  const failing = results.filter((r) => r.status === "fail" && r.severity !== "authoring");
  const ranKeys = new Set(results.map(keyOf));
  const rows = baseline.findings ?? {};
  const fresh = failing.filter((r) => !rows[keyOf(r)]);
  const stale = Object.keys(rows).filter((k) =>
    ranKeys.has(k) && !failing.some((r) => keyOf(r) === k)
  );
  const unclassified = Object.entries(rows).filter(([, v]) =>
    !v.note || /^\(unclassified\)/.test(v.note)
  ).map(([k]) => k);
  const authoring = results.filter((r) => r.severity === "authoring");
  return { failing, fresh, stale, unclassified, authoring };
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
  if (write && v.fresh.length) {
    baseline.findings = baseline.findings ?? {};
    const classes = loadCatalog();
    let classified = 0;
    for (const r of v.fresh) {
      const c = classify(r, classes);
      if (c) classified++;
      baseline.findings[keyOf(r)] = c
        ? {
          severity: r.severity,
          class: c.id,
          issue: c.issue,
          note: c.note,
          detail: String(r.detail).slice(0, 300),
        }
        : {
          severity: r.severity,
          detail: String(r.detail).slice(0, 300),
          note:
            "(unclassified) add a class to trial/findings/catalog.json or fix it and remove the row",
          issue: null,
        };
    }
    console.log(
      `trial gate: ${classified} of ${v.fresh.length} new row(s) matched a catalog class`,
    );
    writeFileSync(BASELINE_PATH, JSON.stringify(sortKeys(baseline), null, 2) + "\n");
    console.log(`trial gate: wrote ${v.fresh.length} row(s) to ${BASELINE_PATH}`);
  }
  let code = 0;
  for (const r of v.fresh) {
    console.log(`NEW FINDING  ${keyOf(r)}  ${r.severity}: ${r.detail}`);
    code = 1;
  }
  for (const k of v.stale) {
    console.log(`STALE ROW    ${k}  no longer fails; remove it from trial-baseline.json`);
    code = 1;
  }
  for (const k of v.unclassified) {
    if (write && v.fresh.some((r) => keyOf(r) === k)) continue;
    console.log(`UNCLASSIFIED ${k}  baseline row has no note`);
    code = 1;
  }
  for (const r of v.authoring) console.log(`AUTHORING    ${keyOf(r)}  ${r.detail}`);
  const open = Object.keys(baseline.findings ?? {}).length;
  console.log(
    `trial gate (${tier}): ${results.length} steps, ${v.failing.length} failing, ${v.fresh.length} new, ${v.stale.length} stale, ${open} open in baseline -> ${
      code === 0 ? "PASS" : "FAIL"
    }`,
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
