/**
 * Where each test runner writes the test-by-test report `check:adr-tests`
 * reads (docs/specs/executable-adrs.spec.md, WS2). One owner for the paths,
 * so the writers and the reader cannot disagree about where a report is.
 * The `test:trial` script in barwise/package.json names TRIAL_REPORT in its
 * command line; check-adr-tests.test.mjs holds the two to one answer.
 *
 * Every path here is gitignored (`test-results/`).
 */
import { join } from "node:path";

/** `node --test` reports for barwise/scripts/tests/<file>, one per file. */
export const SCRIPT_REPORTS_DIR = join("barwise", "test-results", "script-tests");

/** The `test:trial` report, relative to the repository root. */
export const TRIAL_REPORT = join("barwise", "test-results", "trial.jsonl");

/** A package's vitest json report, relative to the repository root. */
export const vitestReport = (pkgDir) =>
  join("barwise", "packages", pkgDir, "test-results", "vitest.json");

/** The report for one script-test file, e.g. `gates.test.mjs`. */
export const scriptReport = (file) => join(SCRIPT_REPORTS_DIR, file.replace(/\.mjs$/, ".jsonl"));

/**
 * The report that would hold a test file, by repository path, or `null`
 * for a path no runner reports: so a named file's verdict waits only on
 * its own report being read, not on every report.
 */
export function reportFor(file) {
  const pkg = /^barwise\/packages\/([^/]+)\//.exec(file);
  if (pkg) return vitestReport(pkg[1]);
  const script = /^barwise\/scripts\/tests\/(.+)$/.exec(file);
  if (script) return scriptReport(script[1]);
  if (file.startsWith("barwise/trial/tests/")) return TRIAL_REPORT;
  return null;
}
