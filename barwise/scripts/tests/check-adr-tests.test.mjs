/**
 * check:adr-tests, the reporter that feeds it, and the wiring around them
 * (docs/specs/executable-adrs.spec.md, WS2; barwise-ym8.7jz).
 *
 * The check is run end to end over fixture trees holding an ADR, the
 * manifests it derives its expected reports from, and hand-written
 * reports in the two shapes the runners write. The reporter is run for
 * real under `node --test`, because what node emits for a skipped test, a
 * todo and a suite is the thing being relied on.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { TRIAL_REPORT } from "../lib/test-reports.mjs";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BARWISE = resolve(SCRIPTS, "..");

function tree() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-adr-tests-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}
function put(dir, rel, body) {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), body);
  execFileSync("git", ["add", "--", rel], { cwd: dir });
}

const ADR = "# A concern\n\nScope: process\nDate: 2026-10-24\nTracking: barwise-ubc\n"
  + "Enforced-by: tests (one, two), none (barwise-gap: three)\n\n"
  + "## Context\n\nWhy.\n\n## Decision\n\n"
  + "1. **One.** {#one}\n2. **Two.** {#two}\n3. **Three.** {#three}\n\n## Consequences\n\nWhat.\n";

const vitest = (results) =>
  JSON.stringify({
    testResults: [
      {
        name: "x.test.ts",
        assertionResults: results.map(([title, status, ancestorTitles = []]) => ({
          title,
          status,
          ancestorTitles,
        })),
      },
    ],
  });
const jsonl = (rows) =>
  rows.map(([name, status, type = "test"]) => JSON.stringify({ name, status, type, file: "f" }))
    .join("\n")
  + "\n";

/** A tree where decision one passes in vitest and two in a script test. */
function fixture({ core, script, trial, testedIn = "[]" } = {}) {
  const dir = tree();
  put(dir, "barwise/docs/adr/tested-in.json", testedIn);
  put(dir, "barwise/docs/adr/a-concern.md", ADR);
  put(
    dir,
    "barwise/packages/core/package.json",
    JSON.stringify({ scripts: { "test:coverage": "vitest" } }),
  );
  put(
    dir,
    "barwise/scripts/tests/expected-counts.json",
    JSON.stringify({ counts: { "g.test.mjs": 2 } }),
  );
  put(
    dir,
    "barwise/packages/core/test-results/vitest.json",
    core ?? vitest([["pins one [adr:a-concern#one]", "passed"], ["other", "passed"]]),
  );
  put(
    dir,
    "barwise/test-results/script-tests/g.test.jsonl",
    script ?? jsonl([["pins two [adr:a-concern#two]", "passed"], ["other", "passed"]]),
  );
  put(dir, "barwise/test-results/trial.jsonl", trial ?? jsonl([["trial", "passed"]]));
  return dir;
}
const run = (dir) =>
  spawnSync(process.execPath, [join(SCRIPTS, "check-adr-tests.mjs"), "--root", dir], {
    encoding: "utf8",
  });
function withFixture(opts, body) {
  const dir = fixture(opts);
  try {
    body(dir, run(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("check:adr-tests passes when each tested decision has a passing tagged test", () => {
  withFixture({}, (_, r) => {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /2 tested decision\(s\) across 1 ADR\(s\)/);
  });
});

test("check:adr-tests: a tagged test that did not pass is not evidence", () => {
  for (
    const [status, why] of [["todo", /no test carrying \[adr:a-concern#one\] passed/], [
      "failed",
      /a test carrying \[adr:a-concern#one\] failed/,
    ]]
  ) {
    withFixture({ core: vitest([["pins one [adr:a-concern#one]", status]]) }, (_, r) => {
      assert.equal(r.status, 1, `${status}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, why);
    });
  }
});

test("check:adr-tests: a skip-only decision beside an unproven one is one refusal and one finding", () => {
  // Characterizes the judge before it moves into scripts/lib/adr-judge.mjs
  // (adr-gate-reader-split.spec.md): the unread-report count is fixed
  // before decisions are judged, so a skip refusal cannot turn the other
  // decision's finding into a refusal.
  withFixture(
    {
      core: vitest([["pins one [adr:a-concern#one]", "skipped"]]),
      script: jsonl([["other", "passed"]]),
    },
    (_, r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(
        r.stderr,
        /FAIL -- 1 finding\(s\):\n\s+.*tests \(two\): no test carrying \[adr:a-concern#two\] passed/,
      );
      assert.match(
        r.stderr,
        /0 report\(s\) not read, 0 decision\(s\) left unproven by them, 1 decision\(s\) whose tagged tests all skipped/,
      );
    },
  );
});

test("check:adr-tests: a decision whose tagged tests all skipped cannot be answered, unless one failed", () => {
  // A skip is a test that could not answer: the gitleaks probes skip where
  // gitleaks is absent, and that run cannot tell whether the decision holds.
  const T = "pins one [adr:a-concern#one]";
  for (
    const [label, rows, want] of [
      ["skip only", [[T, "skipped"]], 2],
      ["skip and a pass", [[T, "skipped"], [`${T} too`, "passed"]], 0],
      ["skip and a failure", [[T, "skipped"], [`${T} too`, "failed"]], 1],
      ["skip and a todo", [[T, "skipped"], [`${T} too`, "todo"]], 2],
      // Vitest writes `pending` for a test queued or cut short: it never ran.
      ["pending only", [[T, "pending"]], 2],
    ]
  ) {
    withFixture({ core: vitest(rows) }, (_, r) => {
      assert.equal(r.status, want, `${label}\n${r.stdout}${r.stderr}`);
      if (want === 2) {
        assert.match(
          r.stderr,
          /every test carrying \[adr:a-concern#one\] skipped, so this run cannot tell: "pins one/,
        );
        assert.match(
          r.stderr,
          /0 report\(s\) not read, 0 decision\(s\) left unproven by them, 1 decision\(s\) whose tagged tests all skipped/,
        );
        assert.doesNotMatch(r.stderr, /FAIL/);
      }
    });
  }
  // The node:test path, which the gitleaks probes take: its skip reaches the
  // report through test-tag-reporter.mjs as `skipped` too.
  withFixture({ script: jsonl([["pins two [adr:a-concern#two]", "skipped"]]) }, (_, r) => {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /every test carrying \[adr:a-concern#two\] skipped/);
  });
  // An unread report and a skip-only decision together: the header keeps
  // the two counts apart.
  withFixture({ core: vitest([[T, "skipped"]]), trial: "not a report\n" }, (_, r) => {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /1 report\(s\) not read, 0 decision\(s\) left unproven by them, 1 decision\(s\) whose tagged tests all skipped/,
    );
  });
});

test("check:adr-tests: a tag on a describe is not a test, in either report, and says so", () => {
  withFixture({ core: vitest([["child", "passed", ["suite [adr:a-concern#one]"]]]) }, (_, r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /tests \(one\).*the tag is on a describe/);
  });
  withFixture({ script: jsonl([["suite [adr:a-concern#two]", "passed", "suite"]]) }, (_, r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /tests \(two\).*the tag is on a describe/);
  });
});

test("check:adr-tests: one title with two tags credits both", () => {
  withFixture(
    {
      core: vitest([["pins both [adr:a-concern#one] [adr:a-concern#two]", "passed"]]),
      script: jsonl([["unrelated", "passed"]]),
    },
    (_, r) => assert.equal(r.status, 0, r.stdout + r.stderr),
  );
});

test("check:adr-tests: a tag naming a missing ADR or decision is a finding, on a suite too", () => {
  withFixture(
    {
      trial: jsonl([["t [adr:a-concern#retired]", "passed"], [
        "s [adr:no-such-adr#one]",
        "passed",
        "suite",
      ]]),
    },
    (_, r) => {
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(
        r.stderr,
        /\[adr:a-concern#retired\].*names retired, which a-concern has no decision with/,
      );
      assert.match(
        r.stderr,
        /\[adr:no-such-adr#one\].*names ADR no-such-adr, which does not exist/,
      );
    },
  );
});

test("check:adr-tests refuses, exit 2, a missing or misshapen report, and lists it beside a finding", () => {
  const missing = fixture();
  try {
    rmSync(join(missing, "barwise/packages/core/test-results/vitest.json"));
    const r = run(missing);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /packages\/core\/test-results\/vitest\.json: missing/);
    // Decision one's evidence was in that report, so it is "cannot tell" too.
    assert.match(r.stderr, /tests \(one\).*1 report\(s\) were not read/);
    assert.doesNotMatch(r.stderr, /FAIL/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
  // A vitest upgrade that renamed a field stops the check; it does not pass.
  withFixture({ core: JSON.stringify({ testResults: [{ tests: [] }] }) }, (_, r) => {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /not a report this check reads \(a testResults entry has no assertionResults\)/,
    );
  });
  // A stale tag (a finding whatever the missing report held) beside an
  // unreadable report: exit 1, with both listed.
  withFixture({ core: "{", trial: jsonl([["t [adr:a-concern#retired]", "passed"]]) }, (_, r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /a-concern#retired/);
    assert.match(
      r.stderr,
      /cannot answer -- 1 report\(s\) not read, 1 decision\(s\) left unproven/,
    );
  });
});

test("test-tag-reporter writes what node ran: reasoned skips, todos and suites are not passed tests", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-reporter-"));
  try {
    writeFileSync(
      join(dir, "probe.test.mjs"),
      'import { describe, test } from "node:test";\n'
        + 'test("plain", () => {});\n'
        + 'test("reasoned skip", (t) => { t.skip("tool missing"); });\n'
        + 'test("todo with reason", { todo: "soon" }, () => {});\n'
        + 'describe("a suite", () => { test("child", { skip: true }, () => {}); });\n',
    );
    const out = join(dir, "out.jsonl");
    const r = spawnSync(
      process.execPath,
      [
        "--test",
        "--test-reporter=tap",
        "--test-reporter-destination=stdout",
        `--test-reporter=${join(SCRIPTS, "lib", "test-tag-reporter.mjs")}`,
        `--test-reporter-destination=${out}`,
        join(dir, "probe.test.mjs"),
      ],
      // Without NODE_TEST_CONTEXT, which marks a nested run and makes node
      // skip the file, as run-script-tests.mjs also drops it.
      {
        encoding: "utf8",
        env: Object.fromEntries(
          Object.entries(process.env).filter(([k]) => k !== "NODE_TEST_CONTEXT"),
        ),
      },
    );
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const rows = readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.deepEqual(rows.map((x) => [x.name, x.type, x.status]), [
      ["plain", "test", "passed"],
      ["reasoned skip", "test", "skipped"],
      ["todo with reason", "test", "todo"],
      ["child", "test", "skipped"],
      ["a suite", "suite", "passed"],
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the test:trial script writes its report where check:adr-tests reads it", () => {
  const script =
    JSON.parse(readFileSync(join(BARWISE, "package.json"), "utf8")).scripts["test:trial"];
  // test:trial runs from barwise/, and TRIAL_REPORT is repository-rooted.
  const fromBarwise = TRIAL_REPORT.replace(/^barwise\//, "");
  assert.ok(script.includes(`--test-reporter-destination=${fromBarwise}`), script);
  assert.ok(script.includes(`mkdir -p ${dirname(fromBarwise)}`), script);
  // The same reporter run-script-tests.mjs uses, by the same file.
  assert.ok(script.includes("--test-reporter=./scripts/lib/test-tag-reporter.mjs"), script);
});

test("vitest.shared.ts keeps vitest's computed reporters and adds json", () => {
  // In a child, so GITHUB_ACTIONS is set before vitest computes its defaults.
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const { barwiseVitestConfig } = await import(${
        JSON.stringify(join(BARWISE, "vitest.shared.ts"))
      });
       const c = barwiseVitestConfig("core", { coverage: { kind: "default" }, thresholds: {} });
       console.log(JSON.stringify([c.test.reporters, c.test.outputFile]));`,
    ],
    { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "true" } },
  );
  assert.equal(r.status, 0, r.stderr);
  const [reporters, outputFile] = JSON.parse(r.stdout);
  assert.ok(reporters.includes("github-actions"), JSON.stringify(reporters));
  assert.equal(reporters.at(-1), "json");
  assert.deepEqual(outputFile, { json: "test-results/vitest.json" });
});

test("turbo hashes the vitest configs for test and test:coverage, and keeps the report", () => {
  // A wrong $TURBO_ROOT$ path matches nothing and fails silently, which is
  // how the spec's first draft of this list went (barwise-ym8.7jz).
  const r = spawnSync(
    "npx",
    ["turbo", "run", "test", "test:coverage", "--filter=@barwise/dbt", "--dry=json"],
    { cwd: BARWISE, encoding: "utf8" },
  );
  assert.equal(r.status, 0, r.stderr);
  const tasks = JSON.parse(r.stdout).tasks.filter((t) => t.package === "@barwise/dbt");
  for (const id of ["test", "test:coverage"]) {
    const t = tasks.find((x) => x.task === id);
    assert.ok(t, `no ${id} task in the dry run`);
    const inputs = Object.keys(t.inputs);
    assert.ok(inputs.includes("vitest.config.ts"), `${id}: ${inputs.join(" ")}`);
    assert.ok(inputs.includes("../../vitest.shared.ts"), `${id}: no vitest.shared.ts`);
    assert.ok(inputs.some((p) => p.startsWith("../../examples/")), `${id}: no examples/`);
    assert.ok(t.outputs.includes("test-results/**"), `${id}: ${t.outputs.join(" ")}`);
  }
});

// The per-file rule (docs/specs/capability-matrix-check.spec.md, WS2): a
// tested-in row names the files a decision rests on, and each must hold a
// passed test carrying its tag. The reports name absolute paths from
// whichever checkout wrote them; turbo's cache can restore one written in a
// pre-push worktree, so these use a prefix that is not the fixture's.
const ELSEWHERE = "/tmp/other-checkout/barwise";
const A = "barwise/packages/core/tests/a.test.ts";
const B = "barwise/scripts/tests/g.test.mjs";
const row = (files, decision = "a-concern#one") =>
  JSON.stringify([{ decision, files, why: "each file pins its own half" }]);
const vitestIn = (file, results) =>
  JSON.stringify({
    testResults: [{
      name: file,
      assertionResults: results.map(([title, status]) => ({ title, status, ancestorTitles: [] })),
    }],
  });
const jsonlIn = (file, rows) =>
  rows.map(([name, status, type = "test"]) => JSON.stringify({ name, status, type, file }))
    .join("\n")
  + "\n";
const T1 = "pins one [adr:a-concern#one]";
const T2 = "pins two [adr:a-concern#two]";
/** Both named files tracked; decision two passes in the script report beside B's rows. */
function perFile({ core, scriptRows, testedIn = row([A, B]) }) {
  return (body) => {
    const dir = fixture({
      core,
      script: jsonlIn(`${ELSEWHERE}/scripts/tests/g.test.mjs`, [[T2, "passed"], ...scriptRows]),
      testedIn,
    });
    try {
      put(dir, A, "");
      put(dir, B, "");
      body(run(dir));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };
}

test("check:adr-tests: each file a tested-in row names has a passed tagged test, read from another checkout's paths", () => {
  perFile({
    core: vitestIn(`${ELSEWHERE}/packages/core/tests/a.test.ts`, [[T1, "passed"]]),
    scriptRows: [[`${T1} too`, "passed"]],
  })((r) => {
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /so do the 2 file\(s\) named by 1 tested-in row\(s\)/);
  });
});

test("check:adr-tests: one of two named files passing is a finding naming the other", () => {
  // Planted red: the decision rule alone passes here, on A's test.
  perFile({
    core: vitestIn(`${ELSEWHERE}/packages/core/tests/a.test.ts`, [[T1, "passed"]]),
    scriptRows: [["pins one, untagged", "passed"]],
  })((r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /FAIL -- 1 finding\(s\)/);
    assert.match(
      r.stderr,
      /"a-concern#one": no test in barwise\/scripts\/tests\/g\.test\.mjs carrying \[adr:a-concern#one\] passed/,
    );
    assert.doesNotMatch(r.stderr, /a\.test\.ts carrying/);
  });
  // A failure in the named file is an answer too.
  perFile({
    core: vitestIn(`${ELSEWHERE}/packages/core/tests/a.test.ts`, [[T1, "passed"]]),
    scriptRows: [[`${T1} too`, "failed"]],
  })((r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /a test in barwise\/scripts\/tests\/g\.test\.mjs carrying .* failed/);
  });
});

test("check:adr-tests: a named file whose tagged tests all skipped is a refusal, counted apart", () => {
  perFile({
    core: vitestIn(`${ELSEWHERE}/packages/core/tests/a.test.ts`, [[T1, "passed"]]),
    scriptRows: [[`${T1} too`, "skipped"]],
  })((r) => {
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /every test in barwise\/scripts\/tests\/g\.test\.mjs carrying \[adr:a-concern#one\] skipped/,
    );
    // Not counted as an unproven decision: decision one passed on A.
    assert.match(
      r.stderr,
      /0 report\(s\) not read, 0 decision\(s\) left unproven by them, 0 decision\(s\) whose tagged tests all skipped, 0 named file\(s\) left unproven by them, 1 named file\(s\) whose tagged tests all skipped:/,
    );
    assert.doesNotMatch(r.stderr, /FAIL/);
  });
});

test("check:adr-tests: a test whose report names no file proves its decision, not a named file", () => {
  // The tag reporter writes `file: null` when node gives none; vitest's
  // name could fall outside the package. Either is left out of the per-file
  // rule only.
  perFile({
    core: vitestIn("elsewhere/a.test.ts", [[T1, "passed"]]),
    scriptRows: [[`${T1} too`, "passed"]],
  })((r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /no test in barwise\/packages\/core\/tests\/a\.test\.ts carrying/);
    assert.doesNotMatch(r.stderr, /tests \(one\)/);
  });
  // With a report unread, a named file with no tagged test cannot be told.
  const dir = fixture({
    script: jsonlIn(null, [[T1, "passed"], [T2, "passed"]]),
    trial: "not a report\n",
    testedIn: row([B]),
  });
  try {
    put(dir, B, "");
    const r = run(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /no test in barwise\/scripts\/tests\/g\.test\.mjs .* 1 report\(s\) were not read/,
    );
    assert.match(r.stderr, /1 named file\(s\) left unproven by them, 0 named file\(s\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:adr-tests: a row that outlived its decision, or names an untracked path, is a finding", () => {
  const passing = {
    core: vitestIn(`${ELSEWHERE}/packages/core/tests/a.test.ts`, [[T1, "passed"]]),
    scriptRows: [[`${T1} too`, "passed"]],
  };
  // Decision three is an id of the ADR, but held by a none entry, not tests.
  for (const decision of ["a-concern#three", "a-concern#retired", "no-such-adr#one"]) {
    perFile({ ...passing, testedIn: row([A], decision) })((r) => {
      assert.equal(r.status, 1, `${decision}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, /is not a tests entry of .*; a row that outlived its decision/);
    });
  }
  perFile({ ...passing, testedIn: row([A, "barwise/packages/core/tests/gone.test.ts"]) })((r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(
      r.stderr,
      /names barwise\/packages\/core\/tests\/gone\.test\.ts, which git does not track/,
    );
  });
});

test("check:adr-tests refuses, exit 2, a tested-in.json it cannot read, and still judges the decisions", () => {
  for (
    const [label, body, why] of [
      ["unparsable", "[", /tested-in\.json: not read \(/],
      ["not a list", "{}", /tested-in\.json: not a list of rows/],
      [
        "a row without why",
        JSON.stringify([{ decision: "a-concern#one", files: [A] }]),
        /row 1 is not/,
      ],
      [
        "no files",
        JSON.stringify([{ decision: "a-concern#one", files: [], why: "w" }]),
        /row 1 is not/,
      ],
      ["a decision with no id", row([A], "a-concern"), /row 1 is not/],
    ]
  ) {
    withFixture({ testedIn: body }, (_, r) => {
      assert.equal(r.status, 2, `${label}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, why);
      assert.match(r.stderr, /tested-in\.json not read:/);
      assert.doesNotMatch(r.stderr, /FAIL/);
    });
  }
  const missing = fixture();
  try {
    rmSync(join(missing, "barwise/docs/adr/tested-in.json"));
    const r = run(missing);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /barwise\/docs\/adr\/tested-in\.json: missing/);
  } finally {
    rmSync(missing, { recursive: true, force: true });
  }
  // Beside an unreadable manifest, a finding of the decision rule is exit 1.
  withFixture({ testedIn: "[", core: vitest([[T1, "failed"]]) }, (_, r) => {
    assert.equal(r.status, 1, r.stdout + r.stderr);
    assert.match(r.stderr, /tested-in\.json: not read/);
  });
});
