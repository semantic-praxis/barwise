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
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isMainThread } from "node:worker_threads";
import { afterEach, beforeEach, type MockInstance, vi } from "vitest";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

export interface PrivateWorkspace {
  /** The current test's directory, which `process.cwd()` returns. */
  readonly dir: () => string;
  /** Copy `tests/fixtures/<relative>` (a file or a directory) into it; its new path. */
  readonly fixture: (relative: string) => string;
}

/** Call at the top of a test file, after its constants. */
export function usePrivateCwd(): PrivateWorkspace {
  // Mocking process.cwd is per process. Under the forks pool (vitest's
  // default; no pool is set here) each test file has its own; under worker
  // threads the files running at once would share the mock and each other's
  // directory, which is the race this exists to remove. Refuse rather than
  // reintroduce it quietly.
  if (!isMainThread) {
    throw new Error(
      "usePrivateCwd mocks process.cwd(), which worker threads share; run these tests in the forks pool.",
    );
  }
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
      const to = join(dir, relative);
      cpSync(join(FIXTURES, relative), to, { recursive: true });
      return to;
    },
  };
}
