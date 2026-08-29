#!/usr/bin/env node
/**
 * Rubric discrimination audit (barwise-903).
 *
 * A rubric check is only a measurement if it can fail. This sweeps
 * every check in the suite, applies the mutation ITS OWN KIND is
 * about, and reports which checks survive -- a check that passes on an
 * answer key with the thing it asks about removed is banking a
 * guaranteed point rather than measuring anything.
 *
 * Three findings came out of the hand-run version of this on
 * 2026-08-29, at zero API cost: barwise-894 (16 forbids_population
 * checks passing because the candidate's own mandatories reject the
 * injection), barwise-901 (an ambiguity token matching an unrelated
 * ambiguity) and barwise-902 (must_validate with no reachable failure
 * path). It is a script rather than a note because the audit that
 * found them was a throwaway, and the next rubric edit could
 * reintroduce all three with nothing to notice.
 *
 * `--check` ratchets against rubric-baseline.json and fails BOTH ways,
 * like `audit:duplication`: on a non-discriminating check missing from
 * the baseline, and on a baseline entry that now discriminates. The
 * second half is what makes fixing one force the row out, so the file
 * always enumerates exactly the open findings.
 *
 * WHAT THIS DOES NOT PROVE. Discrimination is existential -- some
 * mutation makes the check fail -- so it catches a check that cannot
 * fail, never one that fails for the wrong reason. barwise-894 is
 * visible here only because its checks pass with their whole
 * constraint class deleted; a subtler wrong-reason pass would not be.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

// Dynamic import of the built dist by path, matching regen-references.mjs.
// A bare specifier would make this root script depend on a workspace
// package, which knip correctly refuses.
let promptlab;
try {
  promptlab = await import(resolve(ROOT, "packages/promptlab/dist/index.js"));
} catch {
  console.error("error: packages/promptlab/dist not found; run 'npm run build' first");
  process.exit(1);
}
const { defaultSuitePath, loadSuite, scoreExtraction } = promptlab;
const KEYS = resolve(ROOT, "packages/promptlab/tests/fixtures/responses");
const BASELINE = resolve(ROOT, "rubric-baseline.json");

/**
 * A check's declared `constraint` is a `ConstraintKind`; a payload
 * constraint carries a wire `type`. They are not the same vocabulary,
 * and the two mandatory forms both answer to one kind.
 */
const CONSTRAINT_WIRE = {
  internal_uniqueness: ["internal_uniqueness"],
  mandatory: ["mandatory", "disjunctive_mandatory"],
  value: ["value_constraint"],
  frequency: ["frequency"],
  ring: ["ring"],
};

const clone = (o) => JSON.parse(JSON.stringify(o));

/**
 * Stable across reordering, and deliberately NOT stable across a change
 * to what the check asks: the message is derived from the check's own
 * configuration, so re-keying a check forces it back through review.
 */
function checkId(caseId, kind, message) {
  const h = createHash("sha1").update(message).digest("hex").slice(0, 12);
  return `${caseId}::${kind}::${h}`;
}

/** The mutations each kind must not survive, as payload variants. */
function mutationsFor(kind, check, key) {
  const out = [];
  if (kind === "must_validate") {
    // No single element is "the" subject, so the battery is structural
    // corruption of every degree, ending at nothing at all.
    const stripped = clone(key);
    stripped.object_types = [];
    stripped.fact_types = [];
    out.push(stripped, {}, { object_types: "not an array" });
  } else if (kind === "requires_element") {
    for (const field of ["object_types", "fact_types"]) {
      for (let i = 0; i < (key[field]?.length ?? 0); i += 1) {
        const m = clone(key);
        m[field].splice(i, 1);
        out.push(m);
      }
    }
  } else if (kind === "requires_ambiguity") {
    for (let i = 0; i < (key.ambiguities?.length ?? 0); i += 1) {
      const m = clone(key);
      m.ambiguities.splice(i, 1);
      out.push(m);
    }
  } else if (kind === "forbids_population") {
    // Delete the whole class of constraint the check names. Deleting
    // ONE is not enough: it reports redundancy as blindness, which is
    // the false conclusion the hand audit nearly published (30 checks
    // looked vacuous under single deletion; 16 are).
    const wire = CONSTRAINT_WIRE[check.constraint] ?? [];
    const m = clone(key);
    m.inferred_constraints = (m.inferred_constraints ?? []).filter(
      (c) => !wire.includes(c.type),
    );
    out.push(m);
  }
  return out;
}

function audit() {
  const suite = loadSuite(defaultSuitePath());
  const rows = [];
  for (const loaded of suite.cases) {
    const caseId = loaded.evalCase.id;
    const key = JSON.parse(
      readFileSync(resolve(KEYS, `${caseId}.json`), "utf8"),
    );
    const base = scoreExtraction(JSON.stringify(key), loaded, suite.weights);
    const checks = loaded.evalCase.checks;
    if (base.results.length !== checks.length) {
      throw new Error(
        `${caseId}: ${checks.length} checks but ${base.results.length} results; `
          + "the index pairing this audit relies on no longer holds.",
      );
    }
    for (const [i, res] of base.results.entries()) {
      const check = checks[i];
      if (res.kind !== check.kind) {
        throw new Error(
          `${caseId} check ${i}: rubric says ${check.kind}, result says ${res.kind}.`,
        );
      }
      // A check already failing on its own answer key is a different
      // defect, and not one this audit is entitled to call vacuous.
      if (!res.passed) {
        rows.push({
          id: checkId(caseId, res.kind, res.message),
          caseId,
          kind: res.kind,
          message: res.message,
          status: "fails-on-key",
        });
        continue;
      }
      let discriminates = false;
      for (const mutant of mutationsFor(res.kind, check, key)) {
        let s;
        try {
          s = scoreExtraction(JSON.stringify(mutant), loaded, suite.weights);
        } catch {
          continue;
        }
        if (s.results.length !== checks.length) continue;
        if (!s.results[i].passed) {
          discriminates = true;
          break;
        }
      }
      rows.push({
        id: checkId(caseId, res.kind, res.message),
        caseId,
        kind: res.kind,
        message: res.message,
        status: discriminates ? "discriminates" : "no-reachable-failure",
      });
    }
  }
  return rows;
}

function main() {
  const rows = audit();
  const open = rows.filter((r) => r.status !== "discriminates");
  const mode = process.argv[2];

  if (mode === "--write-baseline") {
    const entries = {};
    for (const r of open) {
      entries[r.id] = {
        case: r.caseId,
        kind: r.kind,
        message: r.message.slice(0, 120),
        verdict: "TODO",
      };
    }
    writeFileSync(
      BASELINE,
      JSON.stringify({ $comment: BASELINE_COMMENT, checks: entries }, null, 2) + "\n",
    );
    console.log(`wrote ${Object.keys(entries).length} entries; set each verdict`);
    return;
  }

  const byKind = {};
  for (const r of rows) {
    byKind[r.kind] ??= { n: 0, ok: 0 };
    byKind[r.kind].n += 1;
    if (r.status === "discriminates") byKind[r.kind].ok += 1;
  }
  for (const [k, v] of Object.entries(byKind)) {
    console.log(
      `${k.padEnd(20)} ${String(v.ok).padStart(3)}/${String(v.n).padEnd(3)} discriminate`,
    );
  }
  console.log(`${"TOTAL".padEnd(20)} ${rows.length - open.length}/${rows.length}`);

  if (mode !== "--check") {
    for (const r of open) console.log(`  ${r.status}  ${r.id}  ${r.message.slice(0, 90)}`);
    return;
  }

  const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
  const known = baseline.checks ?? {};
  const problems = [];
  for (const r of open) {
    if (!(r.id in known)) {
      problems.push(
        `NEW non-discriminating check, not in the baseline:\n`
          + `    ${r.id}\n    ${r.kind} on ${r.caseId}: ${r.message.slice(0, 100)}\n`
          + `    Either fix the check, or add it with a verdict saying why it stays.`,
      );
    }
  }
  const openIds = new Set(open.map((r) => r.id));
  for (const id of Object.keys(known)) {
    if (!openIds.has(id)) {
      problems.push(
        `Baseline entry no longer detected: ${id}\n`
          + `    It discriminates now, so remove the row (and close its issue).`,
      );
    }
  }
  if (problems.length > 0) {
    console.error("\nrubric audit failed:\n\n" + problems.join("\n\n") + "\n");
    process.exit(1);
  }
  console.log("\nrubric audit: baseline matches.");
}

const BASELINE_COMMENT =
  "Rubric checks with no reachable failure path, from scripts/audit-rubric.mjs "
  + "(npm run audit:rubric -- --check; CI runs it). A check that passes on an answer "
  + "key with the thing it asks about removed banks a guaranteed point instead of "
  + "measuring. Every entry carries a verdict: tracked:<issue> for an open finding, "
  + "or accepted-benign with the reason. --check fails on a check missing here AND on "
  + "an entry that now discriminates, so fixing one forces its row out and the file "
  + "always enumerates exactly the open findings. Method: docs/prompt-optimization-log.md.";

main();
