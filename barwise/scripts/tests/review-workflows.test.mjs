/**
 * check-review-workflows (docs/specs/adr-batch10-enforcers.spec.md, WS1):
 * the pure readers on single inputs, then the gate end to end in a
 * throwaway repository.
 *
 * The end-to-end base copies the real workflows, REVIEW.md, review-lanes.json,
 * package files and scripts into the fixture, so the fixture is green for the
 * reason the repository is and each plant is red for one reason. The tracker
 * is a two-line stand-in (the real one is 880 issues the gate needs two of).
 * Files are staged, because the gate lists with `git ls-files`.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
// Importing the gate must not run it.
import {
  ifAdmitsPullRequest,
  lanesProblems,
  laneTable,
  onPhrases,
  Refusal,
  scriptTierRead,
} from "../check-review-workflows.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(SCRIPTS, "check-review-workflows.mjs");
const REPO = join(SCRIPTS, "..", "..");

const read = (path) => readFileSync(join(REPO, path), "utf8");
const lanesJson = () => JSON.parse(read("barwise/review-lanes.json"));
const TOKENS = lanesJson().tierTokens;

// --- the readers, on single inputs ---

test("laneTable reads the real REVIEW.md's lanes and When cells", () => {
  const rows = laneTable(read("REVIEW.md"));
  assert.ok(rows.length >= 6, `${rows.length} rows`);
  assert.ok(rows.some((r) => r.lane.includes("Copilot")));
  assert.equal(
    rows.find((r) => r.lane.startsWith("CI")).when,
    "Push to `main`; pull request into `main`",
  );
});

test("laneTable refuses a missing heading, a missing table and a missing column", () => {
  assert.throws(() => laneTable("# x\n"), Refusal);
  assert.throws(() => laneTable("## Which review runs when\n\nno table\n"), Refusal);
  assert.throws(
    () => laneTable("## Which review runs when\n\n| Lane | Run by |\n| - | - |\n| a | b |\n"),
    Refusal,
  );
});

test("onPhrases: branch filters are in the phrase and other events name themselves", () => {
  assert.deepEqual(
    onPhrases({ push: { branches: ["main"] }, pull_request: { branches: ["main"] } }),
    [
      "Push to main",
      "Pull request into main",
    ],
  );
  assert.deepEqual(onPhrases({ push: null, schedule: [{ cron: "0 0 * * *" }] }), [
    "Push to any branch",
    "Schedule",
  ]);
  assert.deepEqual(onPhrases({ pull_request: { branches: ["main"], types: ["edited"] } }), [
    "Pull request into main",
  ]);
  assert.deepEqual(onPhrases("push"), ["Push to any branch"]);
  assert.deepEqual(onPhrases({ workflow_dispatch: null }), ["Workflow dispatch"]);
});

test("ifAdmitsPullRequest: the intended condition admits, dispatch-only does not", () => {
  const intended =
    "github.event_name == 'workflow_dispatch' || github.event.pull_request.draft == false";
  assert.equal(ifAdmitsPullRequest(undefined), true);
  assert.equal(ifAdmitsPullRequest(intended), true);
  assert.equal(ifAdmitsPullRequest(`\${{ ${intended} }}`), true);
  assert.equal(ifAdmitsPullRequest("github.event_name == 'workflow_dispatch'"), false);
  assert.equal(ifAdmitsPullRequest("github.event.pull_request.draft == true"), false);
  assert.equal(ifAdmitsPullRequest("github.event_name != 'workflow_dispatch' && !(false)"), true);
  assert.equal(ifAdmitsPullRequest("false"), false);
  assert.equal(ifAdmitsPullRequest(false), false);
});

test("ifAdmitsPullRequest: a construct it does not know is an error, not false", () => {
  assert.throws(() => ifAdmitsPullRequest("contains(github.ref, 'x')"), /function contains/);
  assert.throws(() => ifAdmitsPullRequest("github.actor == 'x'"), /context value github.actor/);
  assert.throws(() => ifAdmitsPullRequest("github.event_name == "), /incomplete/);
  assert.throws(() => ifAdmitsPullRequest("(github.event_name == 'x'"), /parenthesis/);
});

test("scriptTierRead: an import carries its bindings, a literal or require carries all", () => {
  const read1 = (text) => scriptTierRead("x.mjs", text, TOKENS);
  assert.deepEqual(
    read1('import { matchesPattern, patternFault as pf } from "./lib/review-tiers.mjs";').bindings,
    ["matchesPattern", "patternFault"],
  );
  assert.deepEqual(read1('import * as t from "./lib/review-tiers.mjs";').bindings, ["*"]);
  assert.deepEqual(read1('export { classify } from "./review-tiers.mjs";').bindings, ["classify"]);
  assert.deepEqual(read1('const t = require("./review-tiers.mjs");').bindings, ["*"]);
  assert.deepEqual(read1('const t = await import("./review-tiers.mjs");').bindings, ["*"]);
  assert.deepEqual(read1('const f = resolve(D, "../review-tiers.json");').bindings, ["*"]);
  assert.deepEqual(read1("const f = `node ${D}/pr-risk.mjs --json`;").bindings, ["*"]);
});

test("scriptTierRead: a comment, a type word or an unrelated literal is not a reader", () => {
  const read1 = (text) => scriptTierRead("x.mjs", text, TOKENS);
  assert.equal(read1('// imports from "./review-tiers.mjs"\nconst a = 1;\n'), null);
  assert.equal(read1('/* "../review-tiers.json" */ const b = "pr-risk";\n'), null);
  assert.equal(read1('const c = "review-tiers-notes.md";\n'), null);
});

test("lanesProblems accepts the real file and names each malformation", () => {
  assert.deepEqual(lanesProblems(lanesJson()), []);
  const bad = lanesJson();
  bad.lanes[1].reason = "";
  bad.tierReaders[0].bindings = "all";
  bad.tierReaders.push({ kind: "workflow", file: "x.yml", reason: "r" });
  bad.nonLaneWorkflows = null;
  const problems = lanesProblems(bad).join("\n");
  assert.match(problems, /external lane "\/code-review" needs a reason/);
  assert.match(problems, /needs bindings "any"/);
  assert.match(problems, /workflow reader x\.yml needs commands/);
  assert.match(problems, /nonLaneWorkflows/);
  assert.deepEqual(lanesProblems(null), ["not an object"]);
});

// --- the gate, end to end ---

const FIXTURE_FILES = [
  "REVIEW.md",
  "package.json",
  "barwise/package.json",
  "barwise/review-lanes.json",
  ".github/workflows/ci.yml",
  ".github/workflows/copilot-review.yml",
  ".github/workflows/release.yml",
  ".github/workflows/tracker-conflicts.yml",
];
const TRACKER = [
  '{"id":"barwise-ilb","status":"open"}',
  '{"id":"barwise-done","status":"closed"}',
  "",
].join("\n");

/**
 * Run the gate in a fresh repository holding the real inputs, with
 * `overrides` ({path: text} to write, {path: null} to delete) applied first.
 * `edit` maps a path to a function over the real text, so a plant is one
 * replacement and an anchor that moved fails the test, not the plant.
 */
function gateIn(overrides = {}, edit = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-review-workflows-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    for (const f of FIXTURE_FILES) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      cpSync(join(REPO, f), join(dir, f));
    }
    cpSync(join(REPO, "barwise/scripts"), join(dir, "barwise/scripts"), {
      recursive: true,
      filter: (src) => !/\/tests(\/|$)/.test(src) && !/\/node_modules(\/|$)/.test(src),
    });
    mkdirSync(join(dir, ".claude/skills/pr-review"), { recursive: true });
    writeFileSync(join(dir, ".claude/skills/pr-review/SKILL.md"), "# pr-review\n");
    mkdirSync(join(dir, ".beads"), { recursive: true });
    writeFileSync(join(dir, ".beads/issues.jsonl"), TRACKER);
    for (const [path, fn] of Object.entries(edit)) {
      const text = readFileSync(join(dir, path), "utf8");
      const next = fn(text);
      assert.notEqual(next, text, `the plant's anchor is gone from ${path}`);
      writeFileSync(join(dir, path), next);
    }
    for (const [path, text] of Object.entries(overrides)) {
      if (text === null) rmSync(join(dir, path));
      else {
        mkdirSync(dirname(join(dir, path)), { recursive: true });
        writeFileSync(join(dir, path), text);
      }
    }
    execFileSync("git", ["add", "-A"], { cwd: dir });
    return spawnSync(process.execPath, [SCRIPT], { cwd: dir, encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const output = (r) => `${r.stdout}${r.stderr}`;
const replace = (from, to) => (text) => {
  assert.ok(text.includes(from), `anchor not found: ${from}`);
  return text.replace(from, to);
};

test("end to end: the real inputs pass, and the OK line counts what it read", () => {
  const r = gateIn();
  assert.equal(r.status, 0, output(r));
  assert.match(r.stdout, /review workflows: OK -- 4 workflow\(s\), 6 lane\(s\), \d+ script\(s\)/);
});

test("end to end: the CI row reading 'Every push' exits 1 [adr:review-policy#review-md-owns-lanes]", () => {
  const r = gateIn({}, {
    "REVIEW.md": replace("Push to `main`; pull request into `main`", "Every push"),
  });
  assert.equal(r.status, 1, output(r));
  assert.match(
    r.stderr,
    /review-md-owns-lanes {2}lane "CI \(ci\.yml\)": When cell reads "Every push"/,
  );
});

test("end to end: deleting the Copilot row exits 1 [adr:review-policy#review-md-owns-lanes]", () => {
  const r = gateIn({}, {
    "REVIEW.md": (text) =>
      text.split("\n").filter((l) => !l.startsWith("| Copilot review")).join("\n"),
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /lane "Copilot review \(copilot-review\.yml\)" is declared .* no row/);
});

test("end to end: a row for a lane nobody declared exits 1 [adr:review-policy#review-md-owns-lanes]", () => {
  const r = gateIn({}, {
    "REVIEW.md": replace(
      "| `/code-review` ",
      "| `/lint-review` | The author | Always | no |\n| `/code-review` ",
    ),
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /table row "`\/lint-review`" is not a lane declared/);
});

test("end to end: a workflow file with no declared lane exits 1 [adr:review-policy#review-md-owns-lanes]", () => {
  const r = gateIn({
    ".github/workflows/second-opinion.yml":
      "name: Second opinion\non: [push]\njobs:\n  j:\n    runs-on: x\n    steps:\n      - run: echo hi\n",
  });
  assert.equal(r.status, 1, output(r));
  assert.match(
    r.stderr,
    /second-opinion\.yml is neither a declared lane's source nor a declared non-lane/,
  );
});

test("end to end: a lane source that is gone, and a stale non-lane, exit 1 [adr:review-policy#review-md-owns-lanes]", () => {
  const r = gateIn({
    ".claude/skills/pr-review/SKILL.md": null,
    ".github/workflows/release.yml": null,
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /source \.claude\/skills\/pr-review is not a tracked file or directory/);
  assert.match(
    r.stderr,
    /non-lane workflow \.github\/workflows\/release\.yml, which is not a tracked workflow/,
  );
});

test("end to end: a new trigger or a dropped branch filter on ci.yml exits 1 [adr:review-policy#review-md-owns-lanes]", () => {
  const added = gateIn({}, {
    ".github/workflows/ci.yml": replace(
      "on:\n  push:",
      "on:\n  schedule:\n    - cron: '0 0 * * *'\n  push:",
    ),
  });
  assert.equal(added.status, 1, output(added));
  assert.match(added.stderr, /on: block says "Schedule; Push to main; Pull request into main"/);
  const dropped = gateIn({}, {
    ".github/workflows/ci.yml": replace("  push:\n    branches: [main]\n", "  push:\n"),
  });
  assert.equal(dropped.status, 1, output(dropped));
  assert.match(dropped.stderr, /on: block says "Push to any branch; Pull request into main"/);
});

test("end to end: copilot-requested -- the pause note is required, and its issue must be open", () => {
  const noNote = gateIn({}, {
    ".github/workflows/copilot-review.yml": replace("PAUSED 2026-10-19 by the owner", "Paused"),
  });
  assert.equal(noNote.status, 1, output(noNote));
  assert.match(noNote.stderr, /copilot-requested {2}.*no 'PAUSED <date>' note/);

  const closed = gateIn({
    ".beads/issues.jsonl": TRACKER.replace(
      '"barwise-ilb","status":"open"',
      '"barwise-ilb","status":"closed"',
    ),
  });
  assert.equal(closed.status, 1, output(closed));
  assert.match(closed.stderr, /names barwise-ilb, which is closed/);

  const missing = gateIn({ ".beads/issues.jsonl": '{"id":"barwise-other","status":"open"}\n' });
  assert.equal(missing.status, 1, output(missing));
  assert.match(missing.stderr, /names barwise-ilb, which is not in \.beads\/issues\.jsonl/);
});

test("end to end: copilot-requested -- a restored condition passes only once the note is dropped", () => {
  const restore = (text) =>
    text
      .replace("    # if: github.event_name", "    if: github.event_name")
      .replace("    if: github.event_name == 'workflow_dispatch'\n", "");
  const withNote = gateIn({}, { ".github/workflows/copilot-review.yml": restore });
  assert.equal(withNote.status, 1, output(withNote));
  assert.match(withNote.stderr, /carries a PAUSED note but the request job admits pull requests/);

  const resumed = gateIn({}, {
    ".github/workflows/copilot-review.yml": (text) =>
      restore(text)
        .replace("PAUSED 2026-10-19 until", "Paused until")
        .replace("PAUSED 2026-10-19 by the owner", "Paused by the owner"),
  });
  assert.equal(resumed.status, 0, output(resumed));
});

test("end to end: an if: the evaluator does not know is a refusal, never a pass", () => {
  const r = gateIn({}, {
    ".github/workflows/copilot-review.yml": replace(
      "    if: github.event_name == 'workflow_dispatch'\n",
      "    if: contains(github.ref, 'x')\n",
    ),
  });
  assert.equal(r.status, 2, output(r));
  assert.match(r.stderr, /uses the function contains\(\)/);
  assert.doesNotMatch(output(r), /review workflows: OK/);
});

test("end to end: copilot-never-blocks -- a workflow_run on it, a mention, and a script naming it exit 1", () => {
  const trigger = gateIn({}, {
    ".github/workflows/ci.yml": replace(
      "on:\n  push:",
      "on:\n  workflow_run:\n    workflows: [Copilot review]\n    types: [completed]\n  push:",
    ),
  });
  assert.equal(trigger.status, 1, output(trigger));
  assert.match(
    trigger.stderr,
    /copilot-never-blocks {2}\.github\/workflows\/ci\.yml: triggers on workflow_run of "Copilot review"/,
  );

  const step = gateIn({}, {
    ".github/workflows/ci.yml": replace(
      "      - run: npm run check:review-workflows\n",
      "      - run: npm run check:review-workflows\n      - run: gh api repos/o/r/pulls/1/reviews | grep -i copilot\n",
    ),
  });
  assert.equal(step.status, 1, output(step));
  assert.match(step.stderr, /ci\.yml \(jobs\.ci\.steps\[\d+\]\.run\): mentions Copilot/);

  const script = gateIn({
    "barwise/scripts/wait-for-review.mjs": 'export const who = "copilot-pull-request-reviewer";\n',
  });
  assert.equal(script.status, 1, output(script));
  assert.match(script.stderr, /wait-for-review\.mjs:1: names Copilot/);
});

test("end to end: copilot-never-blocks -- a comment, and the instructions-file regex, are not readers", () => {
  const r = gateIn({
    "barwise/scripts/note.mjs": "// copilot reviews are advisory\nexport const a = 1;\n",
    ".github/workflows/ci.yml": read(".github/workflows/ci.yml").replace(
      "jobs:",
      "# Copilot is not mentioned in a step.\njobs:",
    ),
  });
  assert.equal(r.status, 0, output(r));
});

test("end to end: tier-informs -- a tier-bearing import in an unlisted script exits 1", () => {
  const r = gateIn({
    "barwise/scripts/check-pins-extra.mjs":
      'import { classify } from "./lib/review-tiers.mjs";\nexport const c = classify;\n',
  });
  assert.equal(r.status, 1, output(r));
  assert.match(
    r.stderr,
    /tier-informs {2}barwise\/scripts\/check-pins-extra\.mjs: reads the review tier and is not a declared reader/,
  );
});

test("end to end: tier-informs -- a listed helper reader taking classify exits 1", () => {
  const r = gateIn({}, {
    "barwise/scripts/plan-scope.mjs": replace(
      "import { matchesPattern }",
      "import { classify, matchesPattern }",
    ),
  });
  assert.equal(r.status, 1, output(r));
  assert.match(
    r.stderr,
    /plan-scope\.mjs: takes classify from the tier module; it may take only matchesPattern/,
  );
});

test("end to end: tier-informs -- a ci.yml step keying on the tier exits 1", () => {
  const r = gateIn({}, {
    ".github/workflows/ci.yml": replace(
      "      - run: npm run check:review-workflows\n",
      "      - run: npm run check:review-workflows\n      - run: node barwise/scripts/pr-risk.mjs --json | jq -e '.tier == \"routine\"'\n",
    ),
  });
  assert.equal(r.status, 1, output(r));
  assert.match(
    r.stderr,
    /tier-informs {2}\.github\/workflows\/ci\.yml \(ci\.steps\[\d+\]\): "node barwise\/scripts\/pr-risk\.mjs --json/,
  );
});

test("end to end: tier-informs -- an npm script that aliases the classifier is a reader too", () => {
  const r = gateIn({}, {
    "barwise/package.json": replace(
      '"check:review-workflows"',
      '"tiers": "node scripts/pr-risk.mjs",\n    "check:review-workflows"',
    ),
    ".github/workflows/ci.yml": replace(
      "      - run: npm run check:review-workflows\n",
      "      - run: npm run check:review-workflows\n      - run: npm run tiers\n",
    ),
  });
  assert.equal(r.status, 1, output(r));
  assert.match(r.stderr, /barwise\/package\.json script tiers: reads the review tier/);
  assert.match(r.stderr, /ci\.yml \(ci\.steps\[\d+\]\): "npm run tiers"/);
});

test("end to end: tier-informs -- .tier outside an echo, or in a condition, exits 1", () => {
  const used = gateIn({}, {
    ".github/workflows/copilot-review.yml": replace(
      "              trivial=$(printf '%s' \"$out\" | jq -r .trivial)\n",
      "              trivial=$(printf '%s' \"$out\" | jq -r .trivial)\n              tier=$(printf '%s' \"$out\" | jq -r .tier)\n",
    ),
  });
  assert.equal(used.status, 1, output(used));
  assert.match(used.stderr, /"\.tier" is used outside an echo or printf/);

  const cond = gateIn({}, {
    ".github/workflows/copilot-review.yml": replace(
      "    if: github.event_name == 'workflow_dispatch'\n",
      "    if: github.event_name == 'workflow_dispatch' && github.event.tier\n",
    ),
  });
  assert.notEqual(cond.status, 0, output(cond));
});

test("end to end: tier-informs -- a declared reader that reads nothing is a stale row", () => {
  const r = gateIn({ "barwise/scripts/plan-scope.mjs": "export const unrelated = 1;\n" });
  assert.equal(r.status, 1, output(r));
  assert.match(
    r.stderr,
    /declared tier reader script barwise\/scripts\/plan-scope\.mjs reads nothing \(stale row\)/,
  );
});

test("end to end: refusals exit 2 and never print OK", () => {
  const cases = {
    "a malformed review-lanes.json": { "barwise/review-lanes.json": '{ "lanes": [] }\n' },
    "an unparseable review-lanes.json": { "barwise/review-lanes.json": "{" },
    "an empty tracker": { ".beads/issues.jsonl": "" },
    "a tracker line that is not JSON": { ".beads/issues.jsonl": "not json\n" },
    "a REVIEW.md with no lane table": { "REVIEW.md": "# Review\n" },
    "a workflow that is not YAML": { ".github/workflows/bad.yml": "a: [unclosed\n" },
    "no workflows at all": {
      ".github/workflows/ci.yml": null,
      ".github/workflows/copilot-review.yml": null,
      ".github/workflows/release.yml": null,
      ".github/workflows/tracker-conflicts.yml": null,
    },
  };
  for (const [what, overrides] of Object.entries(cases)) {
    const r = gateIn(overrides);
    assert.equal(r.status, 2, `${what}: ${output(r)}`);
    assert.doesNotMatch(output(r), /review workflows: OK/, what);
  }
});
