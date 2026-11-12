/**
 * Gate tests: the refusal contract, cwd invariance, the lockfile, secrets, beads, mutate,
 * spec-status, parity, python-uv and book-citation gates, and beads id identity.
 *
 * Split from gates.test.mjs (barwise-bbt) so the gate tests run in parallel;
 * why these tests exist at all is the header of gates-helpers.mjs.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import {
  CWDS,
  gate,
  gateWithStubGit,
  mutate,
  NUL,
  REPO,
  SCRIPTS,
  skipIfShallow,
  skippedForMissingTool,
  stage,
  tempRepo,
} from "./gates-helpers.mjs";

// --- barwise-989: a gate that cannot see its input must not print PASS ---

/**
 * Every gate that resolves the repo root through `lib/tracked.mjs`, plus
 * the two that used to re-derive it themselves.
 *
 * Before this, all seven exited 1 with a Node stack trace -- a path
 * built from `""`, not a guard that noticed. A stack trace reads as a
 * defect in the gate, which sends the reader hunting something that is
 * not there; exit 2 says "could not answer" and is the third result the
 * contract exists to give (docs/specs/gate-refusal-contract.spec.md).
 */
const ROOT_DEPENDENT_GATES = [
  "check-no-nul.mjs",
  "check-python-uv.mjs",
  "check-book-citations.mjs",
  "check-core-purity.mjs",
  "check-source-sites.mjs",
  "check-file-size.mjs",
  "check-secrets.mjs",
  "audit-corrections.mjs",
  "check-lockfile-agrees.mjs",
  "check-git-listing.mjs",
  "check-plan-review.mjs",
  "check-spec-first.mjs",
  // A test runner whose cases need git: it refused nothing and reported
  // failed cases as a finding until gate-contract-enforced WS1.
  "test-adr-model.mjs",
];

for (const script of ROOT_DEPENDENT_GATES) {
  for (const mode of ["empty", "fail"]) {
    test(`${script} refuses with exit 2 when git ${mode === "empty" ? "answers emptily" : "fails"} [adr:gate-refusal-contract#three-results] [adr:gate-refusal-contract#refuse-not-find]`, () => {
      const r = gateWithStubGit(script, mode);
      assert.equal(
        r.status,
        2,
        `expected refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`,
      );
      assert.match(r.stderr, /repository root is unknown/);
      // The point of the contract: never a stack trace, never a PASS.
      assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
      assert.doesNotMatch(r.stdout, /OK|PASS/);
    });
  }
}

test("trackedFiles refuses rather than reporting OK over an empty listing", () => {
  // git ls-files returning nothing is barwise-905's shape: every caller
  // filters the list and reports OK on finding no offenders, so an empty
  // listing is exactly the reading that looks like success. The stub
  // answers every git call, so `rev-parse` refuses first -- which is the
  // correct order and is why this asserts the contract rather than the
  // specific message.
  const r = gateWithStubGit("check-no-nul.mjs", "empty");
  assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /tracked files/);
});

// --- barwise-990: fmt:check reported OK over a set it could not see ---

/**
 * `dprint.json` lives in `barwise/` and `npm run fmt` runs from there,
 * so dprint never walked up: README.md, CLAUDE.md, AGENTS.md and every
 * `.claude/skills/*.md` were outside its reach and had never been
 * formatted, while `fmt:check` exited 0. barwise-905's shape applied to
 * formatting, and the three files it missed are the three a new
 * contributor reads first.
 */
test("fmt-root covers the files outside barwise/, from every cwd", () => {
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("fmt-root.mjs", cwd, "--check") }));
  for (const r of runs) {
    assert.equal(r.status, 0, `fmt-root failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  }
  // The COUNT is the tell, exactly as it was for check-no-nul: a run
  // that formatted nothing also exits 0 and also prints OK.
  const counts = new Set(runs.map((r) => /(\d+) file\(s\)/.exec(r.stdout)?.[1]));
  assert.equal(counts.size, 1, `fmt-root's coverage depends on cwd: ${[...counts].join(", ")}`);
  assert.ok(Number([...counts][0]) > 0, "fmt-root reported zero files, which cannot be right");
});

test("fmt-root refuses when git cannot say where the repository is", () => {
  // Named for what it actually reaches. An earlier version of this test
  // was called "refuses over an empty file set" and did NOT test that:
  // with the stub answering every git call, REPO_ROOT refuses before
  // `targets` is ever computed, so fmt-root's own `targets.length === 0`
  // guard is never entered. `npm run mutate` disabling that guard came
  // back UNCAUGHT, which is how the mislabelling was found -- a test
  // named after a guard it does not exercise is the same defect as a
  // guard that cannot fire.
  //
  // fmt-root's own empty-set guard is covered instead by mutating the
  // `!f.startsWith("barwise/")` filter, which is the only way to reach
  // it: trackedFiles() refuses on an empty listing first.
  const r = gateWithStubGit("fmt-root.mjs", "empty", "--check");
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.doesNotMatch(r.stdout, /OK/);
});

// --- barwise-905: coverage must not depend on where the gate is invoked ---

// `check-secrets` has the same property but is asserted separately, below:
// its history mode depends on clone depth, so the invariance test uses
// `--staged` and cannot share this loop's argument-free call.
for (const script of ["check-no-nul.mjs", "check-shell.mjs", "audit-corrections.mjs"]) {
  test(`${script} reports the same coverage from every cwd [adr:gate-refusal-contract#cwd-invariant]`, (t) => {
    const runs = CWDS.map((cwd) => ({ cwd, ...gate(script, cwd) }));
    if (skippedForMissingTool(t, runs, `${script}'s tool`)) return;
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

/**
 * `audit-gate` is the same property, and it is here because it broke.
 *
 * It spawned `npm audit` with no `cwd`, so from a workspace package it
 * audited that package -- no lockfile of its own, therefore no
 * advisories, therefore `PASS`. It did not merely under-report: with the
 * advisory invisible, its ACCEPTED entry looked stale and the gate
 * advised deleting the acceptance record for a live high-severity RCE
 * (barwise-987, docs/specs/gate-refusal-contract.spec.md).
 *
 * Separate from the loop above because the gate reaches the network,
 * which the other two do not: an environment that cannot run `npm audit`
 * must skip loudly rather than read as a cwd defect. That is the
 * `audit-spec-status` shallow-clone pattern, for the same reason.
 *
 * The skip is `every`, not `some`, and that distinction is the whole
 * test. Written with `some`, this passed with the defect restored: from
 * the repo root the un-pinned spawn made `npm audit` report ENOLOCK, the
 * gate refused with exit 2, and the skip guard read that as "this
 * environment cannot audit" and reported green. The guard added for
 * robustness became the thing hiding the defect -- caught by `npm run
 * mutate` returning UNCAUGHT, not by review.
 *
 * With the root pinned, all three runs do identical work, so they
 * refuse together or not at all. A PARTIAL refusal is therefore not an
 * environment fact; it is the defect, and it must fail here.
 *
 * The property is agreement, not a pass. This test once asserted exit 0
 * from every cwd, which made it a second copy of the audit-gate CI step:
 * an advisory published upstream failed `test:scripts` on every non-docs PR,
 * whatever it changed, with a message about cwd that the failure had
 * nothing to do with (barwise-um1). Whether the tree has an unaccepted
 * advisory is that step's question. This one asks only whether the
 * answer depends on where the gate was run, and the restored defect
 * still fails it: the package cwd's PASS disagrees with the others.
 */
test("audit-gate reports the same advisories from every cwd", (t) => {
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("audit-gate.mjs", cwd) }));
  if (runs.every((r) => r.status === 2)) {
    t.skip("`npm audit` could not run here (exit 2 from every cwd is refusal, not failure)");
    return;
  }
  const statuses = new Set(runs.map((r) => r.status));
  assert.equal(
    statuses.size,
    1,
    `audit-gate's exit status depends on cwd:\n${
      runs.map((r) => `  ${r.cwd}: exit ${r.status}\n${r.stdout}${r.stderr}`).join("\n")
    }`,
  );
  const outputs = new Set(runs.map((r) => r.stdout.trim()));
  assert.equal(
    outputs.size,
    1,
    `audit-gate's reading depends on cwd:\n${
      runs.map((r) => `  ${r.cwd}\n    ${r.stdout.trim()}`).join("\n")
    }`,
  );
});

test("audit-gate refuses a root with no npm project rather than reporting PASS", () => {
  // The generalising half of the fix. Pinning the root fixes this
  // instance; refusing when the root holds no manifest is what stops the
  // gate printing PASS over an empty scan for any other reason.
  // `audit-gate.mjs` imports only node: builtins, so a bare copy runs.
  const dir = mkdtempSync(join(tmpdir(), "barwise-audit-"));
  try {
    mkdirSync(join(dir, "scripts"));
    writeFileSync(
      join(dir, "scripts", "audit-gate.mjs"),
      readFileSync(join(SCRIPTS, "audit-gate.mjs")),
    );
    const r = spawnSync(process.execPath, [join(dir, "scripts", "audit-gate.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no npm project/);
    assert.doesNotMatch(r.stdout, /PASS/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-906: every gate proven red before it is trusted green ---

/**
 * A one-dependency npm project declaring `foo@^2.0.0`, with `installed` on
 * disk and, when `lockPackages` is given, a package-lock.json whose
 * `packages` map is those entries plus the root.
 */
function lockfileFixture(installed, lockPackages) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-lockfile-"));
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ name: "fx", version: "1.0.0", dependencies: { foo: "^2.0.0" } }),
  );
  if (installed) {
    mkdirSync(join(dir, "node_modules", "foo"), { recursive: true });
    writeFileSync(
      join(dir, "node_modules", "foo", "package.json"),
      JSON.stringify({ name: "foo", version: installed }),
    );
  }
  if (lockPackages) {
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({
        name: "fx",
        version: "1.0.0",
        lockfileVersion: 3,
        requires: true,
        packages: {
          "": { name: "fx", version: "1.0.0", dependencies: { foo: "^2.0.0" } },
          ...lockPackages,
        },
      }),
    );
  }
  return dir;
}

/** Run the gate over a fixture, after `setup(dir)` if given, and remove it. */
function lockfileGate(installed, lockPackages, setup) {
  const dir = lockfileFixture(installed, lockPackages);
  try {
    setup?.(dir);
    return gate("check-lockfile-agrees.mjs", REPO, "--dir", dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// --- barwise-2d4: a stale install is not a range problem ---

test("check-lockfile-agrees refuses, naming npm ci, when an out-of-range install predates the lockfile", () => {
  // The 2026-10-08 shape: main's lockfile moved on, the local tree did
  // not, and the gate blamed the manifests.
  const r = lockfileGate("1.0.0", { "node_modules/foo": { version: "2.2.0" } });
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /node_modules\/foo: lockfile 2\.2\.0, installed 1\.0\.0/);
  assert.match(r.stderr, /Run `npm ci`/);
  assert.doesNotMatch(r.stderr, /Fix the ranges/);
});

test("check-lockfile-agrees refuses rather than passing an in-range install the lockfile does not describe", () => {
  // `npm ls` exits 0 here: 2.1.0 satisfies ^2.0.0. The gate used to
  // print OK about a tree that was never the lockfile's.
  const r = lockfileGate("2.1.0", { "node_modules/foo": { version: "2.2.0" } });
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /lockfile 2\.2\.0, installed 2\.1\.0/);
  assert.doesNotMatch(r.stdout, /OK/);
});

test("check-lockfile-agrees refuses a package installed where the lockfile has no entry", () => {
  // Copilot's reproduction on PR #627: `npm ls` judges extraneous
  // packages by the manifests, so a declared foo@2.1.0 against a lockfile
  // that lost its entry passed. Scoped and nested paths go through the
  // same walk, so the fixture puts one of each beside it.
  const r = lockfileGate("2.1.0", {}, (dir) => {
    const put = (path, version) => {
      mkdirSync(join(dir, path), { recursive: true });
      writeFileSync(join(dir, path, "package.json"), JSON.stringify({ version }));
    };
    put("node_modules/@s/bar", "1.0.0");
    put("node_modules/foo/node_modules/baz", "3.0.0");
  });
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /node_modules\/foo: installed 2\.1\.0, not in lockfile/);
  assert.match(r.stderr, /node_modules\/@s\/bar: installed 1\.0\.0, not in lockfile/);
  assert.match(
    r.stderr,
    /node_modules\/foo\/node_modules\/baz: installed 3\.0\.0, not in lockfile/,
  );
  assert.doesNotMatch(r.stdout, /OK/);
});

test("check-lockfile-agrees refuses when a required lockfile entry is not installed", () => {
  const r = lockfileGate("2.2.0", {
    "node_modules/foo": { version: "2.2.0" },
    "node_modules/bar": { version: "1.0.0" },
  });
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /node_modules\/bar: lockfile 1\.0\.0, not installed/);
});

test("check-lockfile-agrees passes a matching install, skipping absent optional and link entries", () => {
  const r = lockfileGate("2.2.0", {
    "node_modules/foo": { version: "2.2.0" },
    "node_modules/opt": { version: "1.0.0", optional: true },
    "node_modules/devopt": { version: "1.0.0", devOptional: true },
    "node_modules/ws": { resolved: "packages/ws", link: true },
  }, (dir) => {
    // npm's own bookkeeping lives in dot-entries; none is a package.
    mkdirSync(join(dir, "node_modules", ".bin"));
    mkdirSync(join(dir, "node_modules", ".cache"));
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(r.stdout, /1 installed entries satisfy their declared ranges\. OK/);
});

test("check-lockfile-agrees does not call a version bump awaiting npm install a stale install", () => {
  // The root and workspace entries describe source manifests, not
  // installed packages: mid-release, package.json says 1.0.0 while the
  // lockfile still says 0.9.0, and `npm ci` is not the remedy.
  const r = lockfileGate(
    "2.2.0",
    {
      "": { name: "fx", version: "0.9.0", dependencies: { foo: "^2.0.0" } },
      "packages/ws": { name: "ws", version: "0.9.0" },
      "node_modules/foo": { version: "2.2.0" },
    },
    (dir) => {
      mkdirSync(join(dir, "packages", "ws"), { recursive: true });
      writeFileSync(
        join(dir, "packages", "ws", "package.json"),
        JSON.stringify({ name: "ws", version: "1.0.0" }),
      );
    },
  );
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("check-lockfile-agrees leaves a package linked on purpose alone", () => {
  // `npm link` puts a local checkout where the lockfile expects a
  // registry version. That is the developer's choice, and `npm ci` would
  // silently undo it; `npm ls` still checks its version against the range.
  const r = lockfileGate(null, { "node_modules/foo": { version: "2.2.0" } }, (dir) => {
    mkdirSync(join(dir, "local-foo"));
    writeFileSync(
      join(dir, "local-foo", "package.json"),
      JSON.stringify({ name: "foo", version: "2.5.0" }),
    );
    // The checkout has its own node_modules, which no lockfile here
    // describes; the walk must not follow the link into it.
    mkdirSync(join(dir, "local-foo", "node_modules", "dep"), { recursive: true });
    writeFileSync(
      join(dir, "local-foo", "node_modules", "dep", "package.json"),
      JSON.stringify({ version: "1.0.0" }),
    );
    mkdirSync(join(dir, "node_modules"));
    symlinkSync(join(dir, "local-foo"), join(dir, "node_modules", "foo"), "dir");
  });
  assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
});

test("check-lockfile-agrees refuses a lockfile with no packages map instead of skipping the comparison", () => {
  // A lockfileVersion 1 file, or a bad merge that left `{}`: falling
  // through to `npm ls` would pass a tree never compared with it.
  const r = lockfileGate("2.1.0", { "node_modules/foo": { version: "2.2.0" } }, (dir) => {
    writeFileSync(
      join(dir, "package-lock.json"),
      JSON.stringify({ lockfileVersion: 1, dependencies: {} }),
    );
  });
  assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
  assert.match(r.stderr, /has no packages map/);
  assert.doesNotMatch(r.stdout, /OK/);
});

test("check-lockfile-agrees fails when an installed version is outside its declared range", () => {
  // PR #542's shape: the manifest asked for ^5, the tree held 4.1.11.
  const dir = lockfileFixture("1.0.0");
  try {
    const red = gate("check-lockfile-agrees.mjs", REPO, "--dir", dir);
    assert.equal(red.status, 1, `expected a finding, got ${red.status}:\n${red.stderr}`);
    assert.match(red.stderr, /invalid: foo@1\.0\.0/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-lockfile-agrees passes when every installed version satisfies its range", () => {
  const dir = lockfileFixture("2.1.0");
  try {
    const r = gate("check-lockfile-agrees.mjs", REPO, "--dir", dir);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /1 installed entries satisfy their declared ranges\. OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-lockfile-agrees refuses with exit 2 when nothing is installed", () => {
  // Without node_modules `npm ls` calls every dependency "missing" and
  // exits 1 -- a finding about the lockfile, when the truth is that the
  // gate had nothing to read.
  const dir = lockfileFixture(null);
  try {
    const r = gate("check-lockfile-agrees.mjs", REPO, "--dir", dir);
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no node_modules/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-git-listing fails on a script that lists untracked files itself", () => {
  // The spelling trial used before PR #641's fix, in a script outside lib/.
  const dir = tempRepo();
  try {
    stage(dir, "barwise/scripts/fine.mjs", "export const x = 1;\n");
    stage(dir, "barwise/scripts/lib/changed-class.mjs", 'git(["ls-files", "--others"]);\n');
    stage(dir, "barwise/scripts/tests/probe.test.mjs", 'git(["ls-files", "--others"]);\n');
    const green = gate("check-git-listing.mjs", dir);
    assert.equal(green.status, 0, `lib/ and tests/ are out of scope:\n${green.stderr}`);

    stage(
      dir,
      "barwise/scripts/rolled.mjs",
      'const a = 1;\nconst u = git(["ls-files", "--others", "--exclude-standard"], path);\n',
    );
    const red = gate("check-git-listing.mjs", dir);
    assert.equal(red.status, 1, red.stdout);
    assert.match(red.stderr, /barwise\/scripts\/rolled\.mjs:2/);
    assert.match(red.stderr, /uncommittedPaths/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-git-listing refuses a script it cannot read, and skips a deleted one", () => {
  const dir = tempRepo();
  try {
    stage(dir, "barwise/scripts/fine.mjs", "export const x = 1;\n");
    stage(dir, "barwise/scripts/gone.mjs", "export const y = 1;\n");
    rmSync(join(dir, "barwise/scripts/gone.mjs"));
    assert.equal(gate("check-git-listing.mjs", dir).status, 0, "a deleted script is skipped");

    // A directory where a tracked script was: readFileSync throws EISDIR.
    rmSync(join(dir, "barwise/scripts/fine.mjs"));
    mkdirSync(join(dir, "barwise/scripts/fine.mjs"));
    const r = gate("check-git-listing.mjs", dir);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /could not read barwise\/scripts\/fine\.mjs \(EISDIR\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-git-listing refuses when no script is in scope", () => {
  // A layout change that empties the filter would otherwise print OK over
  // nothing (barwise-905's shape).
  const dir = tempRepo();
  try {
    stage(dir, "README.md", "x\n");
    const r = gate("check-git-listing.mjs", dir);
    assert.equal(r.status, 2, r.stdout);
    assert.match(r.stderr, /no tracked \.mjs files under barwise\/scripts/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

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

test("check-shell fails on a tracked script with a shellcheck finding", (t) => {
  const dir = tempRepo();
  try {
    stage(dir, "ok.sh", "#!/usr/bin/env bash\nset -euo pipefail\necho hi\n");
    const clean = gate("check-shell.mjs", dir);
    if (skippedForMissingTool(t, clean, "shellcheck")) return;
    assert.equal(clean.status, 0, "a clean script must pass");

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

// --- check-secrets: the one defect a follow-up commit cannot fix ---

/**
 * Credential-shaped probes, assembled at RUNTIME.
 *
 * Every value is concatenation rather than a literal, for the same reason
 * `NUL` at the top of this file is an escape: `check-secrets` scans this
 * repository's whole history, including this file, so a literal here would
 * make the gate fail on its own test forever after. Each string is split at
 * the exact position its rule anchors on, which is why the splits look
 * arbitrary and are not.
 *
 * These are shapes, not keys. Nothing here has ever been valid anywhere.
 *
 * Three rules, chosen because they cover the three cases that matter:
 * gitleaks' own vendor rule, gitleaks' structural rule, and the ONE rule
 * this repository adds in `.gitleaks.toml` because the default set has
 * none.
 *
 * The bodies are high-entropy on purpose. gitleaks applies an entropy
 * model, and a first attempt at these probes used sequential alphabets
 * ("0123456789abcdef...") which fell below its threshold and were not
 * detected -- so the test would have proved the wrapper silent rather than
 * the scanner working.
 */
/**
 * `probe` is the credential itself; `content` is the file it sits in.
 *
 * The field is named `probe` and every value is split, because naming it
 * `secret` made this table match gitleaks' own `generic-api-key` rule --
 * `secret: "<high-entropy string>"` is precisely that rule's shape -- and
 * the gate failed on its own test file at this line. Caught by the gate,
 * once the file was staged and it could see it.
 *
 * They are separate fields because the redaction assertion below needs the
 * CREDENTIAL ITSELF, and asserting on the whole surrounding line instead let a real
 * regression through. With `--redact` removed, gitleaks prints
 * `Finding: aws_key = "<ESC>[1;3;mAKIA...` -- the key in the clear, but with
 * an ANSI sequence between the quote and the key and no closing quote. A
 * check for the surrounding line therefore did not match, `npm run mutate`
 * reported UNCAUGHT, and the one property this gate exists to hold was
 * unasserted while reading as covered.
 */
const GITLEAKS_PROBES = {
  "aws-access-token": {
    probe: "AKIA" + "3QT7XKVBZ2WRMNPL",
    content: (s) => `aws_key = "${s}"\n`,
  },
  "anthropic-api-key": {
    probe: "sk-ant-" + "api03-"
      + "7Kq2Vx9mTwRbN4yLp" + "Z3jHcF8sAdE6gUn1oIx" + "BvCzMlQeRtYuWiHgFdSaPoKjNm-QwErTy",
    content: (s) => `ANTHROPIC_API_KEY=${s}\n`,
  },
  // BOTH armour lines are split, not just the opening one: gitleaks'
  // private-key rule needs the closing marker too (a probe without it was
  // measured undetected), and the rule matches from BEGIN across to the
  // closing KEY-----, so leaving either intact in this source file would
  // make the gate flag its own test.
  "private-key": {
    probe: "MIIBOgIBAAJBAK7" + "xYzQdJhFyUcEaSbNi" + "OkRtLwVmXpYq4H3G8" + "DZgT7xKvBz2WrMnPl",
    content: (s) =>
      "-----BEGIN RSA PRIVATE" + ` KEY-----\n${s}\n` + "-----END RSA PRIVATE" + " KEY-----\n",
  },
};

/**
 * A throwaway repo carrying THIS repository's real `.gitleaks.toml`.
 *
 * The real config rather than a fixture, deliberately: the Anthropic rule
 * is the one piece of detection barwise owns, so a test against a
 * hand-written config would be testing the fixture. The wrapper refuses
 * when the config is missing, so the copy is also what makes these repos
 * scannable at all.
 */
function secretsRepo() {
  const dir = tempRepo();
  // Staged and committed, not merely written: the shallow-clone test below
  // clones this repo, and `git clone` does not carry untracked files -- so an
  // unstaged config made the clone refuse for a missing config rather than
  // for being shallow, which is a different question and passed for the
  // wrong reason.
  stage(dir, ".gitleaks.toml", readFileSync(join(REPO, ".gitleaks.toml"), "utf8"));
  stage(dir, "clean.txt", "nothing credential-shaped here\n");
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  return dir;
}

function commitAll(dir, message) {
  execFileSync("git", ["commit", "-qm", message], { cwd: dir });
}

/**
 * Each rule shown RED on a staged probe of its own shape, and GREEN
 * without one.
 *
 * The negative half is what makes the gate's clean reading on the real
 * repository worth anything: a scanner that cannot fire is
 * byte-indistinguishable from a repository with no secrets in it --
 * barwise-902's shape, a check that banks a guaranteed point instead of
 * measuring.
 */
for (const [rule, { probe, content }] of Object.entries(GITLEAKS_PROBES)) {
  test(`check-secrets fails on a staged ${rule} [adr:credential-handling#gitleaks-detects]`, (t) => {
    const dir = secretsRepo();
    try {
      const clean = gate("check-secrets.mjs", dir, "--staged");
      if (skippedForMissingTool(t, clean, "gitleaks")) return;
      assert.equal(clean.status, 0, "a clean index must pass");

      stage(dir, "probe.txt", content(probe));
      const red = gate("check-secrets.mjs", dir, "--staged");
      assert.equal(red.status, 1, `a staged ${rule} must fail the gate`);
      const out = `${red.stdout}${red.stderr}`;
      assert.match(out, new RegExp(rule));
      assert.match(out, /ROTATE IT FIRST/);

      // The redaction rule, asserted per rule rather than argued once. CI
      // logs are retained and searchable, so a gate that echoes its
      // finding becomes a second durable copy of the leak.
      assert.ok(
        !out.includes(probe),
        `check-secrets printed the credential for ${rule}`,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("check-secrets refuses when gitleaks is absent rather than reporting clean [adr:credential-handling#wrapper-contract]", () => {
  // The container this project develops in does not ship gitleaks, so this
  // is the reading a fresh session gets until the bootstrap installs it.
  const dir = secretsRepo();
  const stubDir = mkdtempSync(join(tmpdir(), "barwise-nogl-"));
  try {
    writeFileSync(join(stubDir, "gitleaks"), "#!/bin/sh\nexit 127\n");
    chmodSync(join(stubDir, "gitleaks"), 0o755);
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-secrets.mjs"), "--staged"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
    });
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /not installed/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("check-secrets refuses a gitleaks status that is neither clean nor a finding [adr:credential-handling#wrapper-contract]", () => {
  // The distinction the wrapper exists for. gitleaks uses 1 for findings,
  // so any OTHER non-zero status is the tool failing to run -- and
  // reporting that as a finding would send the reader hunting a credential
  // that was never there, while reporting it as clean is the false green
  // the refusal contract forbids.
  const dir = secretsRepo();
  const stubDir = mkdtempSync(join(tmpdir(), "barwise-glbad-"));
  try {
    writeFileSync(
      join(stubDir, "gitleaks"),
      "#!/bin/sh\ncase \"$1\" in version) echo 8.28.0;; *) echo 'boom' >&2; exit 3;; esac\n",
    );
    chmodSync(join(stubDir, "gitleaks"), 0o755);
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-secrets.mjs"), "--staged"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
    });
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /neither clean nor a finding/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
    rmSync(stubDir, { recursive: true, force: true });
  }
});

test("check-secrets refuses when .gitleaks.toml is missing [adr:credential-handling#wrapper-contract]", (t) => {
  // Without this, gitleaks falls back to its bundled defaults: it would
  // still find most things and would silently drop the Anthropic rule,
  // which is the credential this repository is most likely to leak and the
  // one the default set does not have. A gate running a weaker rule set
  // than it claims is this spec's own subject.
  const dir = secretsRepo();
  try {
    // With gitleaks absent the gate refuses for THAT reason instead, and
    // this test cannot tell the two refusals apart -- so it is skipped
    // rather than passing on the wrong one.
    if (skippedForMissingTool(t, gate("check-secrets.mjs", dir, "--staged"), "gitleaks")) return;
    rmSync(join(dir, ".gitleaks.toml"));
    const r = gate("check-secrets.mjs", dir, "--staged");
    assert.equal(r.status, 2, `expected refusal, got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no \.gitleaks\.toml/);
    assert.doesNotMatch(r.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-secrets refuses a history scan of a shallow clone, but --staged still works [adr:credential-handling#wrapper-contract]", (t) => {
  // Every fresh session clone of this project is shallow. A history scan
  // there would report a clean bill of health over whatever few commits
  // arrived, which is why the default mode refuses -- while `--staged`
  // reads the index, which a shallow clone has in full, so the pre-commit
  // path keeps working regardless (docs/specs/gate-refusal-contract.spec.md).
  const src = secretsRepo();
  const parent = mkdtempSync(join(tmpdir(), "barwise-shallow-"));
  try {
    stage(src, "b.txt", "two\n");
    commitAll(src, "two");

    const clone = join(parent, "clone");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${src}`, clone]);
    assert.equal(
      execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
        cwd: clone,
        encoding: "utf8",
      }).trim(),
      "true",
      "the fixture must actually be shallow, or this test asserts nothing",
    );

    if (skippedForMissingTool(t, gate("check-secrets.mjs", clone, "--staged"), "gitleaks")) return;
    const deep = gate("check-secrets.mjs", clone);
    assert.equal(deep.status, 2, `expected refusal, got ${deep.status}:\n${deep.stderr}`);
    assert.match(deep.stderr, /SHALLOW/);
    assert.doesNotMatch(deep.stdout, /OK/);

    assert.equal(
      gate("check-secrets.mjs", clone, "--staged").status,
      0,
      "--staged does not depend on clone depth",
    );
  } finally {
    rmSync(src, { recursive: true, force: true });
    rmSync(parent, { recursive: true, force: true });
  }
});

test("check-secrets gives the same reading from every cwd", (t) => {
  // barwise-905's property. `--staged` rather than the history mode so the
  // test does not depend on whether this clone happens to be shallow.
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("check-secrets.mjs", cwd, "--staged") }));
  if (skippedForMissingTool(t, runs, "gitleaks")) return;
  for (const r of runs) {
    assert.equal(r.status, 0, `check-secrets failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  }
  assert.equal(
    new Set(runs.map((r) => r.stdout.trim())).size,
    1,
    `check-secrets' reading depends on cwd:\n${
      runs.map((r) => `  ${r.cwd}\n    ${r.stdout.trim()}`).join("\n")
    }`,
  );
});

// --- check-beads: a note that says "shipped" on an issue that is not closed ---

/** One canonical JSONL line: every required field, `_type` first, compact. */
function issueLine(overrides) {
  const stamp = "2026-01-01T00:00:00Z";
  return JSON.stringify({
    _type: "issue",
    id: "t-1",
    title: "t",
    status: "open",
    priority: 2,
    issue_type: "task",
    owner: "x",
    created_at: stamp,
    created_by: "x",
    updated_at: stamp,
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  }) + "\n";
}

function beadsCheck(jsonl) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-beads-"));
  try {
    const file = join(dir, "issues.jsonl");
    writeFileSync(file, jsonl);
    // bash, not node: the gate is a shell wrapper over `uv run`. Run from
    // the repo so `git rev-parse` finds the pyproject the wrapper points
    // uv at; the file under test is the explicit argument.
    return spawnSync("bash", [join(SCRIPTS, "check-beads.sh"), "--strict", file], {
      cwd: REPO,
      encoding: "utf8",
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-beads --strict fails an open issue whose notes claim a shipped PR", () => {
  const red = beadsCheck(issueLine({ notes: "Shipped in PR #236. Done." }));
  assert.equal(
    red.status,
    1,
    `expected the shipped-but-open line to fail:\n${red.stdout}${red.stderr}`,
  );
  assert.match(red.stdout, /notes say 'Shipped in PR #236'/);

  const closed = beadsCheck(issueLine({ status: "closed", notes: "Shipped in PR #236." }));
  assert.equal(
    closed.status,
    0,
    `a closed issue may say shipped:\n${closed.stdout}${closed.stderr}`,
  );

  // The wording that is legitimately in_progress must not trip it.
  const pending = beadsCheck(
    issueLine({ status: "in_progress", notes: "Implemented (PR pending)." }),
  );
  assert.equal(pending.status, 0, `PR pending is not shipped:\n${pending.stdout}${pending.stderr}`);
});

/**
 * `beads-crud update` in a throwaway repo carrying one issue, so a
 * destructive write can be attempted without risking this repo's tracker.
 */
function beadsCrud(notes, ...args) {
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, ".beads"), { recursive: true });
    writeFileSync(join(dir, ".beads", "issues.jsonl"), issueLine({ notes }));
    const run = spawnSync(
      process.execPath,
      [join(SCRIPTS, "beads-crud.mjs"), ...args],
      { cwd: dir, encoding: "utf8" },
    );
    const after = JSON.parse(readFileSync(join(dir, ".beads", "issues.jsonl"), "utf8").trim());
    return { ...run, notesAfter: after.notes };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("beads-crud update refuses to blank a non-empty field, and clears it on request", () => {
  // The incident: `--notes "$(node beads-crud.mjs show X --json)"`. The
  // inner command was refused for the unknown flag, exited 1, and the
  // substitution yielded "". The write then reported success and 4544
  // characters of barwise-906's notes were gone -- recovered only because
  // the file is tracked. Every field this tool writes is reachable the
  // same way, so the refusal is on the write, not on one flag.
  const red = beadsCrud("four thousand characters of history", "update", "t-1", "--notes", "");
  assert.equal(red.status, 1, `expected a refusal:\n${red.stdout}${red.stderr}`);
  assert.match(red.stderr + red.stdout, /would erase 35 characters/);
  assert.equal(
    red.notesAfter,
    "four thousand characters of history",
    "a refused update must not have written anything",
  );

  const deliberate = beadsCrud(
    "history",
    "update",
    "t-1",
    "--notes",
    "",
    "--allow-empty",
  );
  assert.equal(
    deliberate.status,
    0,
    `--allow-empty must still clear it:\n${deliberate.stdout}${deliberate.stderr}`,
  );
  assert.equal(deliberate.notesAfter, "");

  // A field that was already empty is not protected by anything, so an
  // empty write to it is not a refusal.
  const wasEmpty = beadsCrud(undefined, "update", "t-1", "--notes", "");
  assert.equal(
    wasEmpty.status,
    0,
    `nothing to erase is not an erasure:\n${wasEmpty.stdout}${wasEmpty.stderr}`,
  );
});

test("beads-crud update --status reopens a closed issue without its closure stamps", () => {
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, ".beads"), { recursive: true });
    const file = join(dir, ".beads", "issues.jsonl");
    writeFileSync(
      file,
      issueLine({ status: "closed", closed_at: "2026-01-02T00:00:00Z", close_reason: "done" }),
    );
    const run = spawnSync(
      process.execPath,
      [join(SCRIPTS, "beads-crud.mjs"), "update", "t-1", "--status", "in_progress"],
      { cwd: dir, encoding: "utf8" },
    );
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const after = JSON.parse(readFileSync(file, "utf8").trim());
    assert.equal(after.status, "in_progress");
    assert.equal(after.closed_at, undefined, "a reopened issue must not keep closed_at");
    assert.equal(after.close_reason, undefined, "a reopened issue must not keep close_reason");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-906: the helper that produces the red-then-green reading ---

/** A repo holding one subject file and one checker script over it. */
function mutateRepo({ subject, tracked = true }) {
  const dir = tempRepo();
  writeFileSync(join(dir, "subject.txt"), subject);
  if (tracked) {
    execFileSync("git", ["add", "--", "subject.txt"], { cwd: dir });
    execFileSync("git", ["commit", "-qm", "subject"], { cwd: dir });
  }
  // Exits 0 while the subject still says GOOD -- so a mutation that
  // changes GOOD is "caught" and one that does not is "uncaught".
  writeFileSync(
    join(dir, "check.mjs"),
    `import { readFileSync } from "node:fs";\n`
      + `process.exit(readFileSync("subject.txt", "utf8").includes("GOOD") ? 0 : 1);\n`,
  );
  return dir;
}

test("mutate exits 0 when the command catches the mutation, and restores the file", () => {
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(r.status, 0, `expected CAUGHT:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /CAUGHT/);
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate exits 1 when the command does not notice the mutation", () => {
  const dir = mutateRepo({ subject: "value = GOOD, note = keep\n" });
  try {
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "keep",
      "--new",
      "drop",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(r.status, 1, `expected UNCAUGHT:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /UNCAUGHT/);
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD, note = keep\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate --expect-exit counts only that exit code as caught", () => {
  // The checker exits 2 (could not answer) on the mutation, as a gate does
  // when it refuses: without --expect-exit that reads CAUGHT; with
  // --expect-exit 1 it is a refusal, and with --expect-exit 2 it is CAUGHT.
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    writeFileSync(
      join(dir, "check.mjs"),
      `import { readFileSync } from "node:fs";\n`
        + `process.exit(readFileSync("subject.txt", "utf8").includes("GOOD") ? 0 : 2);\n`,
    );
    const run = (...extra) =>
      mutate(dir, [
        "--file",
        "subject.txt",
        "--old",
        "GOOD",
        "--new",
        "BAD",
        ...extra,
        "--",
        process.execPath,
        "check.mjs",
      ]);
    const any = run();
    assert.equal(
      any.status,
      0,
      `no --expect-exit: any failure is CAUGHT\n${any.stdout}${any.stderr}`,
    );
    // An exit 2 the caller did not ask for is no reading: a refusal.
    const one = run("--expect-exit", "1");
    assert.equal(
      one.status,
      2,
      `exit 2 under --expect-exit 1 is a refusal\n${one.stdout}${one.stderr}`,
    );
    assert.match(one.stderr, /exited 2 \(could not answer\)/);
    const two = run("--expect-exit", "2");
    assert.equal(two.status, 0, two.stdout + two.stderr);
    assert.match(two.stdout, /^mutate: CAUGHT/m);
    for (const bad of ["0", "0x2", "1e0", "256"]) {
      const r = run("--expect-exit", bad);
      assert.equal(r.status, 2, `--expect-exit ${bad} is refused`);
      assert.match(r.stderr, /--expect-exit must be an exit code from 1 to 255/);
    }
    // Another failing code is a failure, but not the one asked for.
    writeFileSync(
      join(dir, "check.mjs"),
      `import { readFileSync } from "node:fs";\n`
        + `process.exit(readFileSync("subject.txt", "utf8").includes("GOOD") ? 0 : 3);\n`,
    );
    const three = run("--expect-exit", "1");
    assert.equal(three.status, 1, three.stdout + three.stderr);
    assert.match(three.stdout, /UNCAUGHT -- the command failed with exit 3, not the expected 1/);
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses an anchor that is absent or ambiguous, writing nothing", () => {
  // The failure this whole script exists for: a `sed` whose anchor no
  // longer matches leaves the file alone and the suite green, which
  // reads exactly like a test that missed the defect.
  const dir = mutateRepo({ subject: "value = GOOD\nvalue = GOOD\n" });
  try {
    const absent = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "NOT PRESENT",
      "--new",
      "x",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(absent.status, 2, `expected a refusal:\n${absent.stdout}${absent.stderr}`);
    assert.match(absent.stderr, /occurs 0 time\(s\)/);

    const ambiguous = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(ambiguous.status, 2, `expected a refusal on 2 matches`);
    assert.match(ambiguous.stderr, /occurs 2 time\(s\)/);

    // Both refusals wrote nothing, which is the part that matters.
    assert.equal(
      readFileSync(join(dir, "subject.txt"), "utf8"),
      "value = GOOD\nvalue = GOOD\n",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses a no-op replacement", () => {
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "GOOD",
      "--",
      process.execPath,
      "check.mjs",
    ]);
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no-op mutation proves nothing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The three fixtures below pass on the ORIGINAL and act only on the mutated
// text, which is what a real check command does -- and is required since
// mutate takes a baseline reading before mutating (barwise-1019). A fixture
// failing unconditionally trips that refusal instead of reaching the path
// under test.
test("mutate reports a failed restore on an UNTRACKED file, which git diff cannot", () => {
  // barwise-906's acceptance criteria name this case specifically. The
  // instrument that failed was `git diff --stat` on an untracked file:
  // it prints nothing whether the file is pristine or corrupt, so the
  // check that claimed to prove the restore could not have failed.
  // Here the command under test overwrites the subject, which is what a
  // real command that writes its own inputs would do -- and the helper
  // must notice, on a file git does not track.
  const dir = mutateRepo({ subject: "value = GOOD\n", tracked: false });
  try {
    writeFileSync(
      join(dir, "check.mjs"),
      `import { readFileSync, writeFileSync } from "node:fs";\n`
        + `if (!readFileSync("subject.txt", "utf8").includes("BAD")) process.exit(0);\n`
        + `writeFileSync("subject.txt", "SABOTAGED\\n");\n`
        + `process.exit(1);\n`,
    );
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);

    // The command "failed", which alone would read as CAUGHT. The
    // restore check outranks it.
    assert.equal(r.status, 2, `expected a restore refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /RESTORE FAILED/);

    // Proof the file really is untracked, so this test cannot silently
    // become the tracked case that git diff WOULD have caught.
    const lsFiles = execFileSync("git", ["ls-files", "--", "subject.txt"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(lsFiles.trim(), "", "subject.txt must be untracked for this case");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses a command that already fails WITHOUT the mutation [adr:gate-refusal-contract#readers-keep-third]", () => {
  // CAUGHT is decided from the command's exit status alone, so a command
  // that is already red reports CAUGHT for every mutation -- including ones
  // nothing catches. Five readings in PR #505 were recorded that way: the
  // suite exited 1 in any container without shellcheck or gitleaks, and
  // `mutate ... && echo verified` printed verified each time (barwise-1019).
  // The baseline run is what makes CAUGHT mean anything, so it is asserted
  // here rather than trusted.
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    writeFileSync(join(dir, "check.mjs"), `process.exit(3);\n`);
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);

    assert.equal(r.status, 2, `expected refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /already fails \(exit 3\) WITHOUT the mutation/);
    assert.doesNotMatch(r.stdout, /CAUGHT/);

    // And nothing was written: the refusal lands before the mutation.
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses a run whose command was KILLED rather than exiting", async () => {
  // The reading this protects is `mutate ... && echo verified`. The
  // status line used to be `run.status === null ? 1`, so a ctrl-c or a
  // harness timeout SIGTERMing the process group sent the run down the
  // CAUGHT branch: exit 0, "the command failed (exit 1)" naming a code
  // the command never returned, and `verified` printed for a run that
  // verified nothing (barwise-998, finding 1).
  //
  // The child hangs so the kill lands mid-run, which is when a real
  // interruption arrives, and it is the CHILD that is killed rather
  // than mutate itself -- what a timeout killing a process group does
  // to the thing actually executing. The exit status is read from the
  // process object rather than through a pipeline, for the reason the
  // helper itself spawns without a shell.
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  let child;
  let probePid;
  try {
    // The probe records its own pid once the mutated run is executing, and
    // the test signals exactly that process. The kill used to go through
    // `pkill -f` on a marker after waiting only for the mutation on disk:
    // mutate writes the file BEFORE it spawns the run, so on a loaded
    // runner the kill could land in that gap, the probe slept out its 60 s
    // and exited 0, and the run read UNCAUGHT -- exit 1 after 60230 ms in
    // CI (barwise-rfb). The marker also matched mutate's own argv, so
    // pkill signalled mutate too, and its exit status could not tell
    // whether the probe had been reached.
    writeFileSync(
      join(dir, "probe.mjs"),
      `import { readFileSync, renameSync, writeFileSync } from "node:fs";\n`
        + `if (!readFileSync("subject.txt", "utf8").includes("BAD")) process.exit(0);\n`
        // Written whole, then renamed: a half-written file would read as 0,
        // and process.kill(0) signals the whole process group.
        + `writeFileSync("probe-pid.tmp", String(process.pid));\n`
        + `renameSync("probe-pid.tmp", "probe-pid");\n`
        + `setTimeout(() => {}, 60_000);\n`,
    );

    child = spawn(process.execPath, [
      join(SCRIPTS, "mutate.mjs"),
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "probe.mjs",
    ], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });

    let stderr = "";
    child.stderr.on("data", (c) => {
      stderr += String(c);
    });

    const exited = new Promise((res) => child.on("exit", (code) => res(code)));

    // Poll for the probe's pid rather than sleeping: a fixed sleep would
    // only move the race.
    const pidFile = join(dir, "probe-pid");
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline && !existsSync(pidFile)) {
      await new Promise((res) => setTimeout(res, 25));
    }
    assert.ok(existsSync(pidFile), "the mutated run never started, so there is nothing to kill");
    probePid = Number(readFileSync(pidFile, "utf8"));
    assert.ok(Number.isInteger(probePid) && probePid > 0, `not a pid: ${probePid}`);
    process.kill(probePid, "SIGTERM");

    const status = await exited;

    assert.equal(
      status,
      2,
      `a killed run must refuse, not report CAUGHT. stderr:\n${stderr}`,
    );
    assert.match(stderr, /killed by SIGTERM/);

    // The tree is still restored, which is the other half of the
    // guarantee and the reason the `finally` exists.
    assert.equal(readFileSync(join(dir, "subject.txt"), "utf8"), "value = GOOD\n");
  } finally {
    // On a failed assertion above, mutate and its probe may still be
    // running; stop both before removing the directory they work in. Only
    // while mutate runs: once it has exited, so has the probe it waited
    // on, and either pid may already belong to an unrelated process.
    if (child && child.exitCode === null && child.signalCode === null) {
      for (const pid of [probePid, child.pid]) {
        if (!pid) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // Already exited.
        }
      }
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test("mutate refuses, rather than reporting UNCAUGHT, when the restore THROWS", () => {
  // An exception inside restoreOrDie used to propagate, and Node exits
  // 1 on an uncaught throw -- which is this script's UNCAUGHT code. So
  // a command that replaced the target with a directory printed a stack
  // trace and then reported, in the one number a caller reads, that the
  // suite had failed to notice the mutation (barwise-998).
  const dir = mutateRepo({ subject: "value = GOOD\n" });
  try {
    writeFileSync(
      join(dir, "check.mjs"),
      `import { mkdirSync, readFileSync, rmSync } from "node:fs";\n`
        + `if (!readFileSync("subject.txt", "utf8").includes("BAD")) process.exit(0);\n`
        + `rmSync("subject.txt");\n`
        + `mkdirSync("subject.txt");\n`
        + `process.exit(1);\n`,
    );
    const r = mutate(dir, [
      "--file",
      "subject.txt",
      "--old",
      "GOOD",
      "--new",
      "BAD",
      "--",
      process.execPath,
      "check.mjs",
    ]);

    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /RESTORE FAILED/);
    assert.match(r.stderr, /EISDIR|illegal operation on a directory/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every scripts/*.mjs path a skill cites exists", () => {
  // mutation-verification-helper.spec.md claimed `check:book-citations`
  // guarded these, so a rename that missed one would fail a gate. That
  // checker resolves Halpin & Morgan SECTION NUMBERS and knows nothing
  // about file paths, so the citations in session-review/SKILL.md and
  // pr-review/checklist.md were an unguarded must-agree copy
  // (barwise-998, finding 3). This is the guard the spec described.
  const docs = execFileSync("git", ["ls-files", "--", ".claude/skills"], {
    cwd: REPO,
    encoding: "utf8",
  }).split("\n").filter((f) => f.endsWith(".md"));

  const missing = [];
  let cited = 0;
  for (const doc of docs) {
    const text = readFileSync(join(REPO, doc), "utf8");
    for (const m of text.matchAll(/\b((?:barwise\/)?scripts\/[\w./-]*\.mjs)\b/g)) {
      cited++;
      const rel = m[1].startsWith("barwise/") ? m[1] : join("barwise", m[1]);
      if (!existsSync(join(REPO, rel))) missing.push(`${doc}: ${m[1]}`);
    }
  }

  // The denominator beside the count, so an empty result cannot read as
  // "nothing is broken" when the scan has stopped matching anything.
  assert.ok(cited > 0, "no scripts/*.mjs citations found under .claude/skills -- scan broken");
  assert.deepEqual(
    missing,
    [],
    `skill docs cite scripts that do not exist:\n${missing.join("\n")}`,
  );
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
test("audit-spec-status fires on the header that went stale at 7fbbba7", (t) => {
  if (skipIfShallow(t)) return;
  const r = gate("audit-spec-status.mjs", REPO, "--at", "7fbbba7");
  assert.equal(r.status, 0, `--at failed:\n${r.stdout}${r.stderr}`);
  assert.match(
    r.stdout,
    /must-validate-outside-the-rubric\.spec\.md/,
    `the gate did not fire on the defect it exists for:\n${r.stdout}`,
  );
  assert.match(r.stdout, /since: 7fbbba7/, `wrong reason:\n${r.stdout}`);
});

test("audit-spec-status --check is green on the current tree, from every cwd", (t) => {
  // A shallow clone cannot answer this gate's question, and the gate now
  // says so instead of printing OK -- which is how it shipped red once:
  // 309 commits locally against CI's full history. Skipping loudly here
  // is not the silent hole; reporting the smaller question's answer was.
  if (skipIfShallow(t)) return;
  for (const cwd of CWDS) {
    const r = gate("audit-spec-status.mjs", cwd, "--check");
    assert.equal(r.status, 0, `--check failed in ${cwd}:\n${r.stdout}${r.stderr}`);
  }
});

/**
 * The claim regex matched "no implementation" and a leading draft or
 * proposed, and nothing else. Two specs written on 2026-09-06 said
 * "no workstream implemented" and sat outside the gate for a whole
 * workstream's worth of commits; the first PR to land one of them
 * found the hole and said so in its session review (#426). The
 * planted defect is the exact phrasing, on a spec that names a code
 * file a later commit touches: red until the regex knows the phrase.
 */
test("audit-spec-status fires on 'no workstream implemented', the phrasing that escaped", () => {
  const dir = tempRepo();
  try {
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 1;\n");
    stage(
      dir,
      "barwise/docs/specs/x.spec.md",
      "# x\n\nStatus: Design review complete -- no workstream implemented\n\nTouches `packages/core/src/a.ts`.\n",
    );
    execFileSync("git", ["commit", "-qm", "spec"], { cwd: dir });
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 2;\n");
    execFileSync("git", ["commit", "-qm", "ws1 lands"], { cwd: dir });
    const r = gate("audit-spec-status.mjs", dir, "--at", "HEAD");
    assert.equal(r.status, 0, `--at failed:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /x\.spec\.md/, `the gate did not fire on the phrasing:\n${r.stdout}`);
    // A partial claim is a different question (barwise-912) and must not fire.
    stage(
      dir,
      "barwise/docs/specs/x.spec.md",
      "# x\n\nStatus: WS0 complete; WS1-WS8 not implemented\n\nTouches `packages/core/src/a.ts`.\n",
    );
    execFileSync("git", ["commit", "-qm", "status says what shipped"], { cwd: dir });
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 3;\n");
    execFileSync("git", ["commit", "-qm", "more"], { cwd: dir });
    const r2 = gate("audit-spec-status.mjs", dir, "--at", "HEAD");
    assert.equal(r2.status, 0, r2.stdout + r2.stderr);
    assert.match(r2.stdout, /no findings/, `a partial claim fired:\n${r2.stdout}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-spec-status refuses a shallow clone rather than reporting OK", () => {
  const dir = tempRepo();
  try {
    // A repo with no `--unshallow` marker is not shallow, so this makes
    // one the way git does: the guard reads `rev-parse
    // --is-shallow-repository`, which is true exactly when .git/shallow
    // exists.
    writeFileSync(join(dir, ".git", "shallow"), `${"0".repeat(40)}\n`);
    stage(dir, "barwise/docs/specs/x.spec.md", "# x\n\nStatus: draft\n");
    execFileSync("git", ["commit", "-qm", "spec"], { cwd: dir });
    const r = gate("audit-spec-status.mjs", dir, "--check");
    // 2, not 1. Exit 1 is this gate's "a spec header is wrong"; a short
    // history is "could not answer", and the two sent readers to
    // different places (docs/specs/gate-refusal-contract.spec.md).
    assert.equal(r.status, 2, `expected refusal, got:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /shallow clone/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-919: a version pinned in two files is a must-agree copy ---
//
// `check-parity` grew a {file,field} member so a value duplicated across
// JSON files is checked the way a duplicated function already was. The
// motivating drift shipped: package.json said engines.node >=26.0.0
// while package-lock.json, which embeds its own copy, said >=20.0.0, and
// all 25 gates passed over the pair.
//
// The comparison loop itself is unchanged and six existing sets exercise
// it. What is new is the path parser and the value resolution, tested
// directly here -- `root` inside the gate is script-relative by design
// (barwise-905 again), so a fixture repo cannot reach `main()`.

const { parseFieldPath, fieldValue } = await import(
  pathToFileURL(join(SCRIPTS, "check-parity.mjs")).href
);

test("check-parity finds a set it cannot mean without hiding the others, and refuses a manifest it cannot read [adr:must-agree-copies#registered-sets-identical]", () => {
  // The escapes barwise-tdu and barwise-ym8.8nq named: an unknown ignore
  // was silently not applied, an ignore on a symbol or field set was
  // silently ignored, and a set of one (or of one member twice) compared a
  // copy with nothing and passed. Each is now a finding naming its set;
  // the other sets are still compared, so drift elsewhere is not hidden.
  // Members resolve from the repository; only the manifest is a fixture.
  const dir = mkdtempSync(join(tmpdir(), "barwise-parity-"));
  const runWith = (manifest) => {
    const path = join(dir, "manifest.json");
    writeFileSync(path, typeof manifest === "string" ? manifest : JSON.stringify(manifest));
    return gate("check-parity.mjs", REPO, "--manifest", path);
  };
  const same = ["scripts/check-parity.mjs", "scripts/check-parity.mjs"];
  const pair = {
    name: "pair",
    why: "x",
    members: [{ file: "package.json", field: "version" }, {
      file: "packages/core/package.json",
      field: "version",
    }],
  };
  try {
    assert.equal(runWith({ sets: [pair] }).status, 0);
    const r = runWith({
      sets: [
        {
          name: "typo",
          why: "x",
          ignore: "leading-docblok",
          members: ["package.json", "package-lock.json"],
        },
        {
          name: "on-symbol",
          why: "x",
          ignore: "leading-docblock",
          members: [{ file: "a.ts", symbol: "f" }, "b.ts"],
        },
        { name: "thin", why: "x", members: ["package.json"] },
        { name: "twice", why: "x", members: same },
        { name: "drift", why: "x", members: ["package.json", "package-lock.json"] },
      ],
    });
    assert.equal(r.status, 1, r.stdout + r.stderr);
    for (
      const pattern of [
        /set "typo": ignore "leading-docblok" is not one this check applies/,
        /set "on-symbol": ignore applies to whole-file members only/,
        /set "thin": has 1 distinct member\(s\), so it checks nothing/,
        /set "twice": has 1 distinct member\(s\)/,
        /set "drift": package-lock\.json differs from package\.json/,
      ]
    ) {
      assert.match(r.stderr, pattern);
    }
    // An empty sets array names nothing to compare; "0 set(s) ... OK"
    // would be a pass over no input.
    for (
      const unreadable of [
        "{ not json",
        JSON.stringify({ groups: [] }),
        JSON.stringify({ sets: [] }),
      ]
    ) {
      const u = runWith(unreadable);
      assert.equal(u.status, 2, u.stdout + u.stderr);
      assert.match(u.stderr, /cannot answer -- parity\.manifest\.json: /);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("parseFieldPath splits dotted keys and bracketed non-identifiers", () => {
  assert.deepEqual(parseFieldPath("version"), ["version"]);
  assert.deepEqual(parseFieldPath("engines.node"), ["engines", "node"]);
  // npm names the lockfile's root package with the empty string, which
  // is the whole reason the bracket form exists.
  assert.deepEqual(
    parseFieldPath('packages[""].engines.node'),
    ["packages", "", "engines", "node"],
  );
  assert.deepEqual(parseFieldPath('a["b.c"].d'), ["a", "b.c", "d"]);
});

test("fieldValue resolves the pair that actually drifted", () => {
  const declared = fieldValue("package.json", "engines.node");
  const embedded = fieldValue("package-lock.json", 'packages[""].engines.node');
  assert.equal(declared, embedded, "engines.node disagrees between package.json and its lockfile");
  assert.match(declared, /^">=\d+\.\d+\.\d+"$/, `unexpected shape: ${declared}`);
});

test("fieldValue treats a path that no longer resolves as an error", () => {
  // A manifest naming a field nobody writes any more is itself drift, so
  // it must fail rather than compare two undefineds and call them equal.
  assert.throws(
    () => fieldValue("package.json", "engines.nodeVersion"),
    /no value at "engines" -> "nodeVersion"/,
  );
  assert.throws(() => fieldValue("package.json", "version.major"), /no value at/);
});

test("every registered field member still resolves", () => {
  const manifest = JSON.parse(
    readFileSync(join(SCRIPTS, "..", "parity.manifest.json"), "utf8"),
  );
  const fields = manifest.sets.flatMap((s) =>
    s.members.filter((m) => typeof m === "object" && m.field !== undefined)
  );
  assert.ok(fields.length > 0, "no field members registered; this test would pass vacuously");
  for (const m of fields) fieldValue(m.file, m.field);
});

// --- barwise-921: every Python execution resolves from the lockfile ---
//
// The gate exempts nothing (python-uv-widened WS4: uv comes from
// install-uv.sh, not pip), so a fixture repo holds only the project files
// and the planted case.

function pythonUvRepo(files = {}) {
  const dir = tempRepo();
  // The one project every Python run resolves from (python-uv-widened WS3).
  stage(dir, "barwise/pyproject.toml", '[project]\nname = "x"\n');
  stage(dir, "barwise/uv.lock", "version = 1\n");
  for (const [name, contents] of Object.entries(files)) stage(dir, name, contents);
  return dir;
}

/** Run the gate over a fixture repo and drop the repo, as every other
 *  temp-repo test here does. Twelve fixtures per run is twelve leaks. */
function pythonUv(files) {
  const dir = pythonUvRepo(files);
  try {
    return gate("check-python-uv.mjs", dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-python-uv fails the old pip bootstrap of uv as a bare python3 [adr:python-from-the-lockfile#uv-bootstrap]", () => {
  // It was the gate's one ALLOWLIST row until install-uv.sh replaced it; a
  // planted copy must now fail like any other bare interpreter.
  const r = pythonUv({
    ".github/workflows/ci.yml":
      "jobs:\n  ci:\n    steps:\n      - run: |\n          python3 -m pip install --quiet uv==0.12.7\n",
  });
  assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
  assert.match(r.stderr, /\.github\/workflows\/ci\.yml:5 +bare `python3`/);
  assert.doesNotMatch(r.stdout, /OK/);
});

// One planted defect per banned form. A gate verified only in aggregate can
// be blind to a whole rule and still look green.
const VIOLATIONS = [
  ["bare python3 in a script", { "s.sh": "#!/bin/sh\npython3 -c 'print(1)'\n" }, /bare `python3`/],
  ["bare pip in a script", { "s.sh": "#!/bin/sh\npip install requests\n" }, /bare `pip`/],
  [
    "bare interpreter behind an env assignment",
    { "s.sh": "#!/bin/sh\nFOO=1 python -c 'print(1)'\n" },
    /bare `python`/,
  ],
  [
    "child_process interpreter in TypeScript",
    { "a.ts": 'execFileSync("python3", ["-c", "import sys"]);\n' },
    /bare `python3` subprocess/,
  ],
  [
    "uv run --with, the lock bypass",
    { "s.sh": "#!/bin/sh\nuv run --frozen --with sqlglot==27.20.0 python -c ''\n" },
    /--with.*lock bypass/,
  ],
  [
    "uv run --isolated",
    { "s.sh": "#!/bin/sh\nuv run --frozen --isolated python -c ''\n" },
    /--isolated/,
  ],
  ["uv pip", { "s.sh": "#!/bin/sh\nuv pip install requests\n" }, /`uv pip`/],
  [
    "uv run with neither --frozen nor --locked",
    { "s.sh": "#!/bin/sh\nuv run python -c ''\n" },
    /neither --frozen nor --locked/,
  ],
  [
    "PEP 723 inline script metadata",
    { "t.py": '# /// script\n# dependencies = ["sqlglot"]\n# ///\n' },
    /PEP 723/,
  ],
  [
    "bare interpreter in a workflow's single-line `- run:` form",
    { "w.yml": "jobs:\n  a:\n    steps:\n      - run: python3 -m tool\n" },
    /bare `python3`/,
  ],
  [
    "a Python file spawning a bare interpreter",
    { "t.py": 'import subprocess\n\nsubprocess.run(["python3", "-c", "print(1)"])\n' },
    /bare `python3` subprocess/,
  ],
  [
    "uv run --no-project",
    { "s.sh": "#!/bin/sh\nuv run --frozen --no-project python -c ''\n" },
    /--no-project/,
  ],
  ["uvx, which resolves from the index", { "s.sh": "#!/bin/sh\nuvx sqlglot --version\n" }, /uvx/],
  ["uv tool run", { "s.sh": "#!/bin/sh\nuv tool run sqlglot\n" }, /uv tool run/],
  // python-uv-widened WS1: a uv call is parsed, not matched.
  [
    "a global option before run, which hid the whole call",
    { "s.sh": "#!/bin/sh\nuv --quiet run python -V\n" },
    /neither --frozen nor --locked/,
  ],
  [
    "--with behind a global option that takes a value",
    { "s.sh": "#!/bin/sh\nuv --allow-insecure-host h run --frozen --with x python\n" },
    /--with.*lock bypass/,
  ],
  ["-w, --with's short form", { "s.sh": "#!/bin/sh\nuv run --frozen -w x python\n" }, /-w/],
  [
    "--with-editable, caught by prefix",
    { "s.sh": "#!/bin/sh\nuv run --frozen --with-editable ./p python\n" },
    /--with-editable/,
  ],
  [
    "--frozen after the launched command, which uv hands to the script",
    { "s.sh": "#!/bin/sh\nuv run python x.py --frozen\n" },
    /neither --frozen nor --locked/,
  ],
  [
    "UV_NO_PROJECT, --no-project by another name",
    { "s.sh": "#!/bin/sh\nUV_NO_PROJECT=1 uv run --frozen python\n" },
    /UV_NO_PROJECT/,
  ],
  [
    "a .py subprocess list running uv with --with",
    {
      "t.py":
        'import subprocess\n\nsubprocess.run(["uv", "run", "--frozen", "--with", "x", "python"])\n',
    },
    /--with.*lock bypass/,
  ],
  // WS1 code review: forms the first parse missed and the substring check caught.
  [
    "uv in a subshell",
    { "s.sh": "#!/bin/sh\nout=$(uv run --frozen --with x python -V)\n" },
    /--with.*lock bypass/,
  ],
  [
    "--with after a run option the value list does not know",
    { "s.sh": "#!/bin/sh\nuv run --frozen --cache-dir /tmp/c --with x python\n" },
    /--with.*lock bypass/,
  ],
  [
    "a banned flag in global position",
    { "s.sh": "#!/bin/sh\nuv --isolated run --frozen python\n" },
    /--isolated/,
  ],
  [
    "-w with its value attached",
    { "s.sh": "#!/bin/sh\nuv run --frozen -wsqlglot python\n" },
    /-wsqlglot/,
  ],
  [
    "UV_FROZEN=0, which asserts nothing",
    { "s.sh": "#!/bin/sh\nUV_FROZEN=0 uv run python -V\n" },
    /neither --frozen nor --locked/,
  ],
  [
    "uv tool run behind a global option",
    { "s.sh": "#!/bin/sh\nuv -q tool run ruff\n" },
    /uv tool run/,
  ],
  [
    "a uv call inside a JS string",
    { "a.ts": 'execSync("uv run --with sqlglot python x.py");\n' },
    /--with.*lock bypass/,
  ],
];

for (const [name, files, expected] of VIOLATIONS) {
  test(`check-python-uv fails on ${name}`, () => {
    const r = pythonUv(files);
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, expected);
  });
}

test("check-python-uv does not flag a mention inside a quoted string", () => {
  // `echo "== uv sync"` is a heading, not an invocation. Flagging it is how
  // a gate cries wolf on the repo's own error messages and gets disabled.
  const r = pythonUv({ "s.sh": '#!/bin/sh\necho "== uv sync"\nuv sync --frozen\n' });
  assert.equal(r.status, 0, r.stderr);
});

test("check-python-uv does not flag `python` as a language label", () => {
  // packages/code-analysis maps ".py" -> "python". A quoted name alone is
  // not an invocation; the child_process call around it is what matters.
  const r = pythonUv({ "a.ts": 'const LANG = { ".py": "python" } as const;\n' });
  assert.equal(r.status, 0, r.stderr);
});

// The six call sites this rule was written for spell uv as
// `execFileSync("uv", [...UV_PYTHON, "-c", src])`, with the flags in a
// spread const several lines up. A line matcher cannot see that at all --
// deleting "--frozen" from both SqlglotBridge copies passed check:parity
// AND this gate before these cases existed.
const ARGS_ARRAY = [
  [
    "uv args array carrying neither --frozen nor --locked",
    'const UV = ["run", "--only-group", "sqlglot", "python"] as const;\n'
    + 'execFileSync("uv", [...UV, "-c", src]);\n',
    /neither --frozen nor --locked/,
  ],
  [
    "uv args array carrying --with, the lock bypass",
    'const UV = ["run", "--frozen", "--with", "sqlglot==1.0", "python"] as const;\n'
    + 'execFileSync("uv", [...UV, "-c", src]);\n',
    /--with.*lock bypass/,
  ],
  [
    "uv args array carrying --with=, which a whole-literal lookup missed",
    'const UV = ["run", "--frozen", "--with=sqlglot==1.0", "python"] as const;\n'
    + 'execFileSync("uv", [...UV, "-c", src]);\n',
    /--with.*lock bypass/,
  ],
  [
    "uv pip through an args array",
    'execFileSync("uv", ["pip", "install", "sqlglot"]);\n',
    /`uv pip`/,
  ],
];

for (const [name, source, expected] of ARGS_ARRAY) {
  test(`check-python-uv fails on ${name}`, () => {
    const r = pythonUv({ "a.ts": source });
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, expected);
  });
}

// python-uv-widened WS2: files the extension rules did not reach.
const COMMAND_FILES = [
  [
    "a package.json script",
    {
      "package.json": JSON.stringify({ scripts: { opt: "uv run --with x pytest" } }, null, 2)
        + "\n",
    },
    /package\.json:3 .*--with.*lock bypass/,
  ],
  [
    "a Makefile recipe",
    { "Makefile": "test:\n\tpython3 -m pytest\n" },
    /Makefile:2 .*bare `python3`/,
  ],
  [
    "a Makefile recipe behind make's @ prefix",
    { "Makefile": "test:\n\t@python3 -m pytest\n" },
    /Makefile:2 .*bare `python3`/,
  ],
  [
    "a script whose name also keys an earlier object, reported at its own line",
    {
      "package.json": JSON.stringify(
        { contributes: { check: "x" }, scripts: { check: "uv run python -V" } },
        null,
        2,
      ) + "\n",
    },
    /package\.json:6 /,
  ],
  [
    "a git hook, which has no extension",
    { "barwise/.husky/pre-commit": "uv run python -V\n" },
    /barwise\/\.husky\/pre-commit:1 .*neither --frozen nor --locked/,
  ],
];

// python-uv-widened WS3: one project, and nothing else that changes what resolves.
const MANIFESTS = [
  ["a second pyproject.toml", "tools/pyproject.toml"],
  ["a requirements file", "requirements-dev.txt"],
  ["a setup.py", "pkg/setup.py"],
  ["a uv.toml", "barwise/uv.toml"],
  ["a pylock.toml", "pylock.toml"],
  ["a second uv.lock", "tools/uv.lock"],
];

for (const [name, file] of MANIFESTS) {
  test(`check-python-uv fails on ${name}`, () => {
    const r = pythonUv({ [file]: "x\n" });
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, new RegExp(`${file.replace(/\./g, "\\.")}:1 .*Python manifest outside`));
  });
}

test("check-python-uv fails when the project file is not tracked", () => {
  const dir = tempRepo();
  try {
    stage(dir, "barwise/uv.lock", "version = 1\n");
    const r = gate("check-python-uv.mjs", dir);
    assert.equal(r.status, 1, r.stdout);
    assert.match(r.stderr, /barwise\/pyproject\.toml:0 .*not tracked/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-python-uv cannot answer for a package.json it cannot parse, never a clean pass", () => {
  const r = pythonUv({ "package.json": '{ "scripts": { "a": "python3 x.py", } ' });
  assert.equal(r.status, 2, r.stdout + r.stderr);
  assert.match(r.stderr, /cannot answer[\s\S]*package\.json/);
  assert.doesNotMatch(r.stdout, /OK/);
});

for (const [name, files, expected] of COMMAND_FILES) {
  test(`check-python-uv reads ${name}`, () => {
    const r = pythonUv(files);
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, expected);
  });
}

test("check-python-uv passes compliant command files, and names what it does not read", () => {
  const r = pythonUv({
    "package.json": JSON.stringify({ scripts: { opt: "uv run --frozen --extra dev pytest -q" } })
      + "\n",
    "Makefile": "test:\n\tnpm test\n",
    "barwise/.husky/pre-push": "npm run ci:local\n",
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /\.beads\/hooks\/ not read, vendored/);
});

test("UV_SUBCOMMANDS holds every subcommand the installed uv lists", async (t) => {
  // The parser finds a uv call's subcommand by name, so a missing name
  // reads that call as no uv call at all: the list is a copy of uv's CLI
  // that fails open, and it was wrong once when written from memory.
  const help = spawnSync("uv", ["help"], { encoding: "utf8" });
  if (help.error || help.status !== 0) {
    t.skip("uv is not installed here; CI installs it before this suite");
    return;
  }
  const { UV_SUBCOMMANDS } = await import(
    pathToFileURL(join(SCRIPTS, "lib", "python-uv-rules.mjs")).href
  );
  const section = help.stdout.split(/^Commands:$/m)[1]?.split(/^\S/m)[0] ?? "";
  const listed = [...section.matchAll(/^\s{2}([a-z][\w-]*)\s/gm)].map((m) => m[1]);
  assert.ok(listed.length > 10, `could not read uv help:\n${help.stdout}`);
  assert.deepEqual(listed.filter((c) => !UV_SUBCOMMANDS.has(c)), []);
});

test("check-python-uv passes the correct parsed forms", () => {
  // Each of these is right, and each would be wrong under a careless parse:
  // a flag that belongs to the launched program, the env spelling of the
  // assertion, and --frozen beside a value-taking option.
  const r = pythonUv({
    "s.sh": "#!/bin/sh\nUV_FROZEN=1 uv run python -V\n"
      + "uv run --frozen --only-group sqlglot python -c x\nuv --version\n",
    // Prose that mentions uv is not a call (a message in a .ts test file
    // read as `uv ... run` when the parser skipped words to a subcommand).
    "a.ts": 'const MSG = "Install uv to run them.";\n',
  });
  assert.equal(r.status, 0, r.stderr);
});

test("check-python-uv needs no lock flag on a uv call that resolves nothing, and still needs one beside a run", () => {
  const find = pythonUv({
    "a.mjs": 'spawnSync("uv", ["python", "find", "--show-version", "--project", dir]);\n',
  });
  assert.equal(find.status, 0, find.stderr);
  const both = pythonUv({
    "a.mjs": 'spawnSync("uv", ["python", "find", "--show-version"]);\n'
      + 'spawnSync("uv", ["run", "python", "x.py"]);\n',
  });
  assert.equal(both.status, 1, both.stderr);
  assert.match(both.stderr, /neither --frozen nor --locked/);
  // Named by what is safe: a uv subcommand that resolves, such as lock,
  // still needs the flag even with no run or sync beside it.
  const lock = pythonUv({ "a.mjs": 'spawnSync("uv", ["lock"]);\n' });
  assert.equal(lock.status, 1, lock.stderr);
  assert.match(lock.stderr, /neither --frozen nor --locked/);
});

test("check-python-uv passes a compliant uv args array", () => {
  const r = pythonUv({
    "a.ts": 'const UV = ["run", "--frozen", "--only-group", "sqlglot", "python"] as const;\n'
      + 'execFileSync("uv", [...UV, "-c", src]);\n',
  });
  assert.equal(r.status, 0, r.stderr);
});

// --- check-book-citations: every citation resolves against the transcript ---

const CONTENTS = `# contents

\`\`\`
 3  Conceptual Modeling: First Steps                                 59
    3.3  CSDP Step 1: From Examples to Elementary Facts              63
    3.5  CSDP Step 3: Trim Schema; Note Basic Derivations            97
 4  Uniqueness Constraints                                          111
    4.4  External Uniqueness Constraints                            129
 5  Mandatory Roles                                                 159
    5.3  Reference Schemes                                          173
ORM Glossary                                                       1007
\`\`\`
`;

/** A repo with the transcript and one citing card; the gate reads both. */
function bookCitations(card) {
  const dir = tempRepo();
  stage(dir, "barwise/docs/halpin-morgan-3e-contents.md", CONTENTS);
  stage(dir, "barwise/docs/anki/x.txt", `front\tback ${card}\n`);
  try {
    return gate("check-book-citations.mjs", dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check-book-citations passes a citation that resolves, and reports its coverage", () => {
  const r = bookCitations(
    "Read more: Halpin & Morgan 3rd ed. -- ch. 5, section 5.3 (reference schemes).",
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /book citations OK: \d+ citations in 2 files/);
});

// One planted defect per rule. The first is the exact drift the gate was
// written for: a section that exists, glossed with another section's topic.
const BAD_CITATIONS = [
  [
    "a right number with the wrong topic",
    "Halpin & Morgan 3rd ed. -- section 3.5 (reference schemes).",
    /section 3\.5 is "CSDP Step 3: Trim Schema; Note Basic Derivations", but the gloss says \(reference schemes\)/,
  ],
  [
    "a section the book does not have",
    "Halpin & Morgan 3rd ed. -- section 9.9.",
    /section 9\.9 is not in the 3rd ed\. contents/,
  ],
  [
    "a chapter the book does not have",
    "Halpin & Morgan 3rd ed. -- ch. 99 (nothing).",
    /chapter 99 is not in the 3rd ed\. contents/,
  ],
  [
    "a page span that is not the chapter's",
    "Halpin & Morgan 3rd ed. -- ch. 3, pp. 59-111.",
    /chapter 3 spans pp\. 59-110 in the contents, not pp\. 59-111/,
  ],
  [
    "another edition",
    "Halpin & Morgan, Information Modeling (2nd ed.), ch. 3.",
    /cites the 2nd edition/,
  ],
];

for (const [name, card, expected] of BAD_CITATIONS) {
  test(`check-book-citations fails on ${name}`, () => {
    const r = bookCitations(card);
    assert.equal(r.status, 1, `expected red:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, expected);
  });
}

test("check-book-citations leaves a barwise reference after the `;` alone", () => {
  // 3.4 is not in the fixture transcript; after "barwise ARCHITECTURE.md" it is not a book citation.
  const r = bookCitations(
    "Halpin & Morgan 3rd ed. -- ch. 4 (uniqueness); barwise ARCHITECTURE.md sections 3.4-3.5.",
  );
  assert.equal(r.status, 0, r.stderr);
});

test("check-book-citations fails on a book-scoped file that exists but is untracked", () => {
  // The blind spot barwise-906 names, met again while writing the guide:
  // four green runs never read it, because the scan enumerates tracked
  // files and the guide had not been added. Written to disk only, on purpose.
  const dir = tempRepo();
  stage(dir, "barwise/docs/halpin-morgan-3e-contents.md", CONTENTS);
  const guide = join(dir, "barwise/docs/halpin-morgan-3e-reading-guide.md");
  mkdirSync(dirname(guide), { recursive: true });
  writeFileSync(guide, "section 9.9 (nowhere)\n");
  try {
    const r = gate("check-book-citations.mjs", dir);
    assert.equal(r.status, 1, `expected red:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /reading-guide\.md:0  exists but is not tracked/);
    assert.doesNotMatch(r.stderr, /9\.9/, "an untracked file must not be read either");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-book-citations is green on the current tree, from every cwd", () => {
  const runs = CWDS.map((cwd) => ({ cwd, ...gate("check-book-citations.mjs", cwd) }));
  for (const r of runs) assert.equal(r.status, 0, `failed in ${r.cwd}:\n${r.stdout}${r.stderr}`);
  assert.equal(new Set(runs.map((r) => r.stdout.trim())).size, 1, "coverage depends on cwd");
});

// --- barwise-984: an id names one issue, and created_at says which ---------
//
// Five collisions across three sessions. `beads-crud` mints ids from the
// highest in the LOCAL .beads/issues.jsonl, which is stale by construction
// on any branch behind main, so two branches mint the same id for unrelated
// issues. The `duplicate id` rule above catches the merged file while it
// still holds both rows; the damage happens at the RESOLUTION, where union
// by id with the later `updated_at` winning treats a collision as an edit,
// keeps one row and deletes an issue. That resolution produces a file every
// other rule accepts, because both sides are individually valid.
//
// The fixture is a throwaway repo whose `barwise/` is a SYMLINK to this
// one. The gate resolves two things from two different places: the git
// history from `git rev-parse --show-toplevel` (so the temp repo owns the
// branches, the merge base, and the tracker under test) and the Python
// interpreter from `uv run --project <root>/barwise` (so it needs a real
// pyproject and lock, which the temp repo has no business carrying). The
// symlink is what lets those be different answers.

/**
 * A throwaway repo with `main` carrying `mainRows`, and a `feature` branch
 * checked out carrying `branchRows`. Returns its path.
 */
function beadsRepo(mainRows, branchRows, { withMain = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-beadsid-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "gate@test"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "gate"], { cwd: dir });
  symlinkSync(join(REPO, "barwise"), join(dir, "barwise"));
  mkdirSync(join(dir, ".beads"), { recursive: true });
  const write = (rows) => writeFileSync(join(dir, ".beads", "issues.jsonl"), rows.join(""));
  write(mainRows);
  execFileSync("git", ["add", "-A"], { cwd: dir });
  execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
  execFileSync("git", ["branch", "-M", withMain ? "main" : "trunk"], { cwd: dir });
  execFileSync("git", ["checkout", "-qb", "feature"], { cwd: dir });
  write(branchRows);
  return dir;
}

function beadsCheckIn(dir) {
  return spawnSync("bash", [join(SCRIPTS, "check-beads.sh"), "--strict"], {
    cwd: dir,
    encoding: "utf8",
  });
}

test("check-beads fails when an id names a different issue than main's", () => {
  const dir = beadsRepo(
    [issueLine({ id: "t-1", title: "main issue", created_at: "2026-01-01T00:00:00Z" })],
    [issueLine({ id: "t-1", title: "branch issue", created_at: "2026-02-02T00:00:00Z" })],
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 1, `expected a collision error:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /names a DIFFERENT issue on main/);
    // Both titles, because the whole point is that the reader compares them
    // before choosing a resolution -- three times the resolution was chosen
    // without ever seeing the other side's title.
    assert.match(r.stdout, /main issue/);
    assert.match(r.stdout, /branch issue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-beads accepts an ordinary edit to an issue main also has", () => {
  // Guard the guard. `created_at` is the discriminator precisely because a
  // title, a status and a note all change legitimately; a rule keyed on any
  // of those would fail on every second commit and be turned off.
  const dir = beadsRepo(
    [issueLine({ id: "t-1", title: "before", created_at: "2026-01-01T00:00:00Z" })],
    [
      issueLine({
        id: "t-1",
        title: "after, retitled and closed",
        status: "closed",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-03-03T00:00:00Z",
      }),
    ],
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 0, `an edit is not a collision:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /DIFFERENT issue/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-beads notes an issue that was at the merge base and is gone", () => {
  // A warning, not an error: `beads-crud delete` exists and deleting a
  // throwaway is legitimate. What is not legitimate is doing it by accident
  // while resolving a collision, which is what happened, so the reader gets
  // told which issue left and asked which of the two it was.
  const dir = beadsRepo(
    [
      issueLine({ id: "t-1", title: "kept", created_at: "2026-01-01T00:00:00Z" }),
      issueLine({ id: "t-2", title: "vanished", created_at: "2026-01-01T00:00:00Z" }),
    ],
    [issueLine({ id: "t-1", title: "kept", created_at: "2026-01-01T00:00:00Z" })],
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 0, `a deletion is a warning, not an error:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /'t-2' was in the tracker at the merge base and is gone/);
    assert.match(r.stdout, /vanished/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-beads says so out loud when it has no baseline to compare against", () => {
  // The rule that cannot run must not read as the rule that ran and found
  // nothing (docs/specs/gate-refusal-contract.spec.md). A warning rather
  // than a refusal because the gate's other dozen rules still answered --
  // but the line is unconditional, so the reader can tell which reading
  // they got.
  const dir = beadsRepo(
    [issueLine({ id: "t-1", title: "x", created_at: "2026-01-01T00:00:00Z" })],
    [issueLine({ id: "t-1", title: "x", created_at: "2026-01-01T00:00:00Z" })],
    { withMain: false },
  );
  try {
    const r = beadsCheckIn(dir);
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /id-identity check DID NOT RUN/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
