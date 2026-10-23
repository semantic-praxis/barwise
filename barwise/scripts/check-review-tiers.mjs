#!/usr/bin/env node
/**
 * The tier table and the checklist headings must agree, both ways.
 *
 * `review-tiers.json` is a declared copy of checklist.md's trigger
 * headings. CLAUDE.md allows a copy that is registered and checked, and
 * this is the check: it fails on a heading with no row (a new trigger
 * the classifier would silently never fire on) AND on a row naming a
 * heading that no longer exists (a tier decision applying to nothing).
 * `check:root-scripts` fails both ways for the same reason -- a stale
 * entry and a missing one are different defects and both are silent.
 *
 * Three results, per docs/specs/gate-refusal-contract.spec.md:
 *   0  the two agree
 *   1  they disagree, and the disagreement is named
 *   2  one of them could not be read, so the question was never asked
 *
 * Exit 2 matters here more than usual. If this gate treated an
 * unreadable checklist as "no headings", it would report that every row
 * is stale -- a confident wrong answer about thirteen rows, from a file
 * it never opened.
 *
 * A glob that matches no tracked file fails too. It passes every other
 * check here and routes nothing, forever: the "When generated output
 * changed" row named `llm/src/prompts/builtins.generated.ts` from
 * 2026-09-18 while the file lived under `prompt/artifacts/`, and nothing
 * said so (barwise-fs0).
 *
 * `--checklist`, `--table` and `--tracked` override the inputs. They exist for this
 * gate's own tests in scripts/tests/gates.test.mjs, which have to watch
 * each exit code on a planted defect and must not perturb the real
 * checklist to do it. Nothing else passes them.
 *
 * Spec: docs/specs/tiered-pr-review.spec.md (WS2, barwise-1037).
 */
import { readFileSync } from "node:fs";
import {
  CHECKLIST,
  checklistHeadings,
  compareTable,
  matchesPattern,
  TABLE,
  tierRows,
  trivialGlobs,
} from "./lib/review-tiers.mjs";

/** `--flag value`, or the default. No dependency, and no partial matching. */
function opt(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

let headings, rows, trivial, tracked;
try {
  headings = checklistHeadings(opt("--checklist", CHECKLIST));
  rows = tierRows(opt("--table", TABLE));
  // Validated here, not only where the workflow reads it, so a broken
  // allow-list fails CI on the PR that breaks it -- rather than turning
  // every later workflow run into a refusal, which requests a review
  // (safe) but hides the cause in a job log nobody opens.
  trivial = trivialGlobs(opt("--table", TABLE));
  // Imported only when no list is given: lib/tracked.mjs resolves the
  // repository root at import, and refuses (exit 2) outside one, which is
  // where this gate's own fixtures run.
  const list = opt("--tracked", null);
  tracked = list
    ? readFileSync(list, "utf8").split("\n").filter(Boolean)
    : (await import("./lib/tracked.mjs")).trackedFiles();
  // An empty listing would make every glob read as dead: a confident
  // failure about every row, from a list that answered nothing.
  if (tracked.length === 0) throw new Error("the tracked-file list is empty");
} catch (err) {
  console.error(`check:review-tiers: cannot answer -- ${err.message}`);
  if (err.cause) console.error(`  cause: ${err.cause.message}`);
  process.exit(2);
}

const { missing, stale, duplicated } = compareTable(headings, rows);
const live = (g) => tracked.some((f) => matchesPattern(f, g));
const dead = [
  ...rows.flatMap((r) => (r.globs ?? []).filter((g) => !live(g)).map((g) => `${r.heading}: ${g}`)),
  ...trivial.filter((g) => !live(g)).map((g) => `trivial: ${g}`),
];

if (missing.length > 0 || stale.length > 0 || duplicated.length > 0 || dead.length > 0) {
  for (const h of missing) console.error(`  no row for checklist heading: ${h}`);
  for (const h of stale) console.error(`  row names a heading the checklist no longer has: ${h}`);
  for (const h of duplicated) console.error(`  heading declared by more than one row: ${h}`);
  for (const d of dead) console.error(`  glob matches no tracked file: ${d}`);
  console.error(
    "\ncheck:review-tiers: barwise/review-tiers.json and the checklist disagree,\n"
      + "  or a glob in the table matches no tracked file.\n"
      + "  Every '## ' heading in .claude/skills/pr-review/checklist.md needs exactly\n"
      + "  one row. A trigger that is not path-shaped gets tier 'not-path-derivable'\n"
      + "  rather than a glob that cannot express it.",
  );
  process.exit(1);
}

const byTier = rows.reduce((acc, r) => ({ ...acc, [r.tier]: (acc[r.tier] ?? 0) + 1 }), {});
const summary = Object.entries(byTier).sort().map(([t, n]) => `${n} ${t}`).join(", ");
console.log(
  `check:review-tiers: ${rows.length} headings, all with a row (${summary}); `
    + `${trivial.length} trivial pattern${trivial.length === 1 ? "" : "s"}. OK`,
);
