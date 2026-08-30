/**
 * Tests for the gate scripts themselves.
 *
 * These exist because of two findings that a passing gate could not have
 * revealed, and that reading the gate could not either:
 *
 *   barwise-905  `check-no-nul` scanned 1426 of 1483 tracked files under
 *                `npm run` and 1483 by hand, printing `OK` both times.
 *                `git ls-files` resolves relative to the process cwd and
 *                the npm script runs from `barwise/`, so every tracked
 *                file outside `barwise/` went unscanned by the gate whose
 *                whole purpose is "no NUL byte anywhere". `check-shell`
 *                had the same hole, 6 files against 7. The COUNT is the
 *                only tell; a gate with half the coverage still says OK.
 *
 *   barwise-906  Three verifications in one session came back green for
 *                reasons unrelated to what they tested. The worst was a
 *                NUL probe written as an UNTRACKED file: the gate
 *                enumerates through `git ls-files`, never saw the probe,
 *                and reported OK. The defect and the check were in
 *                different worlds, so the green said nothing at all.
 *
 * So every gate here is shown RED on a defect placed where that gate
 * actually looks, and GREEN without it -- the red reading established
 * first, in a throwaway repo rather than by staging into this one.
 *
 * `node:test` rather than vitest: these are plain `.mjs` with nothing to
 * compile, and vitest is a dependency of the packages, not of this level.
 * Adding one to run four tests would be the kind of dependency CLAUDE.md
 * tells us not to take.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: SCRIPTS,
  encoding: "utf8",
}).trim();

// Written as an escape, never as a literal byte. `check-no-nul` scans
// every tracked text file in this repo -- including this one -- so a
// real NUL here would make the gate's own test fail the gate.
const NUL = "\u0000";

/** Run a gate with an explicit cwd. No shell, and no pipeline to read through. */
function gate(script, cwd, ...args) {
  return spawnSync(process.execPath, [join(SCRIPTS, script), ...args], {
    cwd,
    encoding: "utf8",
  });
}

/** A throwaway git repo, so a planted defect never touches this one's index. */
function tempRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-gate-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "gate@test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "gate"], { cwd: dir });
  return dir;
}

function stage(dir, name, contents) {
  const path = join(dir, name);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
  execFileSync("git", ["add", "--", name], { cwd: dir });
}

// --- barwise-905: coverage must not depend on where the gate is invoked ---

const CWDS = [REPO, join(REPO, "barwise"), join(REPO, "barwise", "packages", "core", "src")];

for (const script of ["check-no-nul.mjs", "check-shell.mjs"]) {
  test(`${script} reports the same coverage from every cwd`, () => {
    const runs = CWDS.map((cwd) => ({ cwd, ...gate(script, cwd) }));
    for (const r of runs) {
      assert.equal(r.status, 0, `${script} failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
    }
    const outputs = new Set(runs.map((r) => r.stdout.trim()));
    assert.equal(
      outputs.size,
      1,
      `${script} coverage depends on cwd:\n${
        runs.map((r) => `  ${r.cwd}\n    ${r.stdout.trim()}`).join("\n")
      }`,
    );
  });
}

// --- barwise-906: every gate proven red before it is trusted green ---

test("check-no-nul fails on a TRACKED NUL byte and passes without one", () => {
  const dir = tempRepo();
  try {
    stage(dir, "clean.md", "no nul here\n");
    assert.equal(gate("check-no-nul.mjs", dir).status, 0, "a clean tree must pass");

    stage(dir, "bad.md", `probe${NUL}nul\n`);
    const red = gate("check-no-nul.mjs", dir);
    assert.equal(red.status, 1, "a tracked NUL byte must fail the gate");
    assert.match(`${red.stdout}${red.stderr}`, /bad\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-no-nul does NOT see an untracked NUL file", () => {
  // Pinning the trap, not the feature. A probe written to disk but never
  // `git add`ed is invisible to a gate that enumerates through
  // `git ls-files` -- which is how this gate was once "verified" against
  // a file it could not reach, and reported OK. Asserting the blind spot
  // stops the next person re-running that experiment and believing it.
  const dir = tempRepo();
  try {
    stage(dir, "clean.md", "no nul here\n");
    writeFileSync(join(dir, "untracked.md"), `probe${NUL}nul\n`);
    assert.equal(
      gate("check-no-nul.mjs", dir).status,
      0,
      "untracked files are out of scope; a probe must be staged to test this gate",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-shell fails on a tracked script with a shellcheck finding", () => {
  const dir = tempRepo();
  try {
    stage(dir, "ok.sh", "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n");
    assert.equal(gate("check-shell.mjs", dir).status, 0, "a clean script must pass");

    // SC2164, a `cd` whose failure leaves every later command running
    // somewhere unintended. Chosen because it is a DEFAULT check, so this
    // test does not depend on .shellcheckrc reaching a temp directory.
    stage(dir, "bad.sh", "#!/usr/bin/env bash\ncd /tmp\n");
    const red = gate("check-shell.mjs", dir);
    assert.equal(red.status, 1, "a shellcheck finding must fail the gate");
    assert.match(`${red.stdout}${red.stderr}`, /bad\.sh/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-root-scripts fails on drift in either direction", () => {
  const dir = tempRepo();
  const inner = (scripts) => `${JSON.stringify({ name: "inner", scripts }, null, 2)}\n`;
  const root = (scripts) => `${JSON.stringify({ name: "r", private: true, scripts }, null, 2)}\n`;
  const fwd = (name) => `npm --prefix barwise run ${name} --`;
  try {
    stage(dir, "barwise/package.json", inner({ build: "tsc", lint: "oxlint" }));
    stage(dir, "package.json", root({ build: fwd("build"), lint: fwd("lint") }));
    assert.equal(
      gate("regen-root-package.mjs", dir, "--check").status,
      0,
      "matching forwarders must pass",
    );

    // A script added to barwise/ with no forwarder at the root.
    stage(dir, "barwise/package.json", inner({ build: "tsc", lint: "oxlint", added: "x" }));
    let red = gate("regen-root-package.mjs", dir, "--check");
    assert.equal(red.status, 1, "a missing forwarder must fail");
    assert.match(`${red.stdout}${red.stderr}`, /added/);

    // A forwarder for a script that no longer exists.
    stage(dir, "barwise/package.json", inner({ build: "tsc" }));
    stage(dir, "package.json", root({ build: fwd("build"), gone: fwd("gone") }));
    red = gate("regen-root-package.mjs", dir, "--check");
    assert.equal(red.status, 1, "a stale forwarder must fail");
    assert.match(`${red.stdout}${red.stderr}`, /gone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-910: the spec-status gate, pinned against real history ---

/**
 * This gate's whole claim is "it would have caught the header that went
 * stale", and that claim is checkable rather than assertable: `--at
 * <commit>` runs it against a historical tree. 7fbbba7 shipped
 * workstream 1 of barwise-902 while
 * `must-validate-outside-the-rubric.spec.md` still read "design only --
 * no implementation in this PR".
 *
 * Mutating a Status on today's tree would NOT reproduce that condition:
 * the gate compares against the commit that last touched the spec, and
 * both specs involved have been edited since. A red test written that
 * way passes, which is the barwise-906 shape -- so the red reading has
 * to come from the commit where the defect actually was.
 */
test("audit-spec-status fires on the header that went stale at 7fbbba7", () => {
  const r = gate("audit-spec-status.mjs", REPO, "--at", "7fbbba7");
  assert.equal(r.status, 0, `--at failed:\n${r.stdout}${r.stderr}`);
  assert.match(
    r.stdout,
    /must-validate-outside-the-rubric\.spec\.md/,
    `the gate did not fire on the defect it exists for:\n${r.stdout}`,
  );
  assert.match(r.stdout, /since: 7fbbba7/, `wrong reason:\n${r.stdout}`);
});

test("audit-spec-status --check is green on the current tree, from every cwd", () => {
  for (const cwd of CWDS) {
    const r = gate("audit-spec-status.mjs", cwd, "--check");
    assert.equal(r.status, 0, `--check failed in ${cwd}:\n${r.stdout}${r.stderr}`);
  }
});
