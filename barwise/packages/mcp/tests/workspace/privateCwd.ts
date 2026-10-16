/**
 * A private working directory for every test in the file that calls this.
 *
 * Three tools fall back to `process.cwd()` for an inline source: the lineage
 * manifest (impact_analysis, lineage_status) and the spill cache (every
 * bounded response). The real working directory is the package directory,
 * shared by every test file running at once, and a test that cleaned up
 * `cwd/.barwise` deleted another file's manifest mid-test (CI on #672).
 * So a test that reaches the fallback gets a temporary directory of its own,
 * removed after it.
 *
 * Mocking `process.cwd` is per process. It is sound here because vitest runs
 * each test file in its own forked process (no `pool` is set, and forks is
 * the default); under worker threads the mock would be shared between files.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";

/** Call at the top of a test file; returns the current test's directory. */
export function usePrivateCwd(): () => string {
  let dir = "";
  let spy: MockInstance<() => string> | undefined;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-cwd-"));
    spy = vi.spyOn(process, "cwd").mockReturnValue(dir);
  });
  afterEach(() => {
    spy?.mockRestore();
    rmSync(dir, { recursive: true, force: true });
  });
  return () => dir;
}
