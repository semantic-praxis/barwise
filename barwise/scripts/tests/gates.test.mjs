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
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

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

test("audit-spec-status --check is green on the current tree, from every cwd", (t) => {
  // A shallow clone cannot answer this gate's question, and the gate now
  // says so instead of printing OK -- which is how it shipped red once:
  // 309 commits locally against CI's full history. Skipping loudly here
  // is not the silent hole; reporting the smaller question's answer was.
  const shallow = execFileSync("git", ["rev-parse", "--is-shallow-repository"], {
    cwd: REPO,
    encoding: "utf8",
  }).trim() === "true";
  if (shallow) {
    t.skip("shallow clone: run `git fetch --unshallow` to exercise this gate");
    return;
  }
  for (const cwd of CWDS) {
    const r = gate("audit-spec-status.mjs", cwd, "--check");
    assert.equal(r.status, 0, `--check failed in ${cwd}:\n${r.stdout}${r.stderr}`);
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
    assert.equal(r.status, 1, `expected refusal, got:\n${r.stdout}${r.stderr}`);
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
// The gate's ALLOWLIST names `.github/workflows/ci.yml` and is ratcheted,
// so a fixture repo WITHOUT that bootstrap line fails as stale -- which is
// itself one of the cases below. Every other fixture stages the line, so
// the only variable under test is the planted violation.
const UV_BOOTSTRAP = "          python3 -m pip install --quiet uv==0.12.7\n";

function pythonUvRepo(files = {}) {
  const dir = tempRepo();
  stage(dir, ".github/workflows/ci.yml", `jobs:\n  ci:\n    steps:\n${UV_BOOTSTRAP}`);
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

test("check-python-uv passes a repo whose only Python call is the allowlisted bootstrap", () => {
  const r = pythonUv();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no bare interpreters/);
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
];

for (const [name, files, expected] of VIOLATIONS) {
  test(`check-python-uv fails on ${name}`, () => {
    const r = pythonUv(files);
    assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
    assert.match(r.stderr, expected);
  });
}

test("check-python-uv fails on a STALE allowlist entry, so a fixed site forces its row out", () => {
  // No ci.yml at all: the bootstrap the allowlist exempts no longer exists.
  const dir = tempRepo();
  stage(dir, "README.md", "nothing to see\n");
  const r = gate("check-python-uv.mjs", dir);
  assert.equal(r.status, 1, `expected failure, got:\n${r.stdout}`);
  assert.match(r.stderr, /STALE allowlist entry/);
});

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

test("check-python-uv passes a compliant uv args array", () => {
  const r = pythonUv({
    "a.ts": 'const UV = ["run", "--frozen", "--only-group", "sqlglot", "python"] as const;\n'
      + 'execFileSync("uv", [...UV, "-c", src]);\n',
  });
  assert.equal(r.status, 0, r.stderr);
});
