/**
 * A completed vitest run leaves nothing in the temp directory
 * (docs/specs/vitest-temp-folder-leak.spec.md, barwise-fvi).
 *
 * Vitest 5.0.1 created a `<id>/ssr/` folder of transformed modules for
 * every run and never removed it; a session container collected about
 * 26,000 of them, the disk allowance ran out, and the pre-push gates could
 * not run. 5.0.5 removes it on close. This runs the workspace's own vitest
 * on a fixture that needs no build, with TMPDIR pointed at a fresh
 * directory, and requires the directory to be empty afterwards.
 *
 * The run must be seen to pass first: one that never transformed a module
 * leaves the directory empty too, and proves nothing. The fixture also
 * asserts that the run's `os.tmpdir()` is the directory chosen here, so
 * `1 passed` shows the run wrote, if anywhere, where this test looks.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BARWISE = resolve(SCRIPTS, "..");
// The vitest a package runs, resolved as one does: the root workspace does
// not declare vitest, so whatever sits at barwise/node_modules is only
// right while npm hoists it there.
const VITEST = dirname(
  createRequire(join(BARWISE, "packages", "learn", "package.json")).resolve("vitest/package.json"),
);
const FIXTURE = join(SCRIPTS, "tests", "fixtures", "vitest-tmp");

test("a completed vitest run leaves its temp directory empty", () => {
  const version = JSON.parse(readFileSync(join(VITEST, "package.json"), "utf8")).version;
  const dir = mkdtempSync(join(tmpdir(), "barwise-vitest-tmp-"));
  try {
    // --no-cache: the results cache would otherwise land in the fixture's
    // own node_modules, which a test of "leaves nothing behind" must not do.
    const r = spawnSync(process.execPath, [
      join(VITEST, "vitest.mjs"),
      "run",
      "--root",
      FIXTURE,
      "--no-cache",
    ], {
      cwd: FIXTURE,
      encoding: "utf8",
      timeout: 120_000,
      env: { ...process.env, TMPDIR: dir, BARWISE_EXPECTED_TMPDIR: dir, NO_COLOR: "1" },
    });
    assert.equal(r.error, undefined, `vitest ${version} could not be started: ${r.error}`);
    const output = `${r.stdout}\n${r.stderr}`;
    assert.equal(r.status, 0, `vitest ${version} did not run the fixture:\n${output}`);
    assert.match(output, /Tests\s+1 passed/, `vitest ${version} ran no test:\n${output}`);
    assert.deepEqual(
      readdirSync(dir),
      [],
      `vitest ${version} left these in its temp directory ${dir}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
