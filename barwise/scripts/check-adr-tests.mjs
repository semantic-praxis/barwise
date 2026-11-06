#!/usr/bin/env node
/**
 * A decision an ADR declares as `tests (<ids>)` is pinned by a test that
 * ran and passed in this CI run (docs/specs/executable-adrs.spec.md, WS2).
 *
 * The evidence is what the runners report, not what the source says: a test
 * carries `[adr:<adr>#<id>]` in its own title, vitest's json reporter and
 * scripts/lib/test-tag-reporter.mjs write every test that ran with its
 * status, and this check reads those reports. A skipped or todo test, a
 * test inside a skipped suite, a loop-built title and a tag quoted in a
 * fixture all settle themselves: none reaches a report as a passed test.
 * A skip is a test that could not answer, so a decision whose tagged tests
 * all skipped is a refusal, not a finding: the gitleaks probe tests skip in
 * a container without gitleaks, which cannot tell whether the decision
 * holds (docs/specs/enforceable-adr-practice.spec.md, WS1). A failed tagged
 * test is an answer, so with none passing it is a finding; one passing
 * test still proves the decision, and the failing one fails its own test
 * step. Vitest's `pending` (a test queued or cut short, never run) reads as
 * a skip.
 *
 * Findings, exit 1:
 *   - a `tests` entry lists an id with no passed tagged test and a failed
 *     one, or with none that passed or skipped, when every report was read (with
 *     one unread, that is a refusal);
 *   - a reported test or suite carries a tag naming an ADR that does not
 *     exist or an id that ADR does not have (a tag that outlived its
 *     decision). A tag on a suite never counts as a passed test; it is read
 *     only to be reported, so an author learns why the decision reads as
 *     untested (barwise-ym8.7jz, item 7).
 * Refusals, exit 2: a tested decision whose tagged tests all skipped (none
 * passed, none failed; a todo beside the skips does not change that), named
 * with the skipped titles; and a report this run should have written is missing or is
 * not the shape this check reads -- a vitest upgrade that renamed a field
 * must stop the check, not pass it. The expected reports are derived: one
 * per package with a `test:coverage` script, one per file in
 * scripts/tests/expected-counts.json, and the `test:trial` report.
 * Any finding is exit 1, with the refusals listed beside it.
 *
 * One passing tagged test proves a decision, so a decision held by a test on
 * each of two surfaces read as proven with one of them gone. A row of
 * docs/adr/tested-in.json names the files a decision rests on, and each
 * named file must hold a passed test carrying the tag, judged by the rule
 * above per file (docs/specs/capability-matrix-check.spec.md, WS2). The
 * reports name absolute paths, kept from the report's own directory on, so a
 * report turbo restored from another checkout still matches. Findings: a
 * named file with no passed tagged test (one failed, or none, every report
 * read), a row whose decision is not a `tests` entry, a path git does not
 * track. Refusals: a named file whose tagged tests all skipped, one with
 * none while a report is unread, and a tested-in.json that is missing,
 * not JSON, or not a list of `{ decision, files, why }` rows.
 *
 * It runs in CI after the test steps, on the same guard; on a docs-only
 * change no test ran, and an ADR change is not docs-only
 * (scripts/lib/changed-class.mjs).
 *
 * `--root <dir>` reads another tree, for this check's own tests.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readTestedIn, readTestReports } from "./lib/adr-facts.mjs";
import { judgeTestedDecisions, judgeTestedIn } from "./lib/adr-judge.mjs";
import { ADR_DIR, isAdr, readFiles, trackedPaths } from "./lib/architecture-section.mjs";
import { opt } from "./lib/args.mjs";

let root, adrs;
try {
  root = resolve(opt("--root") ?? join(dirname(fileURLToPath(import.meta.url)), "..", ".."));
  adrs = readFiles(root, trackedPaths(root).filter(isAdr));
  if (adrs.length === 0) throw new Error(`no ADR under ${join(root, ADR_DIR)}`);
} catch (err) {
  console.error(`check:adr-tests: cannot answer -- ${err.message}`);
  process.exit(2);
}

// Every report this run should have written, and the tests each says ran
// (scripts/lib/adr-facts.mjs); the judging is scripts/lib/adr-judge.mjs.
let reports;
try {
  reports = readTestReports(root);
} catch (err) {
  console.error(`check:adr-tests: cannot answer -- the list of reports: ${err.message}`);
  process.exit(2);
}
// The report refusals come first, and the judge appends its own after them.
const refusals = [...reports.refusals];
const unreadableReports = reports.unreadable;
const { findings, declaring, tested, skipOnly, unproven } = judgeTestedDecisions(
  adrs,
  reports,
  refusals,
);
// The per-file rows, after the decisions; an unreadable manifest is one
// refusal, and the decision rule above still answers.
const testedIn = readTestedIn(root, refusals);
const perFile = testedIn === null
  ? { findings: [], skipOnly: 0, unproven: 0 }
  : judgeTestedIn(adrs, reports, testedIn, refusals);
findings.push(...perFile.findings);
const files = testedIn === null ? 0 : testedIn.rows.reduce((n, row) => n + row.files.length, 0);

if (findings.length > 0) {
  console.error(`check:adr-tests: FAIL -- ${findings.length} finding(s):`);
  for (const f of findings) console.error(`  ${f}`);
}
if (refusals.length > 0) {
  console.error(
    `check:adr-tests: cannot answer -- ${unreadableReports} report(s) not read,`
      + ` ${unproven} decision(s) left unproven by them,`
      + ` ${skipOnly} decision(s) whose tagged tests all skipped,`
      + ` ${perFile.unproven} named file(s) left unproven by them,`
      + ` ${perFile.skipOnly} named file(s) whose tagged tests all skipped`
      + `${testedIn === null ? ", tested-in.json not read" : ""}:`,
  );
  for (const r of refusals) console.error(`  ${r}`);
}
if (findings.length > 0) process.exit(1);
if (refusals.length > 0) process.exit(2);
console.log(
  `check:adr-tests: ${tested} tested decision(s) across ${declaring} ADR(s) each have a`
    + ` passing tagged test, and so do the ${files} file(s) named by ${testedIn.rows.length}`
    + ` tested-in row(s), in ${reports.expected.length} report(s) of ${reports.ran.length} test(s). OK`,
);
