/**
 * Gate tests: ci-local, the fault matrix and its axes, and run-script-tests.
 *
 * Split from gates.test.mjs (barwise-bbt) so the gate tests run in parallel;
 * why these tests exist at all is the header of gates-helpers.mjs.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { ciLocalLibs } from "./ci-local-files.mjs";
import { gate, REPO, SCRIPTS, stage, tempRepo } from "./gates-helpers.mjs";

// --- barwise-960: a local CI run reports its own tree, and says what broke ---

/**
 * A throwaway checkout shaped like this one, so `ci-local.mjs` finds the
 * things it resolves relative to itself: `../.github/workflows/ci.yml`
 * for the gate list, and `package.json` beside it for the scripts.
 *
 * A throwaway rather than this repo, for one specific reason: `npm run
 * test:scripts` is itself a gate inside `ci:local`, so a test that wrote
 * to the real lock file would corrupt the lock of the run executing it.
 */
function tempCiRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-cilocal-"));
  const root = join(dir, "barwise");
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    [
      "jobs:",
      "  build:",
      "    steps:",
      "      - run: npm ci",
      "      - run: npm run pass",
      "      - run: npm run boom",
      "",
    ]
      .join("\n"),
  );
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({
      name: "fake",
      private: true,
      scripts: { pass: 'node -e ""', boom: "node scripts/boom.mjs" },
    }),
  );
  // The marker is the FIRST line and the filler is longer than the tail
  // the summary prints, so a marker found in the log file could only have
  // come from the log file.
  writeFileSync(
    join(root, "scripts", "boom.mjs"),
    [
      'console.log("MARKER-FIRST-LINE");',
      "for (let i = 1; i <= 200; i++) console.log(`filler ${i}`);",
      "console.log(`COVERAGE_DIR=${process.env.BARWISE_COVERAGE_DIR}`);",
      // `process.exitCode`, never `process.exit()`. console.log to a PIPE is
      // asynchronous, and process.exit() does not flush what is still queued --
      // so this fixture, whose whole job is to have its LAST line read back,
      // silently drops it. Measured on this container: 300 spawns of each form
      // with eight CPU-burning processes alongside, 197 of 300 truncated with
      // process.exit() against 0 of 300 with process.exitCode, identical exit
      // status either way. Idle, both forms are clean 300 of 300, which is why
      // it passed here twice and failed on the third run; a single write before
      // process.exit() survives 400 of 400 under the same load, so the hazard
      // is the queue depth, not the pattern.
      "process.exitCode = 1;",
      "",
    ].join("\n"),
  );
  writeFileSync(join(root, "scripts", "ci-local.mjs"), readFileSync(join(SCRIPTS, "ci-local.mjs")));
  // The gate list itself lives in `lib/ci-gates.mjs`, shared with
  // `fault-matrix.mjs` so two parsers cannot drift over one workflow
  // file. A fixture that copies only the entry point gets ERR_MODULE_
  // NOT_FOUND, which the assertions below report as "the summary must
  // name the log directory" -- true, and about nothing.
  // `lib/changed-class.mjs` likewise: the change classification ci.yml's
  // detect step runs, which ci-local imports to apply the same `if:`s.
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  for (const lib of ciLocalLibs(SCRIPTS)) {
    writeFileSync(join(root, "scripts", "lib", lib), readFileSync(join(SCRIPTS, "lib", lib)));
  }
  return {
    dir,
    root,
    script: join(root, "scripts", "ci-local.mjs"),
    lock: join(root, "node_modules", ".ci-local.lock"),
  };
}

function runCiLocal(repo, ...args) {
  const r = spawnSync(process.execPath, [repo.script, ...args], {
    cwd: repo.dir,
    encoding: "utf8",
  });
  return { ...r, all: `${r.stdout}${r.stderr}` };
}

test("ci-local reports a REFUSED gate apart from a failure, and exits 2 [adr:gate-refusal-contract#readers-keep-third]", () => {
  // The runner was binary -- status 0 or FAIL -- so the two gates that refuse
  // for want of shellcheck and gitleaks in any fresh container read as "3 of
  // 32 gates failed", indistinguishable from a real shellcheck finding or a
  // staged credential. That is the conflation gate-refusal-contract.spec.md
  // exists to remove, committed by the instrument that reports the gates
  // (barwise-1012). Exit 2 rather than 1 so a caller can tell "this tree has a
  // problem" from "this container cannot check everything"; neither prints
  // that all gates passed.
  const repo = tempCiRepo();
  try {
    // Replace the failing gate with a refusing one, so refusal is the ONLY
    // non-zero outcome -- otherwise exit 1 would be correct and this test
    // could not tell the two apart.
    writeFileSync(
      join(repo.root, "scripts", "boom.mjs"),
      'console.error("cannot answer: the tool is absent");\nprocess.exit(2);\n',
    );

    const r = runCiLocal(repo);
    assert.equal(r.status, 2, `expected refusal (2), got ${r.status}:\n${r.all}`);
    assert.match(r.all, /REFUSED/);
    assert.match(r.all, /COULD NOT ANSWER/);
    assert.doesNotMatch(r.all, /gates failed/);
    assert.doesNotMatch(r.all, /All \d+ gates passed/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("ci-local keeps a refusal apart from a failure in the same run [adr:gate-refusal-contract#readers-keep-third]", () => {
  // The test above plants only a refusing gate, so a ci:local that counted
  // a refusal among the failures would pass it. With one of each, the run
  // is a finding (exit 1), the failure count leaves the refusal out, and
  // the refusal is still named (barwise-ym8.aep).
  const repo = tempCiRepo();
  try {
    const ci = join(repo.dir, ".github", "workflows", "ci.yml");
    writeFileSync(ci, readFileSync(ci, "utf8") + "      - run: npm run nope\n");
    const pkg = join(repo.root, "package.json");
    const json = JSON.parse(readFileSync(pkg, "utf8"));
    json.scripts.nope = "node scripts/nope.mjs";
    writeFileSync(pkg, JSON.stringify(json));
    writeFileSync(
      join(repo.root, "scripts", "nope.mjs"),
      'console.error("cannot answer: the tool is absent");\nprocess.exitCode = 2;\n',
    );
    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `a failure beside a refusal is a finding:\n${r.all}`);
    assert.match(r.all, /1 of 3 gates failed/);
    assert.match(r.all, /1 could not answer: run nope/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("the pre-commit secrets step tells a refusal from a found credential (barwise-jha) [adr:gate-refusal-contract#readers-keep-third]", () => {
  // npm stubbed to answer as check:secrets would: 0 clean, 1 a finding,
  // 2 could not answer. The hook used to print "ROTATE it" for all three
  // non-zero outcomes alike.
  const dir = mkdtempSync(join(tmpdir(), "barwise-hooksecrets-"));
  try {
    const run = (status) => {
      writeFileSync(join(dir, "npm"), `#!/bin/sh\nexit ${status}\n`);
      chmodSync(join(dir, "npm"), 0o755);
      return spawnSync("sh", [join(SCRIPTS, "hooks", "check-staged-secrets.sh")], {
        cwd: join(REPO, "barwise"),
        encoding: "utf8",
        env: { ...process.env, PATH: `${dir}:${process.env.PATH ?? ""}` },
      });
    };
    assert.equal(run(0).status, 0);
    const found = run(1);
    assert.equal(found.status, 1, found.stderr);
    assert.match(found.stderr, /ROTATE/);
    const refused = run(2);
    assert.equal(refused.status, 2, refused.stderr);
    assert.match(refused.stderr, /could not answer/);
    assert.doesNotMatch(refused.stderr, /ROTATE|credential-shaped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The log of ONE named gate, selected by name rather than by being the
 * first `full output:` line in the summary. Written that way after a
 * flake: when a second gate also failed, "the first path printed" was
 * the wrong gate's log, and the test failed for a reason unrelated to
 * what it asserts.
 */
function failureLog(r, gate) {
  const dir = /\nLogs: (\S+)/.exec(r.all);
  assert.ok(dir, `the summary must name the log directory:\n${r.all}`);
  const path = join(dir[1], `${gate}.log`);
  assert.ok(
    r.all.includes(`full output: ${path}`),
    `the summary must name ${gate}'s log file:\n${r.all}`,
  );
  return readFileSync(path, "utf8");
}

test("a failing gate's FULL output is on disk, not just the tail printed", () => {
  // The tail is what this printed before barwise-960: 25 lines, which for
  // a turbo run over twelve packages is the summary footer and the npm
  // error banner and never the failing test's name. Diagnosing one such
  // failure cost three separate reproduction runs.
  const repo = tempCiRepo();
  try {
    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `a failing gate must fail the run:\n${r.all}`);
    assert.doesNotMatch(
      r.all,
      /MARKER-FIRST-LINE/,
      "the printed tail must NOT reach the first line -- if it does, this test proves nothing",
    );

    assert.match(
      failureLog(r, "run-boom"),
      /MARKER-FIRST-LINE/,
      "the log must carry output the tail could not reach",
    );
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("each gate runs with BARWISE_COVERAGE_DIR pointed outside the checkout", () => {
  const repo = tempCiRepo();
  try {
    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `the probing gate must fail so its output is kept:\n${r.all}`);
    const dir = /COVERAGE_DIR=(\S+)/.exec(failureLog(r, "run-boom"));
    assert.ok(dir, "the gate must see BARWISE_COVERAGE_DIR set");
    assert.notEqual(dir[1], "undefined", "the variable must reach the gate's environment");
    assert.ok(
      !dir[1].startsWith(repo.dir),
      `coverage must not be written inside the checkout: ${dir[1]}`,
    );
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a second run refuses while a live run holds the lock, and runs no gate", () => {
  const repo = tempCiRepo();
  try {
    mkdirSync(dirname(repo.lock), { recursive: true });
    // This test's own pid: alive by construction, for as long as it takes
    // to assert against it.
    writeFileSync(repo.lock, JSON.stringify({ pid: process.pid, started: "2026-09-08T00:00:00Z" }));

    const r = runCiLocal(repo);
    assert.equal(r.status, 1, `a held lock must refuse:\n${r.all}`);
    assert.match(r.all, new RegExp(`already running: pid ${process.pid}`));
    assert.doesNotMatch(r.stdout, /Running \d+ gates/, "it must refuse BEFORE running any gate");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("a lock whose pid is gone is removed rather than obeyed, and a run releases its own", () => {
  const repo = tempCiRepo();
  try {
    // A pid that has certainly exited: this process waited for it.
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    mkdirSync(dirname(repo.lock), { recursive: true });
    writeFileSync(repo.lock, JSON.stringify({ pid: dead, started: "2026-09-08T00:00:00Z" }));

    const r = runCiLocal(repo);
    assert.match(r.stdout, /Running 2 of 2 gates/, `a stale lock must not stop a run:\n${r.all}`);
    assert.equal(existsSync(repo.lock), false, "a finished run must release its lock");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("BARWISE_COVERAGE_DIR survives Turborepo and redirects a real package's coverage", () => {
  // The half the throwaway tests cannot reach. Turborepo 2 runs tasks in
  // strict env mode, so a variable named nowhere in turbo.json is dropped
  // before the task sees it: measured directly, the first version of this
  // change looked isolated and wrote to packages/learn/coverage anyway.
  // Nothing else asserts where coverage lands, so nothing else would
  // notice that line being removed from turbo.json.
  //
  // `learn` because it is the cheapest package with a real coverage run,
  // and `--force` because a cache hit would prove nothing about the
  // environment the task ran in.
  const dir = mkdtempSync(join(tmpdir(), "barwise-covdir-"));
  const barwise = join(REPO, "barwise");
  try {
    const r = spawnSync("npx", [
      "turbo",
      "run",
      "test:coverage",
      "--filter=@barwise/learn",
      "--force",
    ], {
      cwd: barwise,
      encoding: "utf8",
      env: { ...process.env, BARWISE_COVERAGE_DIR: dir },
    });
    assert.equal(r.status, 0, `the coverage task must pass:\n${r.stdout}${r.stderr}`);
    assert.ok(
      existsSync(join(dir, "learn", "coverage-final.json")),
      `coverage must land under BARWISE_COVERAGE_DIR, not in the package:\n${r.stdout}${r.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- barwise-989 WS3: the fault matrix, and the classifier under it ---
//
// `fault-matrix.mjs` runs every node gate in ci.yml under four
// environment faults and reports which answer, which refuse, and which
// print PASS blind. Its own verdicts need testing for the reason its
// subject does: the interesting verdict (FALSE GREEN) is the one no gate
// in this repository still returns, so a live run cannot exercise it and
// a classifier that never returned it would read exactly as clean.
//
// The end-to-end reading is verified with `npm run mutate` rather than
// here -- planting `process.exit(0)` in `tracked.mjs`'s refusal turns
// five gates into false greens in about a second, and asserting that
// from a test would mean mutating the repository from inside the suite.
// The three mutations and their readings are in
// `docs/specs/gate-refusal-contract.spec.md`.

const fm = await import(pathToFileURL(join(SCRIPTS, "fault-matrix.mjs")).href);
const { ciGates, ciSteps, shouldRun, MATRIX_EXCEPTIONS, TOOL_EXCEPTIONS } = await import(
  pathToFileURL(join(SCRIPTS, "lib", "ci-gates.mjs")).href
);

test("classify: a gate that answers 0 having reached for the broken thing is a false green", () => {
  // The verdict the harness exists for. No gate returns it today, which
  // is exactly why it is asserted here rather than trusted to a live run.
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 0, touched: 1 }).verdict,
    "FALSE GREEN",
  );
  assert.equal(fm.classify({ kind: "instrumented", baseline: 0, exit: 0, touched: 1 }).ok, false);
});

test("classify: refusing is conforming, and never reaching is independence", () => {
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 2, touched: 1 }).verdict,
    "REFUSED",
  );
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 0, touched: 0 }).verdict,
    "INDEPENDENT",
  );
  assert.equal(
    fm.classify({ kind: "instrumented", baseline: 0, exit: 1, touched: 1 }).verdict,
    "CRASHED",
  );
  for (const exit of [0, 2, 1]) {
    assert.equal(
      fm.classify({ kind: "instrumented", baseline: 0, exit, touched: 1 }).refused,
      false,
    );
  }
});

test("classify: on the cwd axis a refusal from one directory is a moved reading", () => {
  // The bug this test exists for. The first draft returned REFUSED
  // before looking at the axis, so mutating `audit-gate`'s `cwd: ROOT`
  // pin away -- the original barwise-987 defect -- produced 0, 0, 2
  // across three directories and scored as conforming. `npm run mutate`
  // said UNCAUGHT; nothing else would have.
  const moved = fm.classify({ kind: "invariant", baseline: 0, exit: 2 });
  assert.equal(moved.verdict, "READING MOVED");
  assert.equal(moved.ok, false);
  assert.equal(fm.classify({ kind: "invariant", baseline: 0, exit: 0 }).verdict, "INVARIANT");
});

test("classify: on a different Node major, refusing is the desired behaviour", () => {
  // The opposite of the cwd axis, which is why the kind is explicit. The
  // Node pin exists so an unpinned runtime does not get to answer
  // (v8 coverage is not portable across majors), so exit 2 is the pin
  // working -- while a DIFFERENT answer is the finding.
  assert.equal(fm.classify({ kind: "refusable", baseline: 0, exit: 2 }).verdict, "REFUSED");
  assert.equal(fm.classify({ kind: "refusable", baseline: 0, exit: 0 }).verdict, "INVARIANT");
  assert.equal(fm.classify({ kind: "refusable", baseline: 0, exit: 1 }).verdict, "READING MOVED");
});

test("classify: a gate already failing unperturbed is unreadable, not conforming", () => {
  // Every fault reading would then be about whatever is already wrong.
  // Scoring those rows as conforming is the harness committing the
  // defect it audits, and it is not hypothetical: `check-shell` is in
  // this state in any container without shellcheck.
  for (const kind of ["instrumented", "invariant", "refusable"]) {
    const r = fm.classify({ kind, baseline: 1, exit: 2, touched: 0 });
    assert.equal(r.verdict, "UNREADABLE", `kind ${kind}`);
    assert.equal(r.refused, true, `kind ${kind}`);
    assert.equal(r.ok, false, `kind ${kind}`);
  }
});

test("classify: an axis with no kind is refused rather than scored", () => {
  // A new axis added without a kind would otherwise be judged by
  // whichever branch came first. That is how the cwd bug above got in,
  // so the default case refuses instead of guessing.
  assert.throws(
    () => fm.classify({ kind: "wrong-node", baseline: 0, exit: 0 }),
    /unknown axis kind/,
  );
});

test("fault-matrix resolves a ci.yml step to the node gate it runs", () => {
  const scripts = {
    "check:no-nul": "node scripts/check-no-nul.mjs",
    "audit:specs": "node scripts/audit-spec-status.mjs",
    "fmt:check": "dprint check && node scripts/fmt-root.mjs --check",
    lint: "turbo run lint",
  };
  assert.deepEqual(fm.resolveNodeGate("run check:no-nul", scripts), {
    name: "check:no-nul",
    script: "scripts/check-no-nul.mjs",
    args: [],
  });
  // CI's own spelling of the ratchet mode. Reading package.json's
  // default instead is not a detail: `audit:specs` without `--check`
  // REGENERATES the baseline, and an ad-hoc probe that did exactly that
  // replaced five classified rows with "TODO: classify" and reported a
  // clean run.
  assert.deepEqual(fm.resolveNodeGate("run audit:specs -- --check", scripts), {
    name: "audit:specs",
    script: "scripts/audit-spec-status.mjs",
    args: ["--check"],
  });
  // A compound script: the third-party half is out of scope, the node
  // half is the gate.
  assert.deepEqual(fm.resolveNodeGate("run fmt:check", scripts), {
    name: "fmt:check",
    script: "scripts/fmt-root.mjs",
    args: ["--check"],
  });
  assert.equal(fm.resolveNodeGate("run lint", scripts), null);
  assert.equal(fm.resolveNodeGate("run --workspace=@barwise/cli bundle", scripts), null);
  assert.equal(fm.resolveNodeGate("run does-not-exist", scripts), null);
});

test("fault-matrix refuses an npm script that chains two node gates", () => {
  // One exit code cannot be attributed to two gates, and taking the
  // first would leave the second silently unaudited -- which is the
  // class of thing this harness is for.
  assert.throws(
    () =>
      fm.resolveNodeGate("run both", {
        both: "node scripts/check-no-nul.mjs && node scripts/check-shell.mjs",
      }),
    /runs 2 node gates/,
  );
});

test("every node gate CI runs is a script that exists", () => {
  // The self-updating half of "when a new gate is added, place it under
  // the same contract": the list comes from ci.yml, so a gate added to
  // CI is in the matrix the same day. This asserts the derivation still
  // lands on real files -- a renamed script would otherwise show up as a
  // spawn failure inside a fault reading, where it reads as a finding
  // about the fault rather than a typo.
  const scripts = JSON.parse(
    readFileSync(join(REPO, "barwise", "package.json"), "utf-8"),
  ).scripts;
  const gates = fm.nodeGates(ciGates(), scripts);
  assert.ok(gates.length >= 10, `expected the node gates from ci.yml, got ${gates.length}`);
  for (const g of gates) {
    assert.ok(
      existsSync(join(REPO, "barwise", g.script)),
      `${g.name} runs ${g.script}, which does not exist`,
    );
  }
  // fmt-root only became a gate this month, and it is reached through a
  // compound npm script -- the one shape a naive parse drops.
  assert.ok(
    gates.some((g) => g.script === "scripts/fmt-root.mjs"),
    "the compound `fmt:check` script must still resolve to its node half",
  );
});

test("a ci.yml step whose npm script starts a node gate resolves to it, so the matrix cannot drop it unseen", () => {
  // gate-contract-enforced WS2. The matrix's reach is resolveNodeGate's: a
  // script it cannot parse (a prefix, an env assignment, a pipe) is read as
  // "not a node gate" and silently left out. So every step whose script runs
  // `node scripts/...` must resolve; the only way out of the matrix is a
  // named MATRIX_EXCEPTIONS entry, and every name there is a node gate
  // ci.yml runs, with its reason.
  const scripts = JSON.parse(
    readFileSync(join(REPO, "barwise", "package.json"), "utf-8"),
  ).scripts;
  const steps = ciGates();
  const resolved = new Map();
  for (const step of steps) {
    const name = step.slice(4).split(" -- ")[0].trim();
    const gate = fm.resolveNodeGate(step, scripts);
    if (gate !== null) resolved.set(gate.name, gate);
    else if (step.startsWith("run ") && /(^|[\s;&|])node\s+scripts\//.test(scripts[name] ?? "")) {
      assert.fail(`${name} runs a node gate (${scripts[name]}) that the matrix cannot resolve`);
    }
  }
  for (const [name, reason] of Object.entries(MATRIX_EXCEPTIONS)) {
    assert.ok(resolved.has(name), `MATRIX_EXCEPTIONS names ${name}, not a node gate ci.yml runs`);
    assert.ok(reason.length > 20, `${name} needs its reason`);
  }
  const run = new Set(fm.nodeGates(steps, scripts).map((g) => g.name));
  const all = new Set(fm.nodeGates(steps, scripts, { all: true }).map((g) => g.name));
  for (const name of Object.keys(MATRIX_EXCEPTIONS)) {
    assert.ok(!run.has(name), `${name} is on MATRIX_EXCEPTIONS but the matrix runs it`);
    assert.ok(all.has(name), `--all does not bring ${name} back`);
  }
  assert.ok(!all.has("fault-matrix"), "the matrix never runs itself, --all included");
});

test("the fault matrix runs last in CI, on pull requests that are not docs-only, with CI's BASE_SHA", () => {
  // Option D (owner, 2026-11-06). ci:local reads the same step and guard,
  // so pre-push runs it on the same changes. Pull requests only, with the
  // base the PR-only gates read: on a push to main those gates do not run,
  // and the matrix would run them with no base.
  const steps = ciSteps();
  const at = steps.findIndex((s) => s.args === "run fault-matrix");
  assert.ok(at >= 0, "ci.yml runs npm run fault-matrix");
  assert.equal(at, steps.length - 1, "the matrix is the last npm step, after every gate it reads");
  const { condition } = steps[at];
  assert.match(condition, /github\.event_name == 'pull_request'/);
  assert.deepEqual(shouldRun(condition, { docsOnly: false, optimizer: false }), {
    run: true,
    understood: true,
  });
  assert.deepEqual(shouldRun(condition, { docsOnly: true, optimizer: false }), {
    run: false,
    understood: true,
  });
  const workflow = readFileSync(join(REPO, ".github", "workflows", "ci.yml"), "utf-8");
  const block = workflow.slice(workflow.indexOf("run: npm run fault-matrix"));
  assert.match(block, /BASE_SHA: \$\{\{ steps\.base\.outputs\.sha \}\}/);
});

// --- fault-matrix-axes WS1: the tool axis -----------------------------------
//
// The axis deletes one wrapper from a PATH of logging wrappers and reruns
// the gate. These cases drive it with fixture gates and a fixture tool,
// because no real gate continues without a tool: the verdict that matters,
// FALSE GREEN, is again the one a live run cannot produce.

/** A fixture tool on its own bin directory, a farm over it, and gates to run. */
function toolFixture(gates) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-toolaxis-"));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "fixturetool"), "#!/bin/sh\nexit 0\n");
  chmodSync(join(bin, "fixturetool"), 0o755);
  const made = {};
  for (const [name, source] of Object.entries(gates)) {
    made[name] = { script: `fixture/${name}.mjs`, file: join(dir, `${name}.mjs`), args: [] };
    writeFileSync(made[name].file, source);
  }
  writeFileSync(
    join(dir, "package.json"),
    JSON.stringify({ scripts: { probe: "env > /dev/null" } }),
  );
  const farm = fm.buildFarm({ path: `${bin}${delimiter}${process.env.PATH}` });
  return {
    dir,
    farm,
    gates: made,
    cleanup() {
      rmSync(dir, { recursive: true, force: true });
      rmSync(farm.dir, { recursive: true, force: true });
    },
  };
}

/** A fixture gate that calls `fixturetool` and exits `whenMissing` if it is gone. */
const callsTool = (whenMissing) =>
  `import { spawnSync } from "node:child_process";\n`
  + `const r = spawnSync("fixturetool");\n`
  + `process.exit(r.error?.code === "ENOENT" ? ${whenMissing} : 0);\n`;

const verdictOf = (reading, record) =>
  fm.classify({ kind: "instrumented", baseline: record.status, ...reading }).verdict;

test("tool axis: a gate that carries on without its tool is a false green, a crash and a refusal are read as such", () => {
  const fx = toolFixture({
    greedy: callsTool(0),
    crashes: callsTool(1),
    refuses: callsTool(2),
    never: "process.exit(0);\n",
  });
  try {
    const verdicts = {};
    for (const [name, gate] of Object.entries(fx.gates)) {
      const a = fm.toolAxis(gate, fx.farm);
      assert.equal(a.record.status, 0, `${name} must pass unperturbed on the farm`);
      verdicts[name] = a.readings.map((r) => [r.axis, verdictOf(r, a.record)]);
    }
    assert.deepEqual(verdicts.greedy, [["tool-fixturetool", "FALSE GREEN"]]);
    assert.deepEqual(verdicts.crashes, [["tool-fixturetool", "CRASHED"]]);
    assert.deepEqual(verdicts.refuses, [["tool-fixturetool", "REFUSED"]]);
    // A gate that never calls the tool has no reading to take: nothing
    // is perturbed, so nothing can be scored as having ignored it.
    assert.deepEqual(verdicts.never, []);
  } finally {
    fx.cleanup();
  }
});

test("tool axis: a tool probed only by `command -v` is invisible to the wrappers and is listed by the source grep", () => {
  // The wrapper logs on exec. A probe that never execs leaves the axis
  // with nothing to perturb, so the gate reads as reaching no tool even
  // though it would answer wrongly with the tool gone; the grep is the
  // listing that says so, and is not a gate.
  const source = `import { spawnSync } from "node:child_process";\n`
    + `const r = spawnSync("sh", ["-c", "command -v fixturetool"]);\n`
    + `process.exit(0);\n`;
  const fx = toolFixture({ probes: source });
  try {
    const a = fm.toolAxis(fx.gates.probes, fx.farm);
    assert.equal(a.record.status, 0);
    assert.deepEqual([...a.raw.keys()], [], "an exec-less probe is not a reach");
    assert.deepEqual(a.readings, []);
    assert.deepEqual(fm.unseenToolReach(fx.gates.probes.file), ["command -v"]);
    assert.deepEqual(fm.unseenToolReach(join(SCRIPTS, "check-no-nul.mjs")), []);
  } finally {
    fx.cleanup();
  }
});

test("tool axis: only the gate's own calls count, so a tool npm calls beneath it is not perturbed", () => {
  // npm runs its script through `sh -c`, and the script calls `env`. Deleting
  // `env` crashes npm, not the gate: counted, it would read as a CRASHED
  // finding about a tool the gate never chose. Remove the parent-pid
  // filter in reachedTools and `env` appears here.
  const source = `import { spawnSync } from "node:child_process";\n`
    + `const r = spawnSync("npm", ["run", "--silent", "probe"], { cwd: ${
      JSON.stringify("__DIR__")
    } });\n`
    + `process.exit(r.status);\n`;
  const fx = toolFixture({});
  try {
    const gate = { script: "fixture/via-npm.mjs", file: join(fx.dir, "via-npm.mjs"), args: [] };
    writeFileSync(gate.file, source.replace("__DIR__", fx.dir));
    const a = fm.toolAxis(gate, fx.farm);
    assert.equal(a.record.status, 0, `${a.record.stdout}${a.record.stderr}`);
    assert.deepEqual([...a.raw.keys()], ["npm"]);
    assert.ok(
      fm.readFarmLog(fx.farm).some((e) => e.name === "env"),
      "the fixture must really make the transitive call, or this proves nothing",
    );
  } finally {
    fx.cleanup();
  }
});

test("tool axis: reachedTools keeps the gate's own non-base calls and drops the rest", () => {
  const log = [
    { ppid: 10, name: "shellcheck" },
    { ppid: 10, name: "shellcheck" },
    { ppid: 10, name: "git" },
    { ppid: 10, name: "node" },
    { ppid: 10, name: "sh" },
    { ppid: 99, name: "env" },
  ];
  assert.deepEqual([...fm.reachedTools(log, 10)], [["shellcheck", 2]]);
});

test("tool axis: a farm whose git wrapper logs nothing is refused, not read as a clean matrix", () => {
  // A wrapper that cannot log is the instrument being blind, and blind
  // reads as "no gate reaches any tool": every row INDEPENDENT.
  const dir = mkdtempSync(join(tmpdir(), "barwise-blindfarm-"));
  try {
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(join(dir, "git"), `#!/bin/sh\nexec ${JSON.stringify(real)} "$@"\n`);
    chmodSync(join(dir, "git"), 0o755);
    const farm = { dir, log: join(dir, ".calls.log"), names: new Set(["git"]) };
    writeFileSync(farm.log, "");
    assert.throws(() => fm.farmCanary(farm), /instrument is blind/);
    const working = fm.buildFarm();
    try {
      fm.farmCanary(working);
    } finally {
      rmSync(working.dir, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tool axis: a TOOL_EXCEPTIONS name no gate reaches is stale, and every entry carries its reason", () => {
  assert.deepEqual(
    fm.staleToolExceptions({ ghost: "reason", npm: "reason" }, [new Map([["npm", 1]])]),
    ["ghost"],
  );
  assert.deepEqual(fm.staleToolExceptions({}, [new Map([["npm", 1]])]), []);
  for (const [name, reason] of Object.entries(TOOL_EXCEPTIONS)) {
    assert.ok(reason.length > 20, `${name} needs its reason`);
  }
});

// --- fault-matrix-axes WS2: the write axis ----------------------------------
//
// Every pass runs under scripts/lib/write-recorder.mjs, and a write into the
// tree is a finding (WROTE TREE), recorded against the gate while the run
// goes on. These cases drive the whole script, because the behaviour under
// test is its exit path: a fixture checkout holds a copy of the matrix and
// two or three fixture gates, so the verdict that matters is again one the
// real gates cannot produce.

test("classify: any write, from either signal, is a finding, and is judged even for an unreadable gate [adr:gate-refusal-contract#no-writes]", () => {
  assert.equal(fm.classify({ kind: "clean", baseline: 0, touched: 0 }).verdict, "CLEAN");
  const wrote = fm.classify({ kind: "clean", baseline: 0, touched: 1 });
  assert.equal(wrote.verdict, "WROTE TREE");
  assert.equal(wrote.ok, false);
  assert.equal(wrote.refused, false, "a write is a finding (exit 1), not a refusal (exit 2)");
  // A gate whose unperturbed run fails may still have written: the baseline
  // does not gate this verdict.
  assert.equal(fm.classify({ kind: "clean", baseline: 1, touched: 3 }).verdict, "WROTE TREE");
  assert.equal(fm.classify({ kind: "clean", baseline: 1, touched: 0 }).verdict, "CLEAN");
});

/**
 * A fixture checkout (`<tmp>/<name with a space>/barwise/scripts`) holding a
 * copy of the matrix, its one library and the recorder, a git history, and
 * the named gates. The matrix finds its root from its own location, so the
 * fixture is its root.
 */
function matrixFixture(gates, { recorder } = {}) {
  const parent = mkdtempSync(join(tmpdir(), "barwise-matrix-"));
  const dir = join(parent, "the repo");
  const scripts = join(dir, "barwise", "scripts");
  mkdirSync(join(scripts, "lib"), { recursive: true });
  mkdirSync(join(dir, "barwise", "packages", "core"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  for (const f of ["fault-matrix.mjs", "lib/ci-gates.mjs", "lib/write-recorder.mjs"]) {
    writeFileSync(join(scripts, f), readFileSync(join(SCRIPTS, f)));
  }
  if (recorder !== undefined) writeFileSync(join(scripts, "lib", "write-recorder.mjs"), recorder);
  const names = Object.keys(gates);
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    ["jobs:", "  ci:", "    steps:", ...names.map((n) => `      - run: npm run ${n}`), ""].join(
      "\n",
    ),
  );
  writeFileSync(
    join(dir, "barwise", "package.json"),
    JSON.stringify({
      name: "fixture",
      private: true,
      scripts: Object.fromEntries(names.map((n) => [n, `node scripts/${n}.mjs`])),
    }),
  );
  for (const [n, source] of Object.entries(gates)) writeFileSync(join(scripts, `${n}.mjs`), source);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "matrix@test");
  git("config", "user.name", "matrix");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return {
    dir,
    run: (...args) =>
      spawnSync(process.execPath, [join(scripts, "fault-matrix.mjs"), ...args], {
        cwd: join(dir, "barwise"),
        encoding: "utf8",
        env: process.env,
      }),
    cleanup: () => rmSync(parent, { recursive: true, force: true }),
  };
}

/** A fixture gate that writes `file` under the checkout root, and removes it if `undo`. */
const writesRoot = (file, { undo }) =>
  `import { rmSync, writeFileSync } from "node:fs";\n`
  + `import { join } from "node:path";\n`
  + `const p = join(import.meta.dirname, "..", "..", ${JSON.stringify(file)});\n`
  + `writeFileSync(p, "x");\n${undo ? "rmSync(p);\n" : ""}`;

const CLEAN_GATE = "process.exit(0);\n";

test("a gate that writes and removes a probe is a finding only the recorder can see [adr:gate-refusal-contract#no-writes]", () => {
  // `git status --porcelain` is clean after this gate (barwise-w43's shape),
  // so on the old exit path it passed. Only the log has the write.
  const fx = matrixFixture({
    "gate-undone": writesRoot("probe.tmp", { undo: true }),
    "gate-clean": CLEAN_GATE,
  });
  try {
    const r = fx.run("--only", "gate-");
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, `a write is a finding, exit 1:\n${all}`);
    assert.match(all, /FINDING\s+scripts\/gate-undone\.mjs under writes: WROTE TREE/);
    assert.match(all, /writeFileSync [^;]*probe\.tmp/);
    assert.doesNotMatch(all, /git status --porcelain (changed|before)/, "the tree was clean");
    assert.match(all, /scripts\/gate-clean\.mjs .*writes=CLEAN/);
    assert.doesNotMatch(all, /FINDING\s+scripts\/gate-clean/);
  } finally {
    fx.cleanup();
  }
});

test("a persisted write is charged to the gate that made it, the run goes on to read the next gate, and the exit is 1 not 2 [adr:gate-refusal-contract#no-writes]", () => {
  // It was a refusal that stopped the run at the first dirty tree (exit 2),
  // so every gate after it went unread. The root's path holds a space, which
  // an unquoted path in NODE_OPTIONS would split.
  const fx = matrixFixture({
    "gate-persists": writesRoot("persisted.txt", { undo: false }),
    "gate-after": CLEAN_GATE,
  });
  try {
    const r = fx.run("--only", "gate-");
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, all);
    assert.match(all, /FINDING\s+scripts\/gate-persists\.mjs under writes: WROTE TREE/);
    assert.match(all, /git status --porcelain changed/);
    assert.match(all, /\?\? persisted\.txt/, "the before and after sets are printed");
    // The later gate ran, read clean, and was not charged with the earlier
    // gate's file: its own start is the earlier gate's end.
    assert.match(all, /scripts\/gate-after\.mjs .*writes=CLEAN/);
    assert.doesNotMatch(all, /FINDING\s+scripts\/gate-after/);
    assert.match(all, /1 findings/);
  } finally {
    fx.cleanup();
  }
});

test("a finding outranks an unreadable gate, as every finding does, and both are named [adr:gate-refusal-contract#no-writes]", () => {
  // The spec's sentence says "2 wins, as today", but today a finding wins
  // (the file header says why: it is the more actionable of the two), and
  // the same sentence says the matrix "exits 1 if any finding exists".
  const fx = matrixFixture({
    "gate-persists": writesRoot("persisted.txt", { undo: false }),
    "gate-broken": "process.exit(1);\n",
  });
  try {
    const r = fx.run("--only", "gate-");
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, all);
    assert.match(all, /FINDING\s+scripts\/gate-persists\.mjs under writes: WROTE TREE/);
    assert.match(all, /UNREADABLE scripts\/gate-broken\.mjs/);
  } finally {
    fx.cleanup();
  }
});

test("a gate that is unreadable and also writes is still charged with the write [adr:gate-refusal-contract#no-writes]", () => {
  const fx = matrixFixture({
    "gate-broken": writesRoot("persisted.txt", { undo: false }) + "process.exit(1);\n",
  });
  try {
    const r = fx.run("--only", "gate-");
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 1, all);
    assert.match(all, /FINDING\s+scripts\/gate-broken\.mjs under writes: WROTE TREE/);
  } finally {
    fx.cleanup();
  }
});

test("a gate that writes nothing leaves the matrix clean, and only temp writes outside the root do not count [adr:gate-refusal-contract#no-writes]", () => {
  const fx = matrixFixture({
    "gate-temp": `import { mkdtempSync, rmSync } from "node:fs";\n`
      + `import { tmpdir } from "node:os";\nimport { join } from "node:path";\n`
      + `rmSync(mkdtempSync(join(tmpdir(), "gate-temp-")), { recursive: true });\n`,
  });
  try {
    const r = fx.run("--only", "gate-");
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 0, all);
    assert.match(all, /writes=CLEAN/);
  } finally {
    fx.cleanup();
  }
});

test("a recorder that logs nothing refuses the run instead of reading every gate as clean [adr:gate-refusal-contract#no-writes]", () => {
  const fx = matrixFixture({ "gate-clean": CLEAN_GATE }, {
    recorder: "// loads, records nothing\n",
  });
  try {
    const r = fx.run("--only", "gate-");
    const all = `${r.stdout}${r.stderr}`;
    assert.equal(r.status, 2, all);
    assert.match(all, /instrument is blind/);
    assert.doesNotMatch(all, /writes=CLEAN/);
  } finally {
    fx.cleanup();
  }
});

test("ci-local shows a matrix exit 1 as FAIL and keeps REFUSED for exit 2 [adr:gate-refusal-contract#no-writes]", () => {
  const repo = tempCiRepo();
  try {
    const ci = join(repo.dir, ".github", "workflows", "ci.yml");
    writeFileSync(ci, readFileSync(ci, "utf8").replace("npm run boom", "npm run fault-matrix"));
    const pkg = join(repo.root, "package.json");
    const json = JSON.parse(readFileSync(pkg, "utf8"));
    delete json.scripts.boom;
    json.scripts["fault-matrix"] = "node scripts/boom.mjs";
    writeFileSync(pkg, JSON.stringify(json));
    writeFileSync(
      join(repo.root, "scripts", "boom.mjs"),
      'console.log("FINDING scripts/x.mjs under writes: WROTE TREE");\nprocess.exitCode = 1;\n',
    );
    const r = runCiLocal(repo);
    assert.equal(r.status, 1, r.all);
    assert.match(r.all, /fault-matrix\s+FAIL/);
    assert.doesNotMatch(r.all, /REFUSED/);
    assert.doesNotMatch(r.all, /COULD NOT ANSWER/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

/*
 * ---------------------------------------------------------------------------
 * run-script-tests: a run that did not finish must not read as one that did.
 *
 * `node --test` reports the tests that REGISTERED, and `test()` registers as
 * the module executes -- so a module-scope failure partway down a file drops
 * every test below it and still prints a complete-looking summary. Measured on
 * this repository's own suite: plain `node --test` said
 * `tests 117 / pass 116 / fail 1` with one test silently not existing, where
 * the manifest says 118 (barwise-1027,
 * docs/specs/test-run-completeness.spec.md).
 * ---------------------------------------------------------------------------
 */

/** A throwaway repo holding gate-test files and (optionally) a count manifest. */
function testRunRepo(files, counts) {
  const dir = tempRepo();
  for (const [name, body] of Object.entries(files)) {
    stage(dir, `barwise/scripts/tests/${name}`, body);
  }
  if (counts !== undefined) {
    stage(
      dir,
      "barwise/scripts/tests/expected-counts.json",
      JSON.stringify({ $comment: "test", counts }, null, 2) + "\n",
    );
  }
  return dir;
}

const TWO_PASSING = 'import { test } from "node:test";\n'
  + 'test("one", () => {});\ntest("two", () => {});\n';

// Three registered, a module-scope throw, then two that never register. The
// measured shape: the runner reports 4 (three plus the file's own failure).
const TRUNCATES = 'import { test } from "node:test";\n'
  + 'test("t1", () => {});\ntest("t2", () => {});\ntest("t3", () => {});\n'
  + 'await import("node:nonexistent-module-xyz");\n'
  + 'test("t4", () => {});\ntest("t5", () => {});\n';

const ONE_FAILING = 'import { test } from "node:test";\n'
  + 'import assert from "node:assert/strict";\n'
  + 'test("passes", () => {});\ntest("fails", () => { assert.equal(1, 2); });\n';

test("run-script-tests passes when every count matches", () => {
  const dir = testRunRepo({ "a.test.mjs": TWO_PASSING }, { "a.test.mjs": 2 });
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 0, `expected a pass:\n${r.stdout}${r.stderr}`);
    assert.match(r.stdout, /every count matching the manifest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests REFUSES when registration stopped early", () => {
  // The whole point. node --test exits 1 here with a plausible summary; the
  // difference is that this says the run was incomplete and by how much.
  const dir = testRunRepo({ "a.test.mjs": TRUNCATES }, { "a.test.mjs": 6 });
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 2, `expected a refusal (2):\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /a\.test\.mjs/);
    assert.match(r.stderr, /manifest says 6/);
    assert.match(r.stderr, /describe a different suite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests FAILS, not refuses, when the counts match and a test fails", () => {
  // The distinction the third exit code exists for: this run answered the
  // question and the answer was no. Reporting 2 here would be as wrong as
  // reporting 1 for the truncation above.
  const dir = testRunRepo({ "a.test.mjs": ONE_FAILING }, { "a.test.mjs": 2 });
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 1, `expected a failure (1):\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /1 failing of 2, all counts verified/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests refuses when the manifest is absent", () => {
  const dir = testRunRepo({ "a.test.mjs": TWO_PASSING }, undefined);
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no manifest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests refuses a file the manifest does not name", () => {
  // Otherwise a new file's tests run unchecked, which is the blind spot this
  // gate exists to close rather than relocate.
  const dir = testRunRepo(
    { "a.test.mjs": TWO_PASSING, "b.test.mjs": TWO_PASSING },
    { "a.test.mjs": 2 },
  );
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /b\.test\.mjs: not in the manifest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests refuses a manifest row whose file is gone", () => {
  // The stale-entry half, matching audit:duplication and audit:corrections: a
  // deleted suite must not leave a row that quietly describes nothing.
  const dir = testRunRepo(
    { "a.test.mjs": TWO_PASSING },
    { "a.test.mjs": 2, "deleted.test.mjs": 9 },
  );
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /deleted\.test\.mjs: in the manifest but no longer on disk/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests --write refuses to record a truncated run", () => {
  // The barwise-1026 shape, one file over: a writer that records whatever ran
  // would bake the short count in and the manifest would then certify the very
  // truncation it exists to detect.
  const dir = testRunRepo({ "a.test.mjs": TRUNCATES }, undefined);
  try {
    const r = gate("run-script-tests.mjs", dir, "--write");
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /refusing to record counts/);
    assert.ok(
      !existsSync(join(dir, "barwise/scripts/tests/expected-counts.json")),
      "no manifest may be written from a run that did not come back clean",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests refuses an empty suite rather than reporting a pass", () => {
  // Zero files means zero failures means green, over a suite nobody ran --
  // the same empty-corpus reading audit-corrections refuses.
  const dir = testRunRepo({}, {});
  try {
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 2, `expected a refusal:\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no \*\.test\.mjs found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests counts correctly despite a reporter forced through NODE_OPTIONS", () => {
  // The defect CI caught, generalised. This script reads TAP's `# tests N`,
  // and the child's reporter is not something the environment gets to choose:
  // CI printed the spec reporter's `i tests N` instead, because CI runs the
  // Node `.nvmrc` pins (26) and the default reporter differs from the Node this
  // was developed on (22). Every healthy suite then read as "printed no
  // summary".
  //
  // So the wrapper forces `--test-reporter=tap` and strips any inherited one.
  // Stripping rather than overriding matters: the flag ACCUMULATES between
  // NODE_OPTIONS and argv, and node refuses the whole run with "must match the
  // number of specified --test-reporter-destination".
  const dir = testRunRepo({ "a.test.mjs": TWO_PASSING }, { "a.test.mjs": 2 });
  try {
    const r = spawnSync(process.execPath, [join(SCRIPTS, "run-script-tests.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, NODE_OPTIONS: "--test-reporter=junit" },
    });
    assert.equal(
      r.status,
      0,
      `a hostile NODE_OPTIONS reporter must not change the count:\n${r.stdout}${r.stderr}`,
    );
    assert.match(r.stdout, /every count matching the manifest/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("run-script-tests refuses an absent tests directory rather than failing", () => {
  // Found reviewing this PR's own diff. `readdirSync` on a missing path raises
  // ENOENT, which left the script exiting 1 with a stack trace -- and exit 1 is
  // this gate's word for "tests failed", a wrong answer rather than an
  // admission that it could not look. The distinction is the whole point of
  // docs/specs/gate-refusal-contract.spec.md, which this script's own header
  // cites.
  const dir = tempRepo();
  try {
    mkdirSync(join(dir, "barwise"), { recursive: true });
    const r = gate("run-script-tests.mjs", dir);
    assert.equal(r.status, 2, `expected a refusal (2):\n${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /no directory at/);
    assert.doesNotMatch(r.stderr, /ENOENT/, "a stack trace is not a refusal");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
