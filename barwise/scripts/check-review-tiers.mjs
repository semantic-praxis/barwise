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
 * The same holds for REVIEW.md's "Always check" items and the table's
 * failureModes rows (docs/specs/review-routing.spec.md, WS2), so an
 * edit to a failure mode's title in REVIEW.md fails this gate until the
 * table follows.
 *
 * Three results, per docs/specs/gate-refusal-contract.spec.md:
 *   0  the table agrees with the checklist and with REVIEW.md
 *   1  they disagree, and the disagreement is named
 *   2  an input could not be read, so the question was never asked
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
 * So does a file-shaped glob whose name lives elsewhere unreached, unless
 * the row's `reachAcknowledged` lists exactly those paths under that file
 * name. The
 * instructions row's `CLAUDE.md` matched the root file and none of the
 * thirteen package copies, and the zero-match check could not see it
 * because one file matched (docs/specs/review-tier-reach.spec.md,
 * barwise-1046). A stale acknowledgement fails as well.
 *
 * `--checklist`, `--table`, `--review` and `--tracked` override the inputs. They exist for this
 * gate's own tests in scripts/tests/gates.test.mjs, which have to watch
 * each exit code on a planted defect and must not perturb the real
 * checklist to do it. Nothing else passes them.
 *
 * Spec: docs/specs/tiered-pr-review.spec.md (WS2, barwise-1037).
 */
import { readFileSync } from "node:fs";
import { opt } from "./lib/args.mjs";
import {
  CHECKLIST,
  checklistHeadings,
  compareTable,
  failureModeRows,
  matchesPattern,
  REVIEW,
  reviewFailureModes,
  shadowedPatterns,
  TABLE,
  tierRows,
  trivialGlobs,
} from "./lib/review-tiers.mjs";

let headings, rows, titles, modes, trivial, tracked, reach;
try {
  headings = checklistHeadings(opt("--checklist", CHECKLIST));
  rows = tierRows(opt("--table", TABLE));
  // Validated here, not only where the workflow reads it, so a broken
  // allow-list fails CI on the PR that breaks it -- rather than turning
  // every later workflow run into a refusal, which requests a review
  // (safe) but hides the cause in a job log nobody opens.
  trivial = trivialGlobs(opt("--table", TABLE));
  // REVIEW.md's "Always check" titles and the table's failureModes rows,
  // the same both-ways agreement as the checklist headings and the rows
  // (docs/specs/review-routing.spec.md, WS2). Unreadable or empty is
  // "cannot answer", never "every row is stale". Read after the rows and
  // the trivial list, so their refusals keep naming their own reason.
  titles = reviewFailureModes(opt("--review", REVIEW));
  modes = failureModeRows(opt("--table", TABLE));
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
  // Inside the try: a malformed reachAcknowledged is "cannot answer"
  // (exit 2). Validated by shadowedPatterns rather than tierRows, so
  // pr-risk, which never reads the field, cannot be made to refuse over it.
  const r = shadowedPatterns(rows, tracked, "row");
  const m = shadowedPatterns(modes, tracked, "failure mode");
  reach = { findings: [...r.findings, ...m.findings], stale: [...r.stale, ...m.stale] };
} catch (err) {
  console.error(`check:review-tiers: cannot answer -- ${err.message}`);
  if (err.cause) console.error(`  cause: ${err.cause.message}`);
  process.exit(2);
}

const { missing, stale, duplicated } = compareTable(headings, rows);
const fm = compareTable(titles, modes);
const live = (g) => tracked.some((f) => matchesPattern(f, g));
const dead = [
  ...[...rows, ...modes].flatMap((r) =>
    (r.globs ?? []).filter((g) => !live(g)).map((g) => `${r.heading}: ${g}`)
  ),
  ...trivial.filter((g) => !live(g)).map((g) => `trivial: ${g}`),
];
const problems = missing.length + stale.length + duplicated.length + dead.length
  + fm.missing.length + fm.stale.length + fm.duplicated.length
  + reach.findings.length + reach.stale.length;

if (problems > 0) {
  for (const h of missing) console.error(`  no row for checklist heading: ${h}`);
  for (const h of stale) console.error(`  row names a heading the checklist no longer has: ${h}`);
  for (const h of duplicated) console.error(`  heading declared by more than one row: ${h}`);
  for (const h of fm.missing) {
    console.error(`  no failureModes row for REVIEW.md failure mode: ${h}`);
  }
  for (const h of fm.stale) {
    console.error(`  failureModes row names a mode REVIEW.md no longer has: ${h}`);
  }
  for (const h of fm.duplicated) {
    console.error(`  failure mode declared by more than one row: ${h}`);
  }
  for (const d of dead) console.error(`  glob matches no tracked file: ${d}`);
  for (const f of reach.findings) {
    const what = f.acknowledged
      ? "same-named path(s) missing from its reachAcknowledged list"
      : "unreached same-named path(s), unacknowledged";
    console.error(
      `  shadowed: ${f.label}: ${f.name} (${f.patterns.join(", ")}) has `
        + `${f.unacknowledged.length} ${what}:`,
    );
    for (const p of f.unacknowledged) console.error(`    ${p}`);
  }
  for (const s of reach.stale) {
    if (s.paths === null) {
      console.error(`  stale reachAcknowledged key: ${s.label}: ${s.key} (${s.reason})`);
      continue;
    }
    console.error(`  stale reachAcknowledged path(s): ${s.label}: ${s.key}, no longer shadowed:`);
    for (const p of s.paths) console.error(`    ${p}`);
  }
  console.error(
    "\ncheck:review-tiers: barwise/review-tiers.json and the checklist disagree,\n"
      + "  or a glob in the table matches no tracked file, or a file-shaped glob\n"
      + "  leaves same-named files unreached that its row's reachAcknowledged does\n"
      + "  not list exactly (widen the row, or acknowledge the shadow).\n"
      + "  Every '## ' heading in .claude/skills/pr-review/checklist.md needs exactly\n"
      + "  one row. A trigger that is not path-shaped gets tier 'not-path-derivable'\n"
      + "  rather than a glob that cannot express it. Every numbered item under\n"
      + "  REVIEW.md's '## Always check' heading needs exactly one failureModes row.",
  );
  process.exit(1);
}

const byTier = rows.reduce((acc, r) => ({ ...acc, [r.tier]: (acc[r.tier] ?? 0) + 1 }), {});
const summary = Object.entries(byTier).sort().map(([t, n]) => `${n} ${t}`).join(", ");
console.log(
  `check:review-tiers: ${rows.length} headings, all with a row (${summary}); `
    + `${modes.length} REVIEW.md failure modes, all with a row; `
    + `${trivial.length} trivial pattern${trivial.length === 1 ? "" : "s"}. OK`,
);
