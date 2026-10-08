/**
 * Tests for at-root.mjs, the cd-free way to run a monorepo script.
 *
 * The property under test is cwd-independence: the same spelling gives
 * the same answer from the repository root, from `barwise/`, and from a
 * package directory. That is the whole reason the wrapper exists
 * (barwise-907: a satisfied `cd barwise` failed and silently skipped a
 * format step), so the test runs from all three, as gates.test.mjs does
 * for the enumerating gates.
 *
 * Red is established first: an unknown script and a missing script
 * argument must fail, otherwise a green from the real script could be a
 * wrapper that ran nothing.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BARWISE = resolve(SCRIPTS, "..");
const REPO = resolve(BARWISE, "..");
const AT_ROOT = join(SCRIPTS, "at-root.mjs");

/** The three working directories the wrapper must not care about. */
const CWDS = [REPO, BARWISE, join(BARWISE, "packages", "core")];

function run(cwd, ...args) {
  return spawnSync(process.execPath, [AT_ROOT, ...args], { cwd, encoding: "utf8" });
}

test("no script named exits 2 with usage, from every cwd", () => {
  for (const cwd of CWDS) {
    const r = run(cwd);
    assert.equal(r.status, 2, `cwd ${cwd}: ${r.stderr}`);
    assert.match(r.stderr, /usage:/);
  }
});

test("an unknown script fails rather than reading as success", () => {
  for (const cwd of CWDS) {
    const r = run(cwd, "no-such-script-at-root-probe");
    assert.notEqual(r.status, 0, `cwd ${cwd} exited 0 for a script that does not exist`);
  }
});

test("a real script runs in barwise/ and reports the same result from every cwd", () => {
  // check:root-scripts is cheap, read-only, and would itself fail if the
  // wrapper had resolved the wrong directory.
  const results = CWDS.map((cwd) => run(cwd, "check:root-scripts"));
  for (const [i, r] of results.entries()) {
    assert.equal(r.status, 0, `cwd ${CWDS[i]}: ${r.stdout}\n${r.stderr}`);
  }
});

test("a caller's leading -- is dropped, so both spellings reach the script identically", () => {
  // at-root adds its own `--`, and a caller who also typed one used to
  // pass a literal `--` through: audit-corrections then read it as its
  // mode, ran in survey mode, wrote nothing and exited 0 (barwise-2lz).
  // A sandbox copy of the wrapper beside a stub package.json whose script
  // prints its argv shows exactly what the script receives.
  const dir = mkdtempSync(join(tmpdir(), "barwise-at-root-"));
  try {
    mkdirSync(join(dir, "scripts"));
    copyFileSync(AT_ROOT, join(dir, "scripts", "at-root.mjs"));
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({
        name: "at-root-probe",
        private: true,
        scripts: { argv: "node argv.mjs" },
      }),
    );
    writeFileSync(join(dir, "argv.mjs"), "console.log(JSON.stringify(process.argv.slice(2)));\n");
    const wrapper = join(dir, "scripts", "at-root.mjs");
    const argvOf = (...args) => {
      const r = spawnSync(process.execPath, [wrapper, "argv", ...args], {
        cwd: dir,
        encoding: "utf8",
      });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout.trim().split("\n").at(-1));
    };
    assert.deepEqual(argvOf("--write"), ["--write"]);
    assert.deepEqual(argvOf("--", "--write"), ["--write"]);
    assert.deepEqual(argvOf("--", "--write", "--", "x"), ["--write", "--", "x"]);
    assert.deepEqual(argvOf(), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
