/**
 * A private working directory for every test in the file that calls this,
 * with the fixtures a test needs copied into it.
 *
 * Tools write beside their input: an inline source falls back to
 * `process.cwd()` (the lineage manifest for impact_analysis and
 * lineage_status, the spill cache for any bounded response), and a file
 * source spills into `.barwise/` next to the file. Both used to be shared by
 * every test file running at once -- the package directory, and
 * `tests/fixtures/` -- and test files cleaned them up after themselves, so
 * one file deleted another's manifest or spill mid-test (CI on #672). Each
 * test now gets a temporary directory of its own, as its cwd and as the home
 * of any fixture it copies in, removed after it.
 *
 * The `process.cwd` mock is confined to the test file that makes it under
 * either vitest pool: a forked process, or a worker thread, has its own
 * `process` object. (`process.chdir` would not be, which is why this
 * mocks rather than changes directory.)
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

export interface PrivateWorkspace {
  /** The current test's directory, which `process.cwd()` returns. */
  readonly dir: () => string;
  /**
   * Copy `tests/fixtures/<relative>` (a file or a directory) into
   * `<dir>/fixtures/`; its new path. A subdirectory, not `dir` itself, so
   * a fixture's own directory is never the cwd and a test can still tell
   * "spilled beside the file" from "spilled under the cwd". Any `.barwise`
   * left in the source tree by an older run is not copied, so the copy is
   * the tracked fixture.
   */
  readonly fixture: (relative: string) => string;
}

/** Call at the top of a test file, after its constants. */
export function usePrivateCwd(): PrivateWorkspace {
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
  return {
    dir: () => dir,
    fixture: (relative) => {
      const to = join(dir, "fixtures", relative);
      cpSync(join(FIXTURES, relative), to, {
        recursive: true,
        filter: (source) => basename(source) !== ".barwise",
      });
      return to;
    },
  };
}
