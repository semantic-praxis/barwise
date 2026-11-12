/**
 * Gate tests: check-review-tiers, pr-risk, the review workflows' shell, tracker
 * closes, plan review, spec touches and instruction references.
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
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { CWDS, gate, REPO, SCRIPTS, stage, tempRepo } from "./gates-helpers.mjs";

// check-review-tiers: the bidirectional agreement between
// .claude/skills/pr-review/checklist.md and barwise/review-tiers.json.
//
// Written red-first with the real files perturbed by hand, then pinned
// here against fixtures so the suite never touches the live checklist.
// The `--checklist`/`--table` overrides exist for exactly this: the
// acceptance criterion is watching each EXIT CODE on a planted defect,
// and a test that can only assert the green path would be the thing
// barwise-906 is about.

/**
 * A valid `trivial` block for fixtures. Every hand-written table carries
 * one, so a refusal test fails on the defect it plants and not on a
 * missing block -- a test passing for a reason other than the one it
 * names is the defect a review found in this very suite.
 */
const VALID_TRIVIAL = { globs: [".beads/issues.jsonl"], why: "fixture" };

/**
 * A minimal set of inputs the gate accepts, written into a temp dir. The
 * tracked-file list makes the fixture globs live (the gate fails a glob
 * that matches nothing), and `tracked` replaces it for the dead-glob cases.
 */
function tierFixture(
  dir,
  headings,
  rows,
  tracked = ["x/a.ts", ".beads/issues.jsonl"],
  { titles = ["F"], modes = ["F"], modeGlobs = ["x/"], noModes = false } = {},
) {
  writeFileSync(join(dir, "tracked.txt"), tracked.join("\n"));
  const md = ["# Checklist", "", ...headings.flatMap((h) => [`## ${h}`, "", "- item", ""])];
  writeFileSync(join(dir, "checklist.md"), md.join("\n"));
  // REVIEW.md's shape: numbered items with a bold lead under "Always check".
  const review = [
    "# Review",
    "",
    "## Always check: fixture",
    "",
    ...titles.map((t, i) => `${i + 1}. **${t}.** Body.`),
    "",
    "## After",
    "",
  ];
  writeFileSync(join(dir, "REVIEW.md"), review.join("\n"));
  const row = (r) =>
    r.tier === "not-path-derivable"
      ? { heading: r.heading, tier: r.tier, why: "fixture" }
      : { heading: r.heading, tier: r.tier ?? "routine", globs: ["x/"], why: "fixture" };
  writeFileSync(
    join(dir, "review-tiers.json"),
    JSON.stringify({
      trivial: VALID_TRIVIAL,
      rows: rows.map(row),
      ...(noModes
        ? {}
        : { failureModes: modes.map((heading) => ({ ...row({ heading }), globs: modeGlobs })) }),
    }),
  );
  return [
    "--checklist",
    join(dir, "checklist.md"),
    "--table",
    join(dir, "review-tiers.json"),
    "--review",
    join(dir, "REVIEW.md"),
    "--tracked",
    join(dir, "tracked.txt"),
  ];
}

/**
 * REVIEW.md's failure modes and the table's failureModes rows agree both
 * ways, and an unreadable or empty REVIEW.md is "cannot answer"
 * (review-routing.spec.md, WS2).
 */
test("check-review-tiers fails both ways on REVIEW.md failure modes, and refuses an unreadable list", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    let args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, {
      titles: ["F", "G"],
      modes: ["F"],
    });
    let run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, "a REVIEW.md title with no row");
    assert.match(run.stderr, /no failureModes row for REVIEW\.md failure mode: G/);

    args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, {
      titles: ["F"],
      modes: ["F", "Gone"],
    });
    run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, "a row with no REVIEW.md title");
    assert.match(run.stderr, /failureModes row names a mode REVIEW\.md no longer has: Gone/);

    args = tierFixture(dir, ["A"], [{ heading: "A" }]);
    assert.equal(
      gate("check-review-tiers.mjs", dir, ...args).status,
      0,
      "the agreeing fixture passes",
    );
    rmSync(join(dir, "REVIEW.md"));
    run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2, "REVIEW.md missing");
    assert.match(run.stderr, /cannot read REVIEW\.md/);

    writeFileSync(
      join(dir, "REVIEW.md"),
      "# Review\n\n## Always check: none\n\nNo items.\n\n## After\n\n1. **Not this.** x\n",
    );
    run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2, "an empty Always check list");
    assert.match(run.stderr, /'Always check' list .* has no items/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("an Always check item without a one-line bold title is refused, not skipped", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }]);
    writeFileSync(
      join(dir, "REVIEW.md"),
      "# Review\n\n## Always check: x\n\n1. **F.** Body.\n2. Retry storms, not bold.\n",
    );
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /1 'Always check' item\(s\) .* have no one-line bold title/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk refuses a table with no failureModes rather than routing none", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, { noModes: true });
    const table = args[args.indexOf("--table") + 1];
    const run = gate("pr-risk.mjs", dir, ...fileList(dir, ["x/a.ts"]), "--table", table);
    assert.equal(run.status, 2, run.stdout);
    assert.match(run.stderr, /declares no failureModes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers checks failureModes rows as it checks the checklist rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    // A dead failure-mode glob, distinct from the row globs.
    let args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, { modeGlobs: ["nowhere/"] });
    let run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /glob matches no tracked file: F: nowhere\//);
    // A mode declared twice.
    args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, {
      titles: ["F"],
      modes: ["F", "F"],
    });
    run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1);
    assert.match(run.stderr, /failure mode declared by more than one row: F/);
    // A malformed mode row is refused by the same validator.
    args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, { modeGlobs: ["*.ts"] });
    run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /failure mode 0 \(F\): pattern "\*\.ts"/);
    // A table with no failureModes block at all.
    args = tierFixture(dir, ["A"], [{ heading: "A" }], undefined, { noModes: true });
    run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2);
    assert.match(run.stderr, /declares no failureModes/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on a row glob that matches no tracked file", () => {
  // barwise-fs0: a row named a path that did not exist and routed nothing
  // for five weeks while every other check passed.
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }], [".beads/issues.jsonl"]);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, `a dead glob must fail: ${run.stdout}${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /glob matches no tracked file: A: x\//);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES an empty tracked-file list rather than calling every glob dead", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }], []);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2, `an empty listing answers nothing: ${run.stdout}${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /tracked-file list is empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES a --tracked flag with no value rather than reading the live repository", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }], ["x/a"]).slice(0, -1);
    // --tracked is last, so dropping its value leaves the flag bare.
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2, `a flag with no value answers nothing: ${run.stdout}${run.stderr}`);
    assert.match(`${run.stdout}${run.stderr}`, /--tracked needs a value/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers passes on the real table and tracked files, with no overrides", () => {
  // The default path: lib/tracked.mjs and repo-rooted globs, which every
  // fixture test above bypasses with --tracked.
  const run = gate("check-review-tiers.mjs", REPO);
  assert.equal(run.status, 0, `the live table must agree: ${run.stdout}${run.stderr}`);
});

test("check-review-tiers fails on a trivial glob that matches no tracked file", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }], ["x/a.ts"]);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, `a dead trivial glob must fail: ${run.stdout}${run.stderr}`);
    assert.match(
      `${run.stdout}${run.stderr}`,
      /glob matches no tracked file: trivial: \.beads\/issues\.jsonl/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The reach check (docs/specs/review-tier-reach.spec.md, barwise-1046): a
// file-shaped glob whose name also lives at tracked paths the row does not
// reach fails, unless reachAcknowledged lists exactly those paths under
// that file name. The instructions row's `CLAUDE.md` matched the root
// file and none of the package copies, and every earlier check stayed
// green.

const REACH_TRACKED = ["x/a.ts", ".beads/issues.jsonl", "CLAUDE.md", "p/CLAUDE.md", "q/CLAUDE.md"];

/**
 * tierFixture's inputs, with row A's and failure mode F's fields replaced.
 * Row A defaults to the barwise-1046 shape: `CLAUDE.md` alone.
 */
function reachFixture(dir, rowA = {}, modeF = {}, tracked = REACH_TRACKED) {
  const args = tierFixture(dir, ["A"], [{ heading: "A" }], tracked);
  const table = JSON.parse(readFileSync(join(dir, "review-tiers.json"), "utf8"));
  Object.assign(table.rows[0], { globs: ["CLAUDE.md"] }, rowA);
  Object.assign(table.failureModes[0], modeF);
  writeFileSync(join(dir, "review-tiers.json"), JSON.stringify(table));
  return args;
}

test("check-review-tiers fails on a file-shaped glob whose same-named files it does not reach", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    let run = gate("check-review-tiers.mjs", dir, ...reachFixture(dir));
    assert.equal(run.status, 1, `the barwise-1046 shape must fail: ${run.stdout}${run.stderr}`);
    assert.match(
      run.stderr,
      /shadowed: row "A": CLAUDE\.md \(CLAUDE\.md\) has 2 unreached same-named path\(s\), unacknowledged:\n {4}p\/CLAUDE\.md\n {4}q\/CLAUDE\.md\n/,
    );
    // The same check on failureModes rows, labelled as failure modes.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, { globs: ["x/"] }, { globs: ["x/", "p/CLAUDE.md"] }),
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      /shadowed: failure mode "F": CLAUDE\.md \(p\/CLAUDE\.md\) has 2 .*\n {4}CLAUDE\.md\n {4}q\/CLAUDE\.md\n/,
    );
    // Two same-named patterns share one shadow, so one finding names both;
    // a glob listed twice is named once.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, { globs: ["CLAUDE.md", "p/CLAUDE.md", "p/CLAUDE.md"] }),
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      /shadowed: row "A": CLAUDE\.md \(CLAUDE\.md, p\/CLAUDE\.md\) has 1 [^\n]*\n {4}q\/CLAUDE\.md\n/,
    );
    assert.equal(run.stderr.match(/shadowed:/g).length, 1, "one finding per file name");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers passes a shadow its row acknowledges exactly, or reaches", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    let run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, {
        reachAcknowledged: { "CLAUDE.md": ["q/CLAUDE.md", "p/CLAUDE.md"] },
      }),
    );
    assert.equal(run.status, 0, `an exact waiver passes, in any order: ${run.stderr}`);
    // One entry per file name, however many patterns carry it.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, {
        globs: ["CLAUDE.md", "p/CLAUDE.md"],
        reachAcknowledged: { "CLAUDE.md": ["q/CLAUDE.md"] },
      }),
    );
    assert.equal(run.status, 0, `one key covers both same-named patterns: ${run.stderr}`);
    // An exact waiver on a failure mode.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, { globs: ["x/"] }, {
        globs: ["x/", "p/CLAUDE.md"],
        reachAcknowledged: { "CLAUDE.md": ["CLAUDE.md", "q/CLAUDE.md"] },
      }),
    );
    assert.equal(run.status, 0, `a failure mode's exact waiver passes: ${run.stderr}`);
    // Widened instead: `*/CLAUDE.md` reaches both copies, so nothing is
    // shadowed. A final `*` names no file and a directory has no name, so
    // `x/*` and `x/` are never checked.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, { globs: ["CLAUDE.md", "*/CLAUDE.md", "x/*", "x/"] }),
    );
    assert.equal(run.status, 0, `a row that reaches its shadow passes: ${run.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on a shadow path its acknowledgement does not list", () => {
  // The reason the waiver is a list and not a count: a new same-named file
  // fails the PR that adds it, instead of being waived by membership.
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = reachFixture(dir, { reachAcknowledged: { "CLAUDE.md": ["p/CLAUDE.md"] } });
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      /shadowed: row "A": CLAUDE\.md \(CLAUDE\.md\) has 1 same-named path\(s\) missing from its reachAcknowledged list:\n {4}q\/CLAUDE\.md\n/,
    );
    assert.doesNotMatch(run.stderr, / {4}p\/CLAUDE\.md/, "the listed path is waived");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on an acknowledged path that is no longer shadowed", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = reachFixture(dir, {
      reachAcknowledged: { "CLAUDE.md": ["p/CLAUDE.md", "q/CLAUDE.md", "gone/CLAUDE.md"] },
    });
    let run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      /stale reachAcknowledged path\(s\): row "A": CLAUDE\.md, no longer shadowed:\n {4}gone\/CLAUDE\.md\n/,
    );
    assert.doesNotMatch(run.stderr, /shadowed: row "A"/, "the shadow itself is waived");
    // The same on a failure mode.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, { globs: ["x/"] }, {
        globs: ["x/", "p/CLAUDE.md"],
        reachAcknowledged: { "CLAUDE.md": ["CLAUDE.md", "q/CLAUDE.md", "gone/CLAUDE.md"] },
      }),
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      /stale reachAcknowledged path\(s\): failure mode "F": CLAUDE\.md, no longer shadowed:\n {4}gone\/CLAUDE\.md\n/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on an acknowledgement key that waives nothing, and says why", () => {
  const NOT_A_NAME = "not the file name of any file-shaped pattern in this row";
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    // A key that is not the name of any file-shaped pattern of the row.
    let run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, {
        globs: ["x/"],
        reachAcknowledged: { "CLAUDE.md": ["p/CLAUDE.md", "q/CLAUDE.md"] },
      }),
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      new RegExp(`stale reachAcknowledged key: row "A": CLAUDE\\.md \\(${NOT_A_NAME}\\)`),
    );
    // A file name of the row whose shadow is empty, acknowledged with [].
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, { reachAcknowledged: { "CLAUDE.md": [] } }, {}, [
        "x/a.ts",
        ".beads/issues.jsonl",
        "CLAUDE.md",
      ]),
    );
    assert.equal(run.status, 1, run.stderr);
    assert.match(
      run.stderr,
      /stale reachAcknowledged key: row "A": CLAUDE\.md \(its shadow is empty\)/,
    );
    // Keys that are patterns rather than names, and the "names" a
    // non-file-shaped pattern would have if it counted: `**`, the empty
    // segment after a directory's `/`, a final `*`. Each is a stale KEY,
    // not a list of stale paths -- the entry waives nothing at all.
    run = gate(
      "check-review-tiers.mjs",
      dir,
      ...reachFixture(dir, {
        globs: ["CLAUDE.md", "p/CLAUDE.md", "q/CLAUDE.md", "**", "x/", "x/*"],
        reachAcknowledged: {
          "p/CLAUDE.md": ["x/a.ts"],
          "**": ["x/a.ts"],
          "": ["x/a.ts"],
          "*": ["x/a.ts"],
        },
      }),
    );
    assert.equal(run.status, 1, run.stderr);
    for (const key of ["p/CLAUDE\\.md", "\\*\\*", "", "\\*"]) {
      assert.match(
        run.stderr,
        new RegExp(`stale reachAcknowledged key: row "A": ${key} \\(${NOT_A_NAME}\\)`),
      );
    }
    assert.doesNotMatch(run.stderr, /stale reachAcknowledged path/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES a malformed reachAcknowledged, and pr-risk ignores it", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const malformed = [
      [["p/CLAUDE.md"], /row "A": reachAcknowledged must be an object/],
      [null, /row "A": reachAcknowledged must be an object/],
      ["p/CLAUDE.md", /row "A": reachAcknowledged must be an object/],
      [
        { "CLAUDE.md": "p/CLAUDE.md" },
        /row "A": reachAcknowledged\["CLAUDE\.md"\] must be an array/,
      ],
      [{ "CLAUDE.md": ["p/CLAUDE.md", ""] }, /must be an array of non-empty strings/],
      [{ "CLAUDE.md": [7] }, /must be an array of non-empty strings/],
      // A duplicate cannot come from any tree, so it is a broken
      // declaration (2), not a disagreement with the tree (1).
      [
        { "CLAUDE.md": ["p/CLAUDE.md", "q/CLAUDE.md", "p/CLAUDE.md"] },
        /reachAcknowledged\["CLAUDE\.md"\] lists "p\/CLAUDE\.md" twice/,
      ],
    ];
    const cases = [
      ...malformed.map(([value, reason]) => [{ reachAcknowledged: value }, {}, value, reason]),
      // On a failure mode, labelled as one.
      [
        { globs: ["x/"] },
        { reachAcknowledged: ["CLAUDE.md"] },
        "a failure mode's array",
        /failure mode "F": reachAcknowledged must be an object/,
      ],
    ];
    for (const [rowA, modeF, what, reason] of cases) {
      const args = reachFixture(dir, rowA, modeF);
      const run = gate("check-review-tiers.mjs", dir, ...args);
      assert.equal(run.status, 2, `${JSON.stringify(what)} is cannot-answer: ${run.stderr}`);
      assert.match(run.stderr, reason);
      // pr-risk reads rows through tierRows and never this field, so a
      // malformed waiver must not make the classifier refuse.
      const table = args[args.indexOf("--table") + 1];
      const risk = gate("pr-risk.mjs", dir, ...fileList(dir, ["x/a.ts"]), "--table", table);
      assert.equal(
        risk.status,
        0,
        `pr-risk is unaffected by ${JSON.stringify(what)}: ${risk.stderr}`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers passes when every heading has exactly one row", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A", "B"], [{ heading: "A" }, { heading: "B" }]);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 0, `agreement must pass: ${run.stdout}${run.stderr}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on a heading with no row", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A", "B"], [{ heading: "A" }]);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, "a new trigger the classifier would never fire on must fail");
    assert.match(`${run.stdout}${run.stderr}`, /no row for checklist heading: B/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on a row naming a heading that no longer exists", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }, { heading: "renamed away" }]);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, "a tier decision applying to nothing must fail");
    assert.match(`${run.stdout}${run.stderr}`, /no longer has: renamed away/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers fails on two rows for one heading", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }, { heading: "A" }]);
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 1, "the classifier would pick whichever duplicate it saw first");
    assert.match(`${run.stdout}${run.stderr}`, /more than one row: A/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES an unreadable checklist rather than calling every row stale", () => {
  // The reading that would look like an answer. Treating an absent
  // checklist as zero headings makes every row "stale" and prints a
  // confident, detailed, wholly wrong failure about a file never opened.
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }]);
    rmSync(join(dir, "checklist.md"));
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2, "could not answer is not the same as failed");
    // The REASON, not only the code: the gate maps any exception to exit 2,
    // so with this guard removed the function crashes on `undefined.split`
    // and still exits 2. A mutation pass found this test passing that way.
    assert.match(`${run.stdout}${run.stderr}`, /cannot read the checklist/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES a checklist with no headings at all", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }]);
    writeFileSync(join(dir, "checklist.md"), "# Checklist\n\nno trigger sections\n");
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(
      run.status,
      2,
      "a parse that finds nothing is not a checklist that declares nothing",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES a row whose tier is unknown or whose globs are missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    tierFixture(dir, ["A"], [{ heading: "A" }]);
    const args = [
      "--checklist",
      join(dir, "checklist.md"),
      "--table",
      join(dir, "review-tiers.json"),
    ];

    writeFileSync(
      join(dir, "review-tiers.json"),
      JSON.stringify({
        trivial: VALID_TRIVIAL,
        rows: [{ heading: "A", tier: "sort-of-risky", globs: ["x/"], why: "f" }],
      }),
    );
    const unknown = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(unknown.status, 2, "unknown tier");
    assert.match(`${unknown.stdout}${unknown.stderr}`, /tier must be one of/);

    writeFileSync(
      join(dir, "review-tiers.json"),
      JSON.stringify({
        trivial: VALID_TRIVIAL,
        rows: [{ heading: "A", tier: "high-risk", why: "f" }],
      }),
    );
    const noGlobs = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(
      noGlobs.status,
      2,
      "a path tier with no globs is a row that can never match, not a routine one",
    );
    // With the guard removed this reaches `for (const g of undefined)` and
    // throws a TypeError the gate also maps to 2 -- found surviving by a
    // mutation pass. The message is what proves the guard fired.
    assert.match(`${noGlobs.stdout}${noGlobs.stderr}`, /needs at least one glob/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- WS3: the pattern language, the matcher, and pr-risk.mjs ---------------
//
// The language is small on purpose, so these pin it shape by shape rather
// than sampling. The dot-segment cases are the ones that matter most:
// `path.matchesGlob` declines to match them, which would have silently
// emptied the "Every PR" row of everything under `.claude/` and
// `.github/` -- a classifier reading fewer files than it claims while
// printing a confident tier.

const { classify, matchesPattern, patternFault } = await import(
  pathToFileURL(join(SCRIPTS, "lib", "review-tiers.mjs")).href
);

test("matchesPattern implements the four shapes and nothing else", () => {
  // `**` is every path, dot-segments included.
  assert.equal(matchesPattern("CLAUDE.md", "**"), true);
  assert.equal(matchesPattern(".github/workflows/ci.yml", "**"), true);
  assert.equal(matchesPattern(".beads/issues.jsonl", "**"), true);

  // A directory prefix covers what is under it, at any depth.
  assert.equal(matchesPattern("barwise/packages/cli/src/index.ts", "barwise/packages/cli/"), true);
  assert.equal(matchesPattern("barwise/packages/cli/a/b/c.ts", "barwise/packages/cli/"), true);
  // ...and nothing that merely shares its prefix as a string.
  assert.equal(matchesPattern("barwise/packages/climate.ts", "barwise/packages/cli/"), false);
  // ...nor the directory itself: git lists files, so this would be an
  // answer about something that was not changed.
  assert.equal(matchesPattern("barwise/packages/cli", "barwise/packages/cli/"), false);

  // A `*` is exactly one segment.
  assert.equal(
    matchesPattern("barwise/packages/core/tests/a.ts", "barwise/packages/*/tests/"),
    true,
  );
  assert.equal(
    matchesPattern("barwise/packages/core/tests/x/a.ts", "barwise/packages/*/tests/"),
    true,
  );
  assert.equal(
    matchesPattern("barwise/packages/core/src/a.ts", "barwise/packages/*/tests/"),
    false,
  );

  // An exact path is exact.
  assert.equal(matchesPattern("barwise/package.json", "barwise/package.json"), true);
  assert.equal(matchesPattern("barwise/package-lock.json", "barwise/package.json"), false);
  assert.equal(matchesPattern("barwise/CLAUDE.md", "CLAUDE.md"), false);
});

test("matchesPattern matches dot-segments, where node's glob would not", () => {
  // The divergence that decided against `path.matchesGlob`, pinned so a
  // later "simplify this to matchesGlob" fails instead of silently
  // dropping every rule-bearing path in the repository.
  assert.equal(matchesPattern(".claude/skills/pr-review/checklist.md", ".claude/skills/"), true);
  assert.equal(matchesPattern(".github/workflows/ci.yml", ".github/workflows/"), true);
  assert.equal(
    matchesPattern("barwise/packages/vscode/.vscodeignore", "barwise/packages/vscode/"),
    true,
  );
});

test("patternFault refuses a shape that would match nothing and look like a rule", () => {
  assert.equal(patternFault("**"), null);
  assert.equal(patternFault("a/b/"), null);
  assert.equal(patternFault("a/*/c/"), null);
  assert.equal(patternFault("a/b.json"), null);

  // `*.ts` is the trap: valid-looking, parses, matches nothing.
  assert.match(patternFault("*.ts"), /one whole path segment/);
  assert.match(patternFault("src/**/*.test.ts"), /one whole path segment/);
  assert.match(patternFault("/etc/passwd"), /absolute/);
  assert.match(patternFault("a//b"), /empty path segment/);
});

test("classify: a high-risk row decides the tier, and an always row does not", () => {
  const rows = [
    { heading: "Every PR", tier: "always", globs: ["**"], why: "w" },
    { heading: "core", tier: "high-risk", globs: ["pkg/core/src/"], why: "w" },
    { heading: "specs", tier: "routine", globs: ["docs/specs/"], why: "w" },
    { heading: "semantic", tier: "not-path-derivable", why: "w" },
  ];

  const routine = classify(["docs/specs/a.md"], rows);
  assert.equal(routine.tier, "routine", "an always row matching everything must not promote");
  assert.deepEqual(routine.matched.map((r) => r.heading).sort(), ["Every PR", "specs"]);

  const risky = classify(["docs/specs/a.md", "pkg/core/src/b.ts"], rows);
  assert.equal(risky.tier, "high-risk");
  assert.deepEqual(
    risky.matched.find((r) => r.heading === "core").files,
    ["pkg/core/src/b.ts"],
    "the triggering files are reported so the verdict can be checked against the diff",
  );
});

test("classify always reports the groups no path can reach", () => {
  // The spec's own warning: WS4 must not read `routine` as "the checklist
  // is satisfied". Three groups never match anything, so the verdict
  // carries them rather than expecting each caller to remember.
  const rows = [
    { heading: "specs", tier: "routine", globs: ["docs/specs/"], why: "w" },
    { heading: "a type was introduced", tier: "not-path-derivable", why: "w" },
    { heading: "a copy was edited", tier: "not-path-derivable", why: "w" },
  ];
  const out = classify(["docs/specs/a.md"], rows);
  assert.equal(out.tier, "routine");
  assert.deepEqual(out.beyondReach.map((r) => r.heading), [
    "a type was introduced",
    "a copy was edited",
  ]);
});

/** Write a changed-file list, and the args that make pr-risk read it. */
function fileList(dir, files) {
  const path = join(dir, "files.txt");
  writeFileSync(path, `${files.join("\n")}\n`);
  return ["--files", path];
}

test("pr-risk classifies a real file list and exits 0 for either tier [adr:review-policy#tier-informs]", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const routine = gate("pr-risk.mjs", dir, ...fileList(dir, ["barwise/docs/specs/a.spec.md"]));
    assert.equal(routine.status, 0, `${routine.stdout}${routine.stderr}`);
    assert.match(routine.stdout, /^pr-risk: routine/m);

    const risky = gate("pr-risk.mjs", dir, ...fileList(dir, ["barwise/packages/core/src/a.ts"]));
    assert.equal(
      risky.status,
      0,
      "high-risk is an ANSWER, not a failure -- the gate contract lets such a PR merge on a clean review",
    );
    assert.match(risky.stdout, /^pr-risk: high-risk/m);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk names the triggering heading and the file that triggered it", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const run = gate("pr-risk.mjs", dir, ...fileList(dir, ["barwise/packages/core/src/model.ts"]));
    assert.match(run.stdout, /@barwise\/core` changed/);
    assert.match(run.stdout, /barwise\/packages\/core\/src\/model\.ts/);
    // The groups no path can see are listed on every run, under their own
    // heading (review-routing WS1), so a routine tier never reads as a
    // satisfied checklist; and for a routine tier the caveat WS4 depends
    // on is still printed.
    assert.match(run.stdout, /Checklist groups no path can detect -- run these on every PR too/);
    const routine = gate("pr-risk.mjs", dir, ...fileList(dir, ["barwise/docs/specs/a.spec.md"]));
    assert.match(routine.stdout, /routine tier does NOT mean the checklist is satisfied/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * The routing a reviewer works from (review-routing.spec.md): the groups
 * and REVIEW.md failure modes first, the tier last; every failure mode
 * printed, the path-triggered ones first with their files; and the
 * failure modes never change the tier or the exit status.
 */
test("pr-risk leads with the routing and prints every REVIEW.md failure mode [adr:review-policy#tier-informs]", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const run = gate("pr-risk.mjs", dir, ...fileList(dir, ["barwise/scripts/x.mjs"]));
    assert.equal(run.status, 0);
    const out = run.stdout;
    const at = (re) => out.search(re);
    assert.ok(at(/^Checklist groups to run/m) === 0, "the groups come first");
    assert.ok(at(/^REVIEW\.md failure modes -- run all of them/m) > 0);
    assert.ok(at(/^pr-risk: high-risk/m) > at(/^REVIEW\.md failure modes/m), "the tier comes last");
    const triggered = out.indexOf("A gate answers without seeing its input");
    const rest = out.indexOf("not triggered by the paths in this diff -- still run:");
    assert.ok(triggered > 0 && rest > triggered, "the triggered mode is listed before the rest");
    for (
      const title of ["Input dropped at a boundary", "A restated fact went stale", "ORM shape"]
    ) {
      assert.ok(out.indexOf(title) > rest, `${title} is still listed, after the triggered ones`);
    }
    // The mode no path can ever detect has its own heading, apart from the
    // ones this diff's paths happened not to trigger.
    const pathless = out.indexOf("no path can detect -- run on every PR:");
    assert.ok(pathless > rest && out.indexOf("A restated fact went stale") > pathless);
    assert.ok(out.indexOf("ORM shape") < pathless, "a path-routed mode is not listed as pathless");
    const json = JSON.parse(
      gate("pr-risk.mjs", dir, ...fileList(dir, ["barwise/scripts/x.mjs"]), "--json").stdout,
    );
    assert.deepEqual(json.failureModes.map((m) => m.heading).sort(), [
      "A gate answers without seeing its input",
      "A test that cannot fail",
      "PR description claims",
    ]);
    assert.equal(json.failureModes.length + json.failureModesBeyondReach.length, 8);
    // A failure mode alone never makes a diff high-risk: a formats file
    // triggers the high-risk "Boundary text" mode and no high-risk
    // checklist row, and the tier stays routine.
    const ddl = JSON.parse(
      gate(
        "pr-risk.mjs",
        dir,
        ...fileList(dir, ["barwise/packages/formats/src/ddl/a.ts"]),
        "--json",
      ).stdout,
    );
    assert.ok(
      ddl.failureModes.some((m) => m.heading === "Boundary text" && m.tier === "high-risk"),
    );
    assert.equal(ddl.tier, "routine", "failure modes route; they do not change the tier");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk REFUSES an empty changed-file list rather than calling it routine", () => {
  // The reading that looks like an answer: nothing changed and nothing
  // matched are indistinguishable downstream, and "routine" is what a
  // git call about the wrong tree would also produce.
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const run = gate("pr-risk.mjs", dir, ...fileList(dir, []));
    assert.equal(run.status, 2, "could not answer is not routine");
    assert.doesNotMatch(run.stdout, /routine|high-risk/, "a refusal must print no tier");
    assert.match(run.stderr, /changed-file list is empty/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk REFUSES when the inputs cannot be read, and prints no tier", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const absent = gate("pr-risk.mjs", dir, "--files", join(dir, "nope.txt"));
    assert.equal(absent.status, 2, "an unreadable file list");
    assert.doesNotMatch(absent.stdout, /routine|high-risk/);

    writeFileSync(join(dir, "table.json"), "{ not json");
    const badTable = gate(
      "pr-risk.mjs",
      dir,
      ...fileList(dir, ["barwise/docs/specs/a.spec.md"]),
      "--table",
      join(dir, "table.json"),
    );
    assert.equal(badTable.status, 2, "an unparseable tier table");
    assert.doesNotMatch(badTable.stdout, /routine|high-risk/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk REFUSES a base ref git cannot resolve, from inside a repository", () => {
  // Run from REPO deliberately. This case lived in the temp-dir test
  // above and passed there for the WRONG reason: outside a repository
  // `pr-risk` refuses while lazily importing tracked.mjs, so it never
  // reached the `git diff` it claims to exercise, and a regression in
  // that catch block would have stayed green. Caught by review, not by
  // the six mutations -- none of which touched the git-diff path.
  const run = gate("pr-risk.mjs", REPO, "--base", "origin/no-such-ref-here");
  assert.equal(run.status, 2, "a base ref git cannot resolve, as in a shallow clone");
  assert.doesNotMatch(run.stdout, /routine|high-risk/, "a refusal prints no tier");
  assert.match(run.stderr, /git diff --name-status origin\/no-such-ref-here/);
  assert.doesNotMatch(
    run.stderr,
    /rev-parse --show-toplevel/,
    "this must be the git-diff refusal, not the repo-root one standing in for it",
  );
});

test("pr-risk REFUSES a flag given with no value, rather than defaulting", () => {
  // `--base` with nothing after it used to fall back to origin/main and
  // print a confident tier for a base the caller never named.
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    for (const argv of [["--base"], ["--files"], ["--changes"], ["--base", "--json"]]) {
      const run = gate("pr-risk.mjs", REPO, ...argv);
      assert.equal(run.status, 2, `${argv.join(" ")} must refuse`);
      assert.doesNotMatch(run.stdout, /routine|high-risk/, `${argv.join(" ")} printed a tier`);
      assert.match(run.stderr, /given with no value/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES a table whose pattern the language does not define", () => {
  // The validation added in WS3 is wired into `tierRows`, but every test
  // for it called `patternFault` directly -- so deleting the two lines
  // that call it would have left the suite green while the gate accepted
  // a row that can never fire. This exercises it through the gate.
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    tierFixture(dir, ["A"], [{ heading: "A" }]);
    const args = [
      "--checklist",
      join(dir, "checklist.md"),
      "--table",
      join(dir, "review-tiers.json"),
    ];
    for (const glob of ["*.ts", "./barwise/scripts/", "a/../b/"]) {
      writeFileSync(
        join(dir, "review-tiers.json"),
        JSON.stringify({
          trivial: VALID_TRIVIAL,
          rows: [{ heading: "A", tier: "routine", globs: [glob], why: "f" }],
        }),
      );
      const run = gate("check-review-tiers.mjs", dir, ...args);
      assert.equal(run.status, 2, `${glob} is valid JSON and an invalid pattern`);
      assert.match(`${run.stdout}${run.stderr}`, /cannot answer/);
      // The pattern's own fault, not any refusal: the table also lacks a
      // failureModes block, which the gate refuses too, so the exit code
      // alone would pass with pattern validation deleted (round-1 review).
      assert.ok(
        `${run.stdout}${run.stderr}`.includes(`pattern ${JSON.stringify(glob)}`),
        `${glob}: refused for its pattern`,
      );
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("patternFault refuses a dot segment, which git never prints", () => {
  assert.match(patternFault("./barwise/scripts/"), /"\." segment/);
  assert.match(patternFault("../etc/"), /"\.\." segment/);
  assert.match(patternFault("barwise/./scripts/"), /"\." segment/);
  assert.match(patternFault("barwise/../etc/"), /"\.\." segment/);
});

test("pr-risk REFUSES a path list that is not repo-root-relative", () => {
  // Found on a second read of the diff, not by any gate: a `./`-prefixed
  // path matches nothing but the `**` row, so the run classifies as
  // routine over a list it could not read. The two real producers never
  // emit these shapes, so one means the list came from somewhere else.
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    for (
      const bad of ["./barwise/docs/specs/b.spec.md", "/abs/path.ts", "barwise/../etc/x", "a/.."]
    ) {
      const run = gate("pr-risk.mjs", dir, ...fileList(dir, [bad]));
      assert.equal(run.status, 2, `${bad} must refuse, not classify`);
      assert.doesNotMatch(run.stdout, /routine|high-risk/, `${bad} printed a tier`);
      assert.match(run.stderr, /not repo-root-relative/, bad);
    }
    // A dot SEGMENT is refused; dots inside a name are a legal name. The
    // first version tested the substring and refused these (#533 review).
    for (const legal of ["barwise/packages/core/src/a..b.ts", "..hidden/x", "x/.env", "y/..."]) {
      const run = gate("pr-risk.mjs", dir, ...fileList(dir, [legal]));
      assert.equal(run.status, 0, `${legal} is a legal path:\n${run.stderr}`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk gives the same answer from every cwd", () => {
  // barwise-918: the file list is repo-root-relative, so a classifier
  // that resolved paths against cwd would quietly match fewer rows.
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const args = fileList(dir, ["barwise/packages/core/src/a.ts", "barwise/docs/specs/b.spec.md"]);
    const outputs = new Set(CWDS.map((cwd) => gate("pr-risk.mjs", cwd, ...args).stdout));
    assert.equal(outputs.size, 1, `pr-risk depends on cwd:\n${[...outputs].join("\n---\n")}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- WS1: the trivial allow-list that decides whether Copilot is requested -

const { isTrivial, trivialGlobs } = await import(
  pathToFileURL(join(SCRIPTS, "lib", "review-tiers.mjs")).href
);

test("isTrivial: every change must be an EDIT to an allow-listed path, and none is not trivial", () => {
  const globs = [".beads/issues.jsonl"];
  const edit = (path) => ({ path, status: "modified" });
  assert.equal(isTrivial([edit(".beads/issues.jsonl")], globs), true, "a tracker closure");
  assert.equal(
    isTrivial([edit(".beads/issues.jsonl"), edit("barwise/docs/specs/a.spec.md")], globs),
    false,
    "one file off the list makes the whole PR non-trivial",
  );
  assert.equal(isTrivial([edit("barwise/packages/diagram/src/a.ts")], globs), false);
  // The evidence is edits. A rename's source is elsewhere, a delete is not
  // a closure, and a bare path list cannot say which it was.
  for (const status of ["removed", "added", "renamed", "changed", null]) {
    assert.equal(
      isTrivial([{ path: ".beads/issues.jsonl", status }], globs),
      false,
      `status ${status} on an allow-listed path`,
    );
  }
  // The trap the function exists for: [].every(...) is true.
  assert.equal(isTrivial([], globs), false, "no files must never read as nothing to review");
});

test("trivialGlobs REFUSES a table that would exempt the wrong things, or say nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-trivial-"));
  try {
    const table = join(dir, "t.json");
    const rows = [{ heading: "A", tier: "routine", globs: ["x/"], why: "f" }];
    const cases = [
      [{ rows }, /no trivial\.globs/, "a missing block"],
      [{ rows, trivial: { globs: [], why: "w" } }, /no trivial\.globs/, "an empty list"],
      [
        { rows, trivial: { globs: ["**"], why: "w" } },
        /exempt everything/,
        "** would switch review off",
      ],
      [
        { rows, trivial: { globs: ["*.md"], why: "w" } },
        /one whole path segment/,
        "a pattern outside the language",
      ],
      [{ rows, trivial: { globs: [".beads/"] } }, /trivial\.why/, "no stated reason"],
    ];
    for (const [json, pattern, label] of cases) {
      writeFileSync(table, JSON.stringify(json));
      assert.throws(() => trivialGlobs(table), pattern, label);
    }
    writeFileSync(table, JSON.stringify({ rows, trivial: VALID_TRIVIAL }));
    assert.deepEqual(trivialGlobs(table), [".beads/issues.jsonl"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-review-tiers REFUSES a trivial allow-list of **, through the gate", () => {
  // Through the gate, not only the function: a one-character edit to the
  // table must fail CI on the PR that makes it, not surface later as a
  // reviewer that silently stopped being requested.
  const dir = mkdtempSync(join(tmpdir(), "barwise-trivial-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }]);
    assert.equal(
      gate("check-review-tiers.mjs", dir, ...args).status,
      0,
      "the valid fixture passes",
    );
    writeFileSync(
      join(dir, "review-tiers.json"),
      JSON.stringify({
        trivial: { globs: ["**"], why: "w" },
        rows: [{ heading: "A", tier: "routine", globs: ["x/"], why: "f" }],
      }),
    );
    const run = gate("check-review-tiers.mjs", dir, ...args);
    assert.equal(run.status, 2);
    assert.match(`${run.stdout}${run.stderr}`, /exempt everything/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * Write pull request files API records, one JSON object per line as the
 * Copilot workflow's `--jq ... | @json` prints them, and the args that
 * make pr-risk read them. Each change is `[status, filename, previous]`.
 */
function changeList(dir, changes) {
  const path = join(dir, "changes.ndjson");
  const recs = changes.map(([status, filename, previous_filename = null]) =>
    JSON.stringify({ filename, status, previous_filename })
  );
  writeFileSync(path, recs.map((r) => `${r}\n`).join(""));
  return ["--changes", path];
}

test("pr-risk reports trivial for a tracker edit through --changes, and for nothing wider", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const read = (changes) => {
      const run = gate("pr-risk.mjs", dir, ...changeList(dir, changes), "--json");
      assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
      return JSON.parse(run.stdout);
    };
    assert.equal(read([["modified", ".beads/issues.jsonl"]]).trivial, true, "a tracker edit");
    const reviewed = [
      [[["modified", ".beads/issues.jsonl"], ["modified", "README.md"]], "docs"],
      [[["modified", "barwise/docs/specs/a.spec.md"]], "a spec"],
      [[["modified", "barwise/packages/diagram/src/a.ts"]], "code no row covers"],
      // The rest of .beads/ is tracked executable git hooks, among others.
      [[["modified", ".beads/hooks/pre-commit"]], "a hook beside the tracker"],
      [[["removed", ".beads/issues.jsonl"]], "the tracker deleted"],
      // Names are exact. The first version trimmed, so this WAS the tracker.
      [[["modified", " .beads/issues.jsonl"]], "a name with a leading space"],
      [[["modified", "x\n.beads/issues.jsonl"]], "a name with an embedded newline"],
    ];
    for (const [changes, label] of reviewed) {
      assert.equal(read(changes).trivial, false, `${label} must be reviewed`);
    }
    // A rename is classified from BOTH ends: code moved out of core, in
    // under the tracker's name, is a core change and not a closure.
    const moved = read([["renamed", ".beads/issues.jsonl", "barwise/packages/core/src/a.ts"]]);
    assert.equal(moved.trivial, false, "a rename into the allow-list");
    assert.equal(moved.tier, "high-risk", "the rename's source is classified too");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk --files never reports trivial, and REFUSES a padded path rather than trimming it", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const run = gate("pr-risk.mjs", dir, ...fileList(dir, [".beads/issues.jsonl"]), "--json");
    assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
    assert.equal(JSON.parse(run.stdout).trivial, false, "a bare list has no status to be an edit");
    for (const bad of [" .beads/issues.jsonl", ".beads/issues.jsonl\r"]) {
      const padded = gate("pr-risk.mjs", dir, ...fileList(dir, [bad]));
      assert.equal(padded.status, 2, `${JSON.stringify(bad)} must refuse`);
      assert.doesNotMatch(padded.stdout, /routine|high-risk/);
      assert.match(padded.stderr, /begin or end with whitespace/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk REFUSES a --changes record it cannot read, naming the line", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-risk-"));
  try {
    const path = join(dir, "changes.ndjson");
    const cases = [
      ["not json", /line 1 is not JSON/],
      [JSON.stringify({ filename: "a/b.ts" }), /line 1 is not a files API record/],
      [JSON.stringify({ status: "modified" }), /line 1 is not a files API record/],
      [JSON.stringify(".beads/issues.jsonl"), /line 1 is not a files API record/],
      [
        JSON.stringify({ filename: "a/b.ts", status: "renamed", previous_filename: 7 }),
        /previous_filename that is not a path/,
      ],
      [
        JSON.stringify({ filename: "a/b.ts", status: "renamed", previous_filename: "../x" }),
        /not repo-root-relative/,
      ],
    ];
    for (const [line, message] of cases) {
      writeFileSync(path, `${line}\n`);
      const run = gate("pr-risk.mjs", dir, "--changes", path);
      assert.equal(run.status, 2, `${line} must refuse`);
      assert.doesNotMatch(run.stdout, /routine|high-risk/, `${line} printed a tier`);
      assert.match(run.stderr, message, line);
    }
    const both = gate("pr-risk.mjs", dir, "--changes", path, ...fileList(dir, ["a/b.ts"]));
    assert.equal(both.status, 2);
    assert.match(both.stderr, /both given/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pr-risk's git path keeps a rename's source and reads names exactly", () => {
  // `--name-only` names only a rename's destination, so moving a core
  // file to the tracker's path printed `.beads/issues.jsonl` alone: core
  // row missed, and a tracker "edit" by name. `--no-renames -z` fixes both.
  const dir = tempRepo();
  try {
    stage(dir, "barwise/packages/core/src/a.ts", "export const a = 1;\n");
    execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
    execFileSync("git", ["branch", "-M", "main"], { cwd: dir });
    const branch = (name, change) => {
      execFileSync("git", ["checkout", "-q", "-B", name, "main"], { cwd: dir });
      change();
      execFileSync("git", ["commit", "-qam", name], { cwd: dir });
      const run = gate("pr-risk.mjs", dir, "--base", "main", "--json");
      assert.equal(run.status, 0, `${run.stdout}${run.stderr}`);
      return JSON.parse(run.stdout);
    };
    const moved = branch("move", () => {
      mkdirSync(join(dir, ".beads"));
      execFileSync("git", ["mv", "barwise/packages/core/src/a.ts", ".beads/issues.jsonl"], {
        cwd: dir,
      });
    });
    assert.equal(moved.tier, "high-risk", "the rename's source is a core change");
    assert.equal(moved.trivial, false);
    assert.equal(moved.fileCount, 2, "a delete and an add");

    // Main gains the tracker AND a look-alike, so a branch can EDIT either:
    // same status, and only the exact name makes the edit trivial.
    execFileSync("git", ["checkout", "-q", "main"], { cwd: dir });
    stage(dir, ".beads/issues.jsonl", "{}\n");
    stage(dir, " .beads/issues.jsonl", "{}\n");
    execFileSync("git", ["commit", "-qm", "tracker"], { cwd: dir });
    const edit = (name) => () => writeFileSync(join(dir, name), "{}\n{}\n");
    assert.equal(branch("edit", edit(".beads/issues.jsonl")).trivial, true, "a tracker edit");
    assert.equal(
      branch("pad", edit(" .beads/issues.jsonl")).trivial,
      false,
      "an edit to a name with a leading space is not a tracker edit",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the Copilot workflow reads its allow-list from main, never from the pull request [adr:review-policy#copilot-requested]", () => {
  // pull_request would check out the PR's tree, and a PR could widen the
  // allow-list and exempt itself. This pins the trigger and the checkout.
  const wf = readFileSync(join(REPO, ".github/workflows/copilot-review.yml"), "utf8");
  assert.match(wf, /^\s*pull_request_target:/m, "must run in the base branch's context");
  assert.doesNotMatch(wf, /^\s*pull_request:/m, "plain pull_request would read the PR's own table");
  assert.doesNotMatch(
    wf,
    /ref:\s*\$\{\{\s*github\.event\.pull_request\.head/,
    "checking out the PR head under pull_request_target runs its code with a write token",
  );
  assert.doesNotMatch(
    wf,
    /\$\{\{\s*github\.event\.pull_request\.(title|body|head\.ref)/,
    "PR-controlled strings must reach the shell through env, never interpolation",
  );
  // Named, not left to the event: a workflow_dispatch checks out the ref it
  // was started from, so a run from a branch read that branch's table.
  assert.match(
    wf,
    /- uses: actions\/checkout@\S+\n(?:\s+if: .*\n)?\s+with:\n\s+ref: \$\{\{ github\.event\.repository\.default_branch \}\}\n/,
    "the checkout must name the default branch",
  );
});

// --- The workflow's shell, run as written against a stubbed `gh` -----------
//
// Both `run:` blocks are cut out of the YAML and executed, so a test here
// exercises the text Actions will run rather than a copy of it. The stub
// answers each API path from a file and can be told to fail one.

const WORKFLOW = join(REPO, ".github/workflows/copilot-review.yml");

/** The `run: |` body of the step called `name`, dedented as Actions does. */
function workflowRun(name) {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const at = lines.findIndex((l) => l.trim() === `- name: ${name}`);
  assert.notEqual(at, -1, `no step named ${JSON.stringify(name)}`);
  const runAt = lines.findIndex((l, i) => i > at && /^\s*run: \|\s*$/.test(l));
  const nextStep = lines.findIndex((l, i) => i > at && /^\s*- (name|uses):/.test(l));
  assert.ok(runAt !== -1 && (nextStep === -1 || runAt < nextStep), `${name} has no run block`);
  const indent = lines[runAt].search(/\S/);
  const body = [];
  for (const l of lines.slice(runAt + 1)) {
    if (l.trim() !== "" && l.search(/\S/) <= indent) break;
    body.push(l);
  }
  const pad = Math.min(...body.filter((l) => l.trim()).map((l) => l.search(/\S/)));
  return `${body.map((l) => l.slice(pad)).join("\n").trimEnd()}\n`;
}

/** A literal from the job's `env:` block, unquoted as YAML would. */
function workflowEnv(key) {
  const lines = readFileSync(WORKFLOW, "utf8").split("\n");
  const at = lines.findIndex((l) => new RegExp(`^\\s+${key}: `).test(l));
  assert.notEqual(at, -1, `no ${key} in the workflow env`);
  const v = lines[at].slice(lines[at].indexOf(": ") + 2).trim();
  if (v === ">-") {
    // A folded block: the more-indented lines below, joined by spaces.
    const indent = lines[at].search(/\S/);
    const body = [];
    for (const l of lines.slice(at + 1)) {
      if (l.trim() !== "" && l.search(/\S/) <= indent) break;
      body.push(l.trim());
    }
    return body.filter(Boolean).join(" ");
  }
  return v.startsWith("'") ? v.slice(1, -1).replaceAll("''", "'") : v;
}

const GH_STUB = `#!/bin/bash
# gh api [--paginate] [--method M] PATH [--jq EXPR] [--input -]
shift
method=GET; path=""; jqx=""; input=""
while [ $# -gt 0 ]; do
  case "$1" in
    --paginate) ;;
    --method) shift; method="$1" ;;
    --jq) shift; jqx="$1" ;;
    --input) shift; input="$(cat)" ;;
    *) path="$1" ;;
  esac
  shift
done
echo "$method $path" >> "$STUB/log"
case "$method $path" in
  "GET repos/o/r/pulls/7") name=pr ;;
  "GET repos/o/r/pulls/7/reviews") name=reviews ;;
  "GET repos/o/r/pulls/7/files") name=files ;;
  "GET repos/o/r/issues/7/events") name=events ;;
  "POST repos/o/r/pulls/7/requested_reviewers") name=post; printf '%s' "$input" > "$STUB/posted" ;;
  *) echo "stub gh: unexpected $method $path" >&2; exit 99 ;;
esac
if [ -e "$STUB/$name.fail" ]; then echo "stub gh: HTTP 502 on $path" >&2; exit 1; fi
# The event history as it reads once the request has been POSTed, if the
# case gave one; otherwise it does not change.
file=$name
if [ "$name" = events ] && [ -e "$STUB/posted" ] && [ -e "$STUB/events.after.json" ]; then
  file=events.after
fi
# gh prints a string result raw and anything else as JSON, as jq -r does.
if [ -n "$jqx" ]; then jq -r "$jqx" < "$STUB/$file.json"; else cat "$STUB/$file.json"; fi
`;

/**
 * Run one step's shell with the stub answering. `api` maps a stub name
 * (pr, reviews, requested, files, post) to its JSON body; `fail` names
 * the calls that fail. Returns what a reader of the job log would see.
 */
function runWorkflowStep(name, api, fail = []) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-wf-"));
  try {
    mkdirSync(join(dir, "bin"));
    writeFileSync(join(dir, "bin", "gh"), GH_STUB, { mode: 0o755 });
    const answers = {
      pr: { draft: false },
      reviews: [],
      events: [],
      // A request that lands leaves a review_requested event, and that is
      // the readback. The POST response is deliberately useless, as it is
      // live: requested_reviewers never lists Copilot (measured on #534).
      "events.after": [copilotRequest(ago(0))],
      files: [],
      post: { requested_reviewers: [], requested_teams: [] },
      ...api,
    };
    for (const [k, v] of Object.entries(answers)) {
      writeFileSync(join(dir, `${k}.json`), JSON.stringify(v));
    }
    for (const f of fail) writeFileSync(join(dir, `${f}.fail`), "");
    writeFileSync(join(dir, "output"), "");
    writeFileSync(join(dir, "step.sh"), workflowRun(name));
    // Actions runs `run:` with exactly these bash flags.
    const run = spawnSync("bash", [
      "--noprofile",
      "--norc",
      "-eo",
      "pipefail",
      join(dir, "step.sh"),
    ], {
      cwd: REPO,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${join(dir, "bin")}:${dirname(process.execPath)}:${process.env.PATH}`,
        STUB: dir,
        REPO: "o/r",
        PR: "7",
        BOT: workflowEnv("BOT"),
        COPILOT: workflowEnv("COPILOT"),
        REAL_REVIEW: workflowEnv("REAL_REVIEW"),
        OUTSTANDING: workflowEnv("OUTSTANDING"),
        READBACK_WAIT: "0",
        RUNNER_TEMP: dir,
        GITHUB_OUTPUT: join(dir, "output"),
      },
    });
    const read = (f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f), "utf8") : null);
    return {
      status: run.status,
      log: `${run.stdout}${run.stderr}`,
      output: read("output"),
      calls: read("log") ?? "",
      posted: read("posted"),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DECIDE = "Decide whether a request is needed";
const CLASSIFY = "Classify, and request Copilot if non-trivial";
const COPILOT_LOGIN = "copilot-pull-request-reviewer[bot]"; // as the reviews API reported it on #533
const QUOTA_REFUSAL =
  "Copilot was unable to review this pull request because the user who requested "
  + "the review has reached their quota limit."; // verbatim, #516, 2026-09-18

/** A GitHub timestamp `seconds` ago -- whole seconds, as the API prints them. */
function ago(seconds) {
  return new Date(Date.now() - seconds * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** A Copilot request in the event history, shaped as #534's was. */
function copilotRequest(at, event = "review_requested") {
  return {
    id: Date.parse(at),
    event,
    created_at: at,
    actor: { login: "github-actions[bot]" },
    requested_reviewer: { login: "Copilot", type: "Bot" },
  };
}

/** A review by `login` at `at`, with an optional body. */
function review(login, at, body = "") {
  return { id: Date.parse(at), user: login && { login }, submitted_at: at, body };
}

test("workflow, decide: requests only when Copilot has neither reviewed nor been requested", () => {
  const cases = [
    ["a draft", { pr: { draft: true } }, "false", /is a draft/],
    ["a fresh PR", {}, "true", null],
    [
      "Copilot already reviewed",
      { reviews: [review(COPILOT_LOGIN, ago(600))] },
      "false",
      /already reviewed/,
    ],
    [
      "a human review, and a deleted account's review with a null user",
      { reviews: [review("alice", ago(600)), review(null, ago(500))] },
      "true",
      null,
    ],
    // Requested and not yet answered: the ~8 minutes a review takes. The
    // reviewer list never shows Copilot, so this reads the event history.
    [
      "requested a minute ago, not answered",
      { events: [copilotRequest(ago(60))] },
      "false",
      /has not answered yet/,
    ],
    [
      "a team request, whose requested_reviewer is null",
      { events: [{ ...copilotRequest(ago(60)), requested_reviewer: null }] },
      "true",
      null,
    ],
    [
      "requested, then the request removed",
      { events: [copilotRequest(ago(120)), copilotRequest(ago(60), "review_request_removed")] },
      "true",
      null,
    ],
    [
      "requested two hours ago and never answered",
      { events: [copilotRequest(ago(7200))] },
      "true",
      null,
    ],
    // A refusal is posted AS a review, by the same bot, with the same
    // state; counting it meant a PR that met an empty quota was never
    // requested again. The text is the one measured on #516.
    [
      "Copilot's only review is a quota refusal",
      { reviews: [review(COPILOT_LOGIN, ago(60), QUOTA_REFUSAL)] },
      "true",
      null,
    ],
    [
      "requested, and answered with a quota refusal",
      {
        events: [copilotRequest(ago(120))],
        reviews: [review(COPILOT_LOGIN, ago(60), QUOTA_REFUSAL)],
      },
      "true",
      null,
    ],
    [
      "a quota refusal, then a real review",
      {
        reviews: [
          review(COPILOT_LOGIN, ago(600), QUOTA_REFUSAL),
          review(COPILOT_LOGIN, ago(60), "Approval recommended"),
        ],
      },
      "false",
      /already reviewed PR #7 \(1 review/,
    ],
    // Copilot drops a request on a Dependabot PR: seven of seven went red
    // on the readback, including one the owner started by hand
    // (barwise-ko7). Only that author is skipped; another bot is still
    // requested, because every uncertainty resolves toward requesting.
    [
      "a Dependabot PR",
      { pr: { draft: false, user: { login: "dependabot[bot]", type: "Bot" } } },
      "false",
      /by dependabot\[bot\].*barwise-ko7/,
    ],
    [
      "a PR by another bot",
      { pr: { draft: false, user: { login: "renovate[bot]", type: "Bot" } } },
      "true",
      null,
    ],
    [
      "a PR by a person",
      { pr: { draft: false, user: { login: "alice", type: "User" } } },
      "true",
      null,
    ],
  ];
  for (const [label, api, need, message] of cases) {
    const r = runWorkflowStep(DECIDE, api);
    assert.equal(r.status, 0, `${label}:\n${r.log}`);
    assert.equal(r.output, `need=${need}\n`, label);
    if (message) assert.match(r.log, message, label);
  }
  // Reading either history is not optional: a failure is red, never "none".
  for (const read of ["reviews", "events"]) {
    const r = runWorkflowStep(DECIDE, {}, [read]);
    assert.notEqual(r.status, 0, `a failed ${read} read must fail the step`);
    assert.equal(r.output, "", "and must not decide anything");
  }
});

test("workflow, classify: skips only an edit to the tracker; every other shape requests [adr:review-policy#copilot-requested]", () => {
  const rec = (status, filename, previous_filename) =>
    previous_filename ? { filename, status, previous_filename } : { filename, status };
  const skip = runWorkflowStep(CLASSIFY, { files: [rec("modified", ".beads/issues.jsonl")] });
  assert.equal(skip.status, 0, skip.log);
  assert.match(skip.log, /Trivial:/);
  assert.equal(skip.posted, null, "a tracker edit requests nothing");
  assert.doesNotMatch(skip.calls, /POST/);

  const requested = [
    ["the tracker deleted", [rec("removed", ".beads/issues.jsonl")]],
    [
      "code renamed into the tracker's path",
      [rec("renamed", ".beads/issues.jsonl", "barwise/packages/core/src/a.ts")],
    ],
    ["a git hook beside the tracker", [rec("modified", ".beads/hooks/pre-commit")]],
    ["a leading-space look-alike", [rec("modified", " .beads/issues.jsonl")]],
    ["a newline look-alike", [rec("modified", "x\n.beads/issues.jsonl")]],
    [
      "the tracker and a spec",
      [rec("modified", ".beads/issues.jsonl"), rec("modified", "barwise/docs/specs/a.spec.md")],
    ],
  ];
  for (const [label, files] of requested) {
    const r = runWorkflowStep(CLASSIFY, { files });
    assert.equal(r.status, 0, `${label}:\n${r.log}`);
    assert.deepEqual(JSON.parse(r.posted ?? "null"), { reviewers: [workflowEnv("BOT")] }, label);
    assert.match(r.log, /Requested\./, label);
  }
});

test("workflow, classify: every uncertainty requests, and a request that did not land is red [adr:review-policy#copilot-requested]", () => {
  const tracker = { filename: ".beads/issues.jsonl", status: "modified" };
  const uncertain = [
    ["the files API failing", {}, ["files"], /::warning::Could not read the changed files/],
    ["pr-risk refusing", { files: [{ filename: "./x", status: "modified" }] }, [], /exit 2/],
    ["an empty file list", { files: [] }, [], /exit 2/],
    [
      "a list the API may have truncated",
      { files: Array.from({ length: 3000 }, () => tracker) },
      [],
      /stops at 3000/,
    ],
  ];
  for (const [label, api, fail, message] of uncertain) {
    const r = runWorkflowStep(CLASSIFY, api, fail);
    assert.equal(r.status, 0, `${label}:\n${r.log}`);
    assert.match(r.log, message, label);
    assert.deepEqual(JSON.parse(r.posted ?? "null"), { reviewers: [workflowEnv("BOT")] }, label);
  }
  // The POST succeeds and no review_requested event follows.
  const lost = runWorkflowStep(CLASSIFY, {
    files: [{ filename: "barwise/packages/core/src/a.ts", status: "modified" }],
    events: [copilotRequest(ago(3600))],
    "events.after": [copilotRequest(ago(3600))],
  });
  assert.equal(lost.status, 1, "a request that did not land fails the job");
  assert.match(lost.log, /::error::.*no review_requested event/);
  assert.match(lost.log, /"review_requested"/, "and prints the event history that says why");
  // An OLD request does not satisfy the readback; only a new one does.
  assert.equal(
    lost.calls.match(/GET repos\/o\/r\/issues\/7\/events/g)?.length,
    5,
    "1 before, 3 tries, 1 print",
  );
});

test("the workflow asks who Copilot is in ONE place", () => {
  // Three checks -- past reviews, pending requests, the readback -- with
  // three spellings of Copilot could disagree, and the review check
  // disagreeing means a request on every push (a Copilot finding on #533).
  const wf = readFileSync(WORKFLOW, "utf8");
  assert.equal(wf.match(/contains\("copilot"\)/g)?.length, 1, "one definition");
  assert.equal(wf.match(/\$COPILOT\b/g)?.length, 3, "used by exactly the three checks");
  // And what counts as a review is decided once, too.
  assert.equal(
    wf.match(/was unable to review this pull request/g)?.length,
    1,
    "defined once",
  );
  assert.match(wf, /real: \$REAL_REVIEW/, "the reviews check uses it");
  // The reviewer list never shows Copilot -- empty in the POST response
  // and while its review ran, measured on #534 -- so nothing may read it.
  assert.doesNotMatch(wf, /\.requested_reviewers\b|\.users\[\]/, "no read of the reviewer list");
});

test("check-review-tiers names the defect it refuses, for every row and allow-list guard", () => {
  // One case per guard in tierRows and trivialGlobs, each asserting the
  // SPECIFIC message. An automated pass that neutralized every refusal in
  // lib/review-tiers.mjs found eight of them surviving: five no test
  // reached, and three reached only by tests that checked the exit code,
  // which a crash satisfies as well as a refusal does.
  const dir = mkdtempSync(join(tmpdir(), "barwise-tiers-"));
  try {
    const args = tierFixture(dir, ["A"], [{ heading: "A" }]);
    const ok = { heading: "A", tier: "routine", globs: ["x/"], why: "f" };
    const cases = [
      [{ trivial: VALID_TRIVIAL, rows: [] }, /declares no rows/, "an empty rows list"],
      [{ trivial: VALID_TRIVIAL }, /declares no rows/, "no rows key at all"],
      [
        { trivial: VALID_TRIVIAL, rows: [{ ...ok, heading: "" }] },
        /heading must be a non-empty string/,
        "an empty heading",
      ],
      [
        { trivial: VALID_TRIVIAL, rows: [{ ...ok, why: undefined }] },
        /why must be a non-empty string/,
        "no why",
      ],
      [
        {
          trivial: VALID_TRIVIAL,
          rows: [{ heading: "A", tier: "not-path-derivable", globs: ["x/"], why: "f" }],
        },
        /carry no globs/,
        "globs on a row the classifier cannot reach",
      ],
      [
        { trivial: VALID_TRIVIAL, rows: [{ ...ok, globs: [""] }] },
        /every glob must be a non-empty string/,
        "an empty glob",
      ],
      [
        { trivial: VALID_TRIVIAL, rows: [{ ...ok, globs: [42] }] },
        /every glob must be a non-empty string/,
        "a non-string glob",
      ],
      [
        { trivial: { globs: [""], why: "w" }, rows: [ok] },
        /every trivial glob must be a non-empty string/,
        "an empty trivial glob",
      ],
      [
        { trivial: { globs: [7], why: "w" }, rows: [ok] },
        /every trivial glob must be a non-empty string/,
        "a non-string trivial glob",
      ],
    ];
    for (const [json, pattern, label] of cases) {
      writeFileSync(join(dir, "review-tiers.json"), JSON.stringify(json));
      const run = gate("check-review-tiers.mjs", dir, ...args);
      assert.equal(run.status, 2, `${label}: must refuse`);
      assert.match(`${run.stdout}${run.stderr}`, pattern, `${label}: must refuse for THIS reason`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * check-tracker-closes: a diff that closes an issue changes nothing but
 * the tracker (docs/specs/tracker-only-closes.spec.md, barwise-i61).
 *
 * A sandbox repository, so each case is a diff built for it. The gate and
 * the one module it imports are copied in; `BASE_SHA` stands in for the
 * pull request's base commit, as ci.yml passes it.
 */
function trackerRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-closes-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, ".beads"));
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  for (const f of ["check-tracker-closes.mjs", join("lib", "changed-class.mjs")]) {
    writeFileSync(join(dir, "scripts", f), readFileSync(join(SCRIPTS, f)));
  }
  const issues = (rows) =>
    writeFileSync(
      join(dir, ".beads", "issues.jsonl"),
      rows.map(([id, status]) => JSON.stringify({ id, status })).join("\n") + "\n",
    );
  const commit = (msg) => {
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  issues([["a", "open"], ["b", "open"]]);
  writeFileSync(join(dir, "src.ts"), "export const x = 1;\n");
  const base = commit("base");
  const run = (env = { BASE_SHA: base }) =>
    spawnSync(process.execPath, [join(dir, "scripts", "check-tracker-closes.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: "", ...env },
    });
  return { dir, g, issues, commit, base, run };
}

test("check-tracker-closes fails a close beside a code change", () => {
  const r = trackerRepo();
  try {
    r.issues([["a", "closed"], ["b", "open"]]);
    writeFileSync(join(r.dir, "src.ts"), "export const x = 2;\n");
    r.commit("fix and close");
    const out = r.run();
    assert.equal(out.status, 1, out.stderr);
    assert.match(out.stderr, /closed: {2}a\b/);
    assert.match(out.stderr, /src\.ts/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes fails a close beside a Markdown-only change", () => {
  // #616's shape: a spec and a close in one diff, which the docs-only
  // path must not wave through.
  const r = trackerRepo();
  try {
    r.issues([["a", "closed"], ["b", "open"]]);
    writeFileSync(join(r.dir, "x.spec.md"), "# spec\n");
    r.commit("spec and close");
    assert.equal(r.run().status, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes fails an issue filed already closed beside a code change", () => {
  // #604's shape: absent at the base, closed at the head.
  const r = trackerRepo();
  try {
    r.issues([["a", "open"], ["b", "open"], ["c", "closed"]]);
    writeFileSync(join(r.dir, "src.ts"), "export const x = 3;\n");
    r.commit("file, fix and close");
    const out = r.run();
    assert.equal(out.status, 1, out.stderr);
    assert.match(out.stderr, /closed: {2}c\b/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes passes a tracker-only close and a change that closes nothing", () => {
  const r = trackerRepo();
  try {
    r.issues([["a", "closed"], ["b", "open"]]);
    const closeOnly = r.commit("close a");
    let out = r.run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /1 close\(s\), tracker-only/);
    writeFileSync(join(r.dir, "src.ts"), "export const x = 4;\n");
    r.commit("code only");
    out = r.run({ BASE_SHA: closeOnly });
    assert.equal(out.status, 0, out.stderr);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes does not count a close made on main and merged in", () => {
  // The base the gate is given is the pull request's current base, so a
  // close that reached the branch through a merge from main is on both
  // sides of the diff.
  const r = trackerRepo();
  try {
    r.g("checkout", "-q", "-b", "feature");
    writeFileSync(join(r.dir, "src.ts"), "export const x = 5;\n");
    r.commit("feature work");
    r.g("checkout", "-q", "main");
    r.issues([["a", "open"], ["b", "closed"]]);
    const movedBase = r.commit("close b on main");
    r.g("checkout", "-q", "feature");
    r.g("merge", "-q", "--no-edit", "main");
    const out = r.run({ BASE_SHA: movedBase });
    assert.equal(out.status, 0, out.stderr);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes refuses a tracker that does not parse rather than crashing", () => {
  // Exit 1 means "a close beside other changes"; an unreadable tracker is
  // neither that nor clean, so it must be 2 (Copilot on #622).
  const r = trackerRepo();
  try {
    writeFileSync(join(r.dir, ".beads", "issues.jsonl"), '{"id":"a","status":"open"}\n{not json\n');
    r.commit("corrupt the tracker");
    const out = r.run();
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /line 2 is not valid JSON/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes reads a tracker larger than execFileSync's default 1 MiB buffer", () => {
  // The real tracker crossed 1 MiB on 2026-10-12 (barwise-jk7), and from
  // then on `git show` overflowed the default buffer and every run refused.
  const r = trackerRepo();
  try {
    const pad = "x".repeat(4096);
    const rows = Array.from({ length: 300 }, (_, i) => ({ id: `p${i}`, status: "open", pad }));
    const write = (status) =>
      writeFileSync(
        join(r.dir, ".beads", "issues.jsonl"),
        [{ id: "a", status }, ...rows].map((row) => JSON.stringify(row)).join("\n") + "\n",
      );
    write("open");
    const bigBase = r.commit("grow the tracker past 1 MiB");
    write("closed");
    r.commit("close a");
    const out = r.run({ BASE_SHA: bigBase });
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /1 close\(s\), tracker-only/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes, run as ci:local --commit runs it, fails a close beside a code change", () => {
  // The pre-push shape: no BASE_SHA, the base taken from
  // `git merge-base origin/main HEAD`, in a detached linked worktree of the
  // pushed commit. barwise-40t suspected this path of passing #723's close;
  // it does not -- that push ran no hook at all, because core.hooksPath is
  // relative and a `git worktree add` checkout has no barwise/.husky/_
  // (barwise-qma). Pinned so the fallback stays the one CI's base agrees with.
  const r = trackerRepo();
  const tree = mkdtempSync(join(tmpdir(), "barwise-closes-wt-"));
  try {
    // Only origin/main can supply the base: the local default branch is
    // deleted (a fresh ci:local worktree need not have one), so a fallback
    // that read it would refuse instead of passing.
    r.g("update-ref", "refs/remotes/origin/main", r.base);
    const local = r.g("rev-parse", "--abbrev-ref", "HEAD").trim();
    r.g("checkout", "-q", "-b", "feature");
    r.g("branch", "-q", "-D", local);
    // The close and the code change in separate commits, so a base of
    // HEAD~1 would see the code change alone and report clean.
    r.issues([["a", "closed"], ["b", "open"]]);
    r.commit("close a");
    writeFileSync(join(r.dir, "src.ts"), "export const x = 6;\n");
    const head = r.commit("fix");
    rmSync(tree, { recursive: true, force: true });
    r.g("worktree", "add", "--detach", "-q", tree, head);
    // From a subdirectory of the worktree, as ci:local runs gates from its
    // barwise/: a cwd-scoped listing would miss the root-level tracker.
    const out = spawnSync(process.execPath, [join(tree, "scripts", "check-tracker-closes.mjs")], {
      cwd: join(tree, "scripts"),
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: "" },
    });
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /closed: {2}a\b/);
    assert.match(out.stderr, /src\.ts/);
  } finally {
    rmSync(tree, { recursive: true, force: true });
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("audit-rubric refuses when promptlab is not built, never its finding code (barwise-shq) [adr:gate-refusal-contract#refuse-not-find]", () => {
  // The script finds packages/promptlab/dist relative to itself, so a copy
  // of scripts/ in an empty root is an unbuilt checkout.
  const dir = mkdtempSync(join(tmpdir(), "barwise-unbuilt-"));
  try {
    for (const f of ["audit-rubric.mjs", join("lib", "baseline-merge.mjs")]) {
      mkdirSync(dirname(join(dir, "scripts", f)), { recursive: true });
      writeFileSync(join(dir, "scripts", f), readFileSync(join(SCRIPTS, f)));
    }
    const r = spawnSync(process.execPath, [join(dir, "scripts", "audit-rubric.mjs"), "--check"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /dist not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-depcruise-gate refuses when dependency-cruiser cannot run, never a stack trace (barwise-shq) [adr:gate-refusal-contract#refuse-not-find]", () => {
  // A PATH with no npx: the probe's depcruise call cannot start, and the
  // gate used to hand the missing output to JSON.parse and exit 1.
  const dir = mkdtempSync(join(tmpdir(), "barwise-nonpx-"));
  try {
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-depcruise-gate.mjs")], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, PATH: dir },
    });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /cannot answer/);
    assert.doesNotMatch(r.stderr, /at .*\.mjs:\d+/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("depcruise exits by its violation count, never by the 8-bit exit code (barwise-vt2) [adr:gate-refusal-contract#three-results]", async () => {
  // dependency-cruiser exits with its violation count, which the OS keeps
  // mod 256: two violations read as a refusal, 256 as a pass.
  const { exitFor } = await import(pathToFileURL(join(SCRIPTS, "run-depcruise.mjs")).href);
  assert.equal(exitFor({ summary: { error: 0, warn: 3 } }), 0);
  assert.equal(exitFor({ summary: { error: 1 } }), 1);
  assert.equal(exitFor({ summary: { error: 2 } }), 1);
  assert.equal(exitFor({ summary: { error: 256 } }), 1);
  assert.equal(exitFor({ summary: {} }), 2);
  assert.equal(exitFor(undefined), 2);
  // The real tree is CI's own depcruise step, not this unit test's.
});

test("check-depcruise-gate never writes its probe into the tree (barwise-w43) [adr:gate-refusal-contract#no-writes]", async () => {
  // The probe used to live in packages/core/src for the length of a
  // depcruise run, removed in a finally: a killed run left it there, and
  // git status after the run could not see it. Polled while the gate
  // runs, so a write undone before exit is still seen.
  const probe = join(REPO, "barwise", "packages", "core", "src", "__depcruise-gate-probe__.ts");
  const child = spawn(process.execPath, [join(SCRIPTS, "check-depcruise-gate.mjs")], {
    cwd: REPO,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  let seen = false;
  const poll = setInterval(() => {
    if (existsSync(probe)) seen = true;
  }, 10);
  const code = await new Promise((res) => child.on("close", res));
  clearInterval(poll);
  assert.equal(seen, false, "the probe appeared in packages/core/src during the run");
  assert.equal(code, 0, out);
  assert.match(out, /probe violation reported/);
});

test("check-tracker-closes refuses when git answers emptily, with and without BASE_SHA (barwise-ydl) [adr:gate-refusal-contract#refuse-not-find]", () => {
  // The fault matrix's git-empty axis read a FALSE GREEN here: an empty
  // merge-base became base "", and an empty `git show` of the tracker a
  // tracker with no issues, so nothing could be closed and the gate said
  // OK. With BASE_SHA set, as CI sets it, the empty tracker read alone
  // gave the same answer.
  const dir = mkdtempSync(join(tmpdir(), "barwise-nogit-"));
  try {
    const stub = join(dir, "git");
    writeFileSync(stub, "#!/bin/sh\nexit 0\n");
    chmodSync(stub, 0o755);
    for (const baseSha of ["", "0123456789abcdef0123456789abcdef01234567"]) {
      const r = spawnSync(process.execPath, [join(SCRIPTS, "check-tracker-closes.mjs")], {
        cwd: REPO,
        encoding: "utf8",
        env: { ...process.env, BASE_SHA: baseSha, PATH: `${dir}:${process.env.PATH ?? ""}` },
      });
      assert.equal(r.status, 2, `BASE_SHA=${JSON.stringify(baseSha)}: ${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stdout, /OK/);
      // Which refusal fired: the empty merge-base without BASE_SHA, the
      // empty tracker read with it.
      assert.match(
        r.stderr,
        baseSha ? /git show of .* printed nothing/ : /merge-base printed nothing/,
      );
    }
    // Only merge-base empty, every other call real: the base "" would make
    // `git show :<tracker>` read the index, which is not empty, so the
    // empty-tracker refusal cannot stand in for the empty-base one.
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      stub,
      `#!/bin/sh\nif [ "$1" = merge-base ]; then exit 0; fi\nexec "${realGit}" "$@"\n`,
    );
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-tracker-closes.mjs")], {
      cwd: REPO,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: "", PATH: `${dir}:${process.env.PATH ?? ""}` },
    });
    assert.equal(r.status, 2, `merge-base empty only: ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /merge-base printed nothing/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check-tracker-closes refuses a close when git diff answers emptily (barwise-ydl) [adr:gate-refusal-contract#refuse-not-find]", () => {
  const r = trackerRepo();
  const shim = mkdtempSync(join(tmpdir(), "barwise-nodiff-"));
  try {
    r.issues([["a", "closed"], ["b", "open"]]);
    writeFileSync(join(r.dir, "src.ts"), "export const x = 2;\n");
    r.commit("close a beside code");
    const realGit = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(shim, "git"),
      `#!/bin/sh\nif [ "$1" = diff ]; then exit 0; fi\nexec "${realGit}" "$@"\n`,
    );
    chmodSync(join(shim, "git"), 0o755);
    const out = r.run({ BASE_SHA: r.base, PATH: `${shim}:${process.env.PATH ?? ""}` });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /does not name/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(shim, { recursive: true, force: true });
  }
});

test("check-tracker-closes refuses with no base rather than reporting clean", () => {
  const r = trackerRepo();
  try {
    const out = r.run({ BASE_SHA: "" });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

/**
 * check-plan-review: a spec's plan is reviewed before its implementation
 * is committed (docs/specs/plan-scope-check.spec.md, WS6).
 *
 * A sandbox repository with the gate and the libraries it imports copied
 * in. `main` holds `src/a.ts`; each case builds a branch, and `BASE_SHA`
 * stands in for the pull request's base commit, as ci.yml passes it.
 */
const PLAN_SPEC = "barwise/docs/specs/x.spec.md";

function planRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-planrev-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, "barwise", "docs", "specs"), { recursive: true });
  mkdirSync(join(dir, "src"));
  for (
    const f of [
      "check-plan-review.mjs",
      join("lib", "args.mjs"),
      join("lib", "git-run.mjs"),
      join("lib", "name-status.mjs"),
      join("lib", "review-tiers.mjs"),
      join("lib", "spec-reader.mjs"),
      join("lib", "tracked.mjs"),
    ]
  ) {
    writeFileSync(join(dir, "scripts", f), readFileSync(join(SCRIPTS, f)));
  }
  const commit = (msg) => {
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  /** The spec, with `Plan-reviewed:` naming `reviewed` when given. */
  const spec = (
    { status = "Draft", reviewed, body = "The plan.", names = "code-review, pr-review" } = {},
  ) =>
    writeFileSync(
      join(dir, PLAN_SPEC),
      `# X\n\nStatus: ${status}\nTracking: barwise-x\n`
        + (reviewed ? `Plan-reviewed: ${reviewed.slice(0, 8)} (${names})\n` : "")
        + `Touches: src/a.ts, +src/b.ts\n\n## Plan\n\n${body}\n`,
    );
  const implement = (n) => writeFileSync(join(dir, "src", "a.ts"), `export const a = ${n};\n`);
  implement(0);
  const base = commit("base");
  g("checkout", "-q", "-b", "feature");
  const run = (env = { BASE_SHA: base }) =>
    spawnSync(process.execPath, [join(dir, "scripts", "check-plan-review.mjs")], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: "", ...env },
    });
  return { dir, g, commit, spec, implement, base, run };
}

test("check-plan-review fails an implementation whose spec has no Plan-reviewed: line", () => {
  const r = planRepo();
  try {
    r.spec();
    r.commit("spec");
    r.implement(1);
    const first = r.commit("implement");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /x\.spec\.md: no Plan-reviewed: line/);
    assert.match(out.stderr, new RegExp(`first change to its Touches: is ${first.slice(0, 8)}`));
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails a Plan-reviewed: line naming a commit after the first implementation", () => {
  // The review happened, but of a tree that already held the code.
  const r = planRepo();
  try {
    r.spec();
    r.commit("spec");
    r.implement(1);
    const first = r.commit("implement");
    r.spec({ reviewed: first });
    r.commit("record the review");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(
      out.stderr,
      new RegExp(`does not precede ${first.slice(0, 8)}, a change to its Touches:`),
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails a review recorded at a later commit than the first implementation", () => {
  // Not the first change itself but a descendant of it: only the ancestry
  // test can see that the review came after the code began.
  const r = planRepo();
  try {
    r.spec();
    r.commit("spec");
    r.implement(1);
    const first = r.commit("implement");
    r.implement(2);
    const later = r.commit("implement more");
    r.spec({ reviewed: later });
    r.commit("record the review");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, new RegExp(`does not precede ${first.slice(0, 8)}`));
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails an unreviewed implementation on a side line merged in", () => {
  // The first changing commit in topological order descends from the
  // review; the side line's does not, and it is checked too.
  const r = planRepo();
  try {
    r.spec();
    const specAt = r.commit("spec");
    // Cut from the base, before the spec and its review existed.
    r.g("checkout", "-q", "-b", "side", r.base);
    writeFileSync(join(r.dir, "src", "b.ts"), "export const b = 1;\n");
    const side = r.commit("side implementation, before any review");
    r.g("checkout", "-q", "feature");
    r.spec({ reviewed: specAt });
    r.commit("record the review");
    r.implement(1);
    r.commit("implement");
    r.g("merge", "-q", "--no-ff", "-m", "merge side", "side");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, new RegExp(`does not precede ${side.slice(0, 8)}`));
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review compares the plan where each line of implementation began", () => {
  // A side line cut after the review rewrites the plan, then implements
  // it. The main line's first change still sees the reviewed body; the
  // side line's does not, and it is compared too.
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.spec({ reviewed });
    r.commit("record the review");
    r.g("checkout", "-q", "-b", "side");
    r.spec({ reviewed, body: "A different plan." });
    r.commit("rewrite the plan on the side line");
    writeFileSync(join(r.dir, "src", "b.ts"), "export const b = 1;\n");
    const side = r.commit("implement the rewritten plan");
    r.g("checkout", "-q", "feature");
    r.implement(1);
    r.commit("implement");
    r.g("merge", "-q", "--no-ff", "-X", "theirs", "-m", "merge side", "side");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(
      out.stderr,
      new RegExp(`the plan changed between the reviewed .* and ${side.slice(0, 8)}`),
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review reads Touches: and Status at the base, so a branch cannot drop either", () => {
  // The spec exists at the base with no Status line (read as claiming
  // nothing built), and the branch drops the path it implements from
  // Touches: -- a header edit, which leaves a review standing.
  const r = planRepo();
  try {
    r.g("checkout", "-q", "main");
    writeFileSync(join(r.dir, PLAN_SPEC), "# X\n\nTouches: src/a.ts\n\n## Plan\n\nThe plan.\n");
    const base = r.commit("spec on main, no Status");
    r.g("checkout", "-q", "-B", "feature");
    writeFileSync(join(r.dir, PLAN_SPEC), "# X\n\nTouches: src/other.ts\n\n## Plan\n\nThe plan.\n");
    r.implement(1);
    r.commit("implement, and drop the entry");
    const out = r.run({ BASE_SHA: base });
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /x\.spec\.md: no Plan-reviewed: line/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails a Plan-reviewed: line naming a commit without the spec", () => {
  // `base` precedes the implementation, so only the containment test can
  // tell that nothing reviewed there was this plan.
  const r = planRepo();
  try {
    r.spec({ reviewed: r.base });
    r.commit("spec, claiming a review at the base");
    r.implement(1);
    r.commit("implement");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /does not contain the spec/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails a plan rewritten after the commit its review names", () => {
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.spec({ reviewed });
    r.commit("record the review");
    r.spec({ reviewed, body: "A different plan." });
    r.commit("rewrite the plan");
    r.implement(1);
    r.commit("implement");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /the plan changed between the reviewed/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review passes a review recorded before the first implementation commit", () => {
  // Recording the line and updating Status change only the header block,
  // so neither disturbs the body the review vouches for; nor does a plan
  // amended in the implementation commit itself, which is after it began.
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.spec({ reviewed });
    r.commit("record the review");
    r.implement(1);
    r.spec({ reviewed, status: "Workstream 1 implemented", body: "The plan, as built." });
    const first = r.commit("implement");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(
      out.stdout,
      new RegExp(
        `x\\.spec\\.md \\(reviewed at ${reviewed.slice(0, 8)}, first change ${
          first.slice(0, 8)
        }\\)`,
      ),
    );
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails a Plan-reviewed: line that names only one review", () => {
  // Each review alone, and a name only embedded in a longer word.
  for (const names of ["code-review", "pr-review", "code-review, non-pr-review"]) {
    const r = planRepo();
    try {
      r.spec();
      const reviewed = r.commit("spec");
      r.spec({ reviewed, names });
      r.commit("record the review");
      r.implement(1);
      r.commit("implement");
      const out = r.run();
      assert.equal(out.status, 1, names + ": " + out.stdout + out.stderr);
      assert.match(out.stderr, /must name both reviews/);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  }
});

test("check-plan-review reads review names past the first parenthetical", () => {
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.spec({ reviewed, names: "re-pointed from 1234567) (code-review, pr-review" });
    r.commit("record the review");
    r.implement(1);
    r.commit("implement");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review accepts annotated review names in either order", () => {
  for (
    const names of [
      "code-review, pr-review; re-pointed after WS2",
      "pr-review x5, code-review x3; note",
    ]
  ) {
    const r = planRepo();
    try {
      r.spec();
      const reviewed = r.commit("spec");
      r.spec({ reviewed, names });
      r.commit("record the review");
      r.implement(1);
      r.commit("implement");
      const out = r.run();
      assert.equal(out.status, 0, names + out.stdout + out.stderr);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  }
});

test("check-plan-review fails a Plan-reviewed: line added in the implementation commit", () => {
  // The line names a commit before the code, but was written with it.
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.implement(1);
    r.spec({ reviewed });
    r.commit("implement and record the review");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /line is not in the spec at the parent of/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review fails a Plan-reviewed: line added after the implementation", () => {
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.implement(1);
    r.commit("implement");
    r.spec({ reviewed });
    r.commit("record the review late");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /line is not in the spec at the parent of/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review passes a line re-pointed after implementation to a commit before it", () => {
  // A rebase rewrites the reviewed commit's id; the line is re-pointed,
  // not introduced, and still names a commit that precedes the code.
  const r = planRepo();
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.spec({ reviewed });
    r.commit("record the review");
    r.implement(1);
    r.commit("implement");
    r.spec({ reviewed, names: "code-review, pr-review; re-pointed after rebase" });
    r.commit("re-point");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review leaves a spec whose Status at the base claims work is built", () => {
  // Named by a commit message, and changing its Touches:, but the rule
  // applies to implementation after it lands, not to later workstreams.
  const r = planRepo();
  try {
    r.g("checkout", "-q", "main");
    r.spec({ status: "Workstream 1 implemented 2026-10-24; 2 not yet" });
    const base = r.commit("spec with workstream 1");
    r.g("checkout", "-q", "-B", "feature");
    r.implement(2);
    r.commit("workstream 2 of x.spec.md");
    const out = r.run({ BASE_SHA: base });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /1 spec\(s\) named, none implemented/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review leaves a pull request that does not name the Draft spec", () => {
  // Open decision 5: editing a file a Draft spec plans to change does not
  // make an unrelated PR answer for that spec's review.
  const r = planRepo();
  try {
    r.g("checkout", "-q", "main");
    r.spec();
    const base = r.commit("draft spec");
    r.g("checkout", "-q", "-B", "feature");
    r.implement(2);
    r.commit("an unrelated fix");
    const out = r.run({ BASE_SHA: base });
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /0 spec\(s\) named/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review refuses when git fails to answer whether the review precedes the code", () => {
  // `merge-base --is-ancestor` exits 128 when git itself fails (a missing
  // object, a corrupt history). Read as "no", that would fail the author
  // for what git could not see.
  const r = planRepo();
  const shim = mkdtempSync(join(tmpdir(), "barwise-planrev-git-"));
  try {
    r.spec();
    const reviewed = r.commit("spec");
    r.spec({ reviewed });
    r.commit("record the review");
    r.implement(1);
    r.commit("implement");
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(shim, "git"),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = --is-ancestor ] && exit 128; done\nexec "${real}" "$@"\n`,
    );
    chmodSync(join(shim, "git"), 0o755);
    const out = r.run({ BASE_SHA: r.base, PATH: `${shim}:${process.env.PATH}` });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /--is-ancestor/);
  } finally {
    rmSync(shim, { recursive: true, force: true });
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review refuses when git cannot resolve the base", () => {
  const r = planRepo();
  try {
    r.spec();
    r.commit("spec");
    r.implement(1);
    r.commit("implement");
    const out = r.run({ BASE_SHA: "no-such-ref" });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /cannot answer/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-plan-review refuses a shallow clone", () => {
  // Ancestry in a truncated history is not an answer: a review commit cut
  // off by the depth reads as "names no commit", a finding it is not.
  const r = planRepo();
  const shallow = mkdtempSync(join(tmpdir(), "barwise-planrev-shallow-"));
  try {
    r.spec();
    r.commit("spec");
    r.implement(1);
    r.commit("implement");
    execFileSync("git", [
      "clone",
      "-q",
      "--depth",
      "1",
      "--branch",
      "feature",
      `file://${r.dir}`,
      shallow,
    ], {
      stdio: "ignore",
    });
    const out = spawnSync(process.execPath, [join(shallow, "scripts", "check-plan-review.mjs")], {
      cwd: shallow,
      encoding: "utf8",
      env: { ...process.env, BASE_SHA: "HEAD" },
    });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /shallow clone/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
    rmSync(shallow, { recursive: true, force: true });
  }
});

/**
 * check-spec-touches, the new-spec rule: a corpus spec whose file name was
 * nowhere under barwise/docs/specs/ at a fixed cutoff commit fails unless
 * its `Touches:` names a tracked path outside that directory
 * (docs/specs/touches-required.spec.md).
 *
 * A sandbox repository with the gate and its libraries copied in. The
 * cutoff commit holds `src/a.ts`, `src/gone.ts`, two specs without
 * `Touches:` (the existing corpus, exempt) and one in `archive/`; each
 * case changes the tree after it, and `--cutoff` names it, since the real
 * cutoff is not in the sandbox.
 */
const TOUCHES_SPECS = "barwise/docs/specs";

function touchesRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-touchesreq-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@example.com");
  g("config", "user.name", "t");
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, TOUCHES_SPECS, "archive"), { recursive: true });
  mkdirSync(join(dir, "src"));
  for (
    const f of [
      "check-spec-touches.mjs",
      join("lib", "args.mjs"),
      join("lib", "git-run.mjs"),
      join("lib", "review-tiers.mjs"),
      join("lib", "spec-cutoff.mjs"),
      join("lib", "spec-reader.mjs"),
      join("lib", "tracked.mjs"),
    ]
  ) {
    writeFileSync(join(dir, "scripts", f), readFileSync(join(SCRIPTS, f)));
  }
  /** Write a spec at `rel` under the specs directory; `touchesLine` undefined omits the field. */
  const spec = (rel, touchesLine) => {
    mkdirSync(dirname(join(dir, TOUCHES_SPECS, rel)), { recursive: true });
    writeFileSync(
      join(dir, TOUCHES_SPECS, rel),
      "# S\n\nStatus: Draft\n"
        + (touchesLine === undefined ? "" : `Touches: ${touchesLine}\n`)
        + "\n## Plan\n\nThe plan.\n",
    );
  };
  const commit = (msg) => {
    g("add", "-A");
    g("commit", "-q", "-m", msg);
    return g("rev-parse", "HEAD");
  };
  writeFileSync(join(dir, "src", "a.ts"), "export const a = 0;\n");
  writeFileSync(join(dir, "src", "gone.ts"), "export const gone = 0;\n");
  spec("old.spec.md");
  spec("other.spec.md");
  spec("archive/arch.spec.md");
  const cutoff = commit("cutoff");
  const run = (args = ["--cutoff", cutoff], env = {}) =>
    spawnSync(process.execPath, [join(dir, "scripts", "check-spec-touches.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, ...env },
    });
  return {
    dir,
    g,
    spec,
    commit,
    cutoff,
    run,
    done: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("check-spec-touches fails a new spec that declares no Touches:", () => {
  const r = touchesRepo();
  try {
    r.spec("new.spec.md");
    r.commit("add a spec");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(
      out.stderr,
      /barwise\/docs\/specs\/new\.spec\.md: new since the cutoff and declares no Touches:/,
    );
  } finally {
    r.done();
  }
});

test("check-spec-touches fails a new spec whose Touches: is only +none", () => {
  // A + entry is a file the plan creates and may be absent, so the tree
  // rule passes it; alone, it is a placeholder.
  const r = touchesRepo();
  try {
    r.spec("new.spec.md", "+none");
    // A + entry naming a real path still counts for nothing, even beside a
    // - entry (which makes the gate read every path it could name).
    r.spec("plus.spec.md", "+src/a.ts, -src/never.ts");
    r.commit("add specs with placeholders");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /new\.spec\.md: new since the cutoff, and no Touches: entry names/);
    assert.match(out.stderr, /plus\.spec\.md: new since the cutoff, and no Touches: entry names/);
  } finally {
    r.done();
  }
});

test("check-spec-touches fails a new spec whose only - entry names nothing tracked at the cutoff", () => {
  const r = touchesRepo();
  try {
    r.spec("new.spec.md", "-src/never.ts, +src/b.ts");
    r.commit("add a spec");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /new\.spec\.md: new since the cutoff, and no Touches: entry names/);
  } finally {
    r.done();
  }
});

test("check-spec-touches fails a new spec whose only entry is its own path or the specs directory", () => {
  // Both are tracked as soon as the spec is, so they would satisfy the
  // rule by naming the plan rather than what the plan changes.
  const r = touchesRepo();
  try {
    r.spec("self.spec.md", `${TOUCHES_SPECS}/self.spec.md`);
    r.spec("dir.spec.md", `${TOUCHES_SPECS}/`);
    r.commit("add two specs that name only the specs directory");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /2 spec\(s\) new since the cutoff/);
    assert.match(out.stderr, /self\.spec\.md: new since the cutoff, and no Touches: entry names/);
    assert.match(out.stderr, /dir\.spec\.md: new since the cutoff, and no Touches: entry names/);
  } finally {
    r.done();
  }
});

test("check-spec-touches expands entries, so no spelling of the specs directory satisfies the rule", () => {
  // Compared as text, each of these slipped past a prefix test: no
  // trailing slash, a pattern matching only the spec, and a parent
  // directory that holds nothing but specs here.
  const r = touchesRepo();
  try {
    r.spec("bare.spec.md", `-${TOUCHES_SPECS}`);
    r.spec("pattern.spec.md", "barwise/*/specs/pattern.spec.md");
    r.spec("parent.spec.md", "barwise/docs/");
    r.commit("add three specs that name only the specs directory");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /3 spec\(s\) new since the cutoff/);
    for (const id of ["bare", "pattern", "parent"]) {
      assert.match(
        out.stderr,
        new RegExp(`${id}\\.spec\\.md: new since the cutoff, and no Touches: entry names`),
      );
    }
    // The tree rule has nothing to say about any of them: only the
    // expansion catches them.
    assert.doesNotMatch(out.stderr, /not resolve/);
  } finally {
    r.done();
  }
});

test("check-spec-touches reports an unmarked bare specs directory under both rules", () => {
  // The tree rule finds `barwise/docs/specs` (no slash) names nothing
  // tracked; the new rule must not count it as a path outside the
  // directory it names, or a fix to the first finding would hide the second.
  const r = touchesRepo();
  try {
    r.spec("bare.spec.md", TOUCHES_SPECS);
    r.commit("add a spec naming the bare specs directory");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /bare\.spec\.md: barwise\/docs\/specs -- names nothing tracked/);
    assert.match(out.stderr, /bare\.spec\.md: new since the cutoff, and no Touches: entry names/);
  } finally {
    r.done();
  }
});

test("check-spec-touches accepts a - entry for a file created after the cutoff, through to its deletion", () => {
  // Checked against the cutoff alone, -src/b.ts could never pass, and the
  // unmarked src/b.ts fails the tree rule once the deletion lands.
  const r = touchesRepo();
  try {
    writeFileSync(join(r.dir, "src", "b.ts"), "export const b = 0;\n");
    r.spec("removes-b.spec.md", "src/b.ts");
    r.commit("add b.ts, and a spec that plans to remove it");
    let out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    rmSync(join(r.dir, "src", "b.ts"));
    r.spec("removes-b.spec.md", "-src/b.ts");
    r.commit("remove b.ts, and mark the entry");
    out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /1 spec\(s\) new since the cutoff/);
  } finally {
    r.done();
  }
});

test("check-spec-touches passes a new spec with an unmarked entry, and one with only a - entry tracked at the cutoff", () => {
  const r = touchesRepo();
  try {
    r.spec("unmarked.spec.md", "src/a.ts, +src/b.ts");
    // The tree no longer holds src/gone.ts, so only the cutoff vouches for it.
    r.spec("deletes.spec.md", "-src/gone.ts");
    // A - directory spelled without its slash stands for the files under it.
    r.spec("deletes-dir.spec.md", "-src");
    rmSync(join(r.dir, "src", "gone.ts"));
    r.commit("add three specs, delete gone.ts");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(
      out.stdout,
      /3 spec\(s\) new since the cutoff [0-9a-f]{8}, each declaring a tracked path/,
    );
  } finally {
    r.done();
  }
});

test("check-spec-touches reports an empty Touches: on a new spec once, as the existing finding", () => {
  const r = touchesRepo();
  try {
    r.spec("new.spec.md", "");
    r.commit("add a spec with an empty Touches:");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /new\.spec\.md: Touches: has no entries/);
    assert.doesNotMatch(out.stderr, /new since the cutoff/);
    assert.equal(out.stderr.match(/new\.spec\.md/g).length, 1, out.stderr);
  } finally {
    r.done();
  }
});

test("check-spec-touches exempts a spec that existed by name at the cutoff: edited, archived, restored, moved", () => {
  const r = touchesRepo();
  try {
    writeFileSync(
      join(r.dir, TOUCHES_SPECS, "old.spec.md"),
      "# S\n\nStatus: Draft\n\n## Plan\n\nEdited.\n",
    );
    r.commit("edit an existing spec");
    r.g("mv", `${TOUCHES_SPECS}/other.spec.md`, `${TOUCHES_SPECS}/archive/other.spec.md`);
    r.commit("archive one");
    r.g("mv", `${TOUCHES_SPECS}/archive/arch.spec.md`, `${TOUCHES_SPECS}/arch.spec.md`);
    r.commit("restore an archived spec");
    mkdirSync(join(r.dir, TOUCHES_SPECS, "sub"));
    r.g("mv", `${TOUCHES_SPECS}/old.spec.md`, `${TOUCHES_SPECS}/sub/old.spec.md`);
    r.commit("move a spec between directories");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /0 spec\(s\) new since the cutoff/);
  } finally {
    r.done();
  }
});

test("check-spec-touches leaves an added archived spec, an ADR and a non-spec document alone", () => {
  const r = touchesRepo();
  try {
    r.spec("archive/frozen.spec.md");
    mkdirSync(join(r.dir, "barwise", "docs", "adr"), { recursive: true });
    writeFileSync(
      join(r.dir, "barwise", "docs", "adr", "0001-x.md"),
      "# ADR\n\nStatus: Accepted\n",
    );
    writeFileSync(join(r.dir, TOUCHES_SPECS, "README.md"), "# Specs\n");
    r.commit("add an archived spec, an ADR and a README");
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /0 spec\(s\) new since the cutoff/);
  } finally {
    r.done();
  }
});

test("check-spec-touches reads a spec renamed to a new file name as new", () => {
  // Open decision 2: a new name is a new document with its own plan, and
  // a new name is absent at the cutoff.
  const r = touchesRepo();
  try {
    r.g("mv", `${TOUCHES_SPECS}/old.spec.md`, `${TOUCHES_SPECS}/renamed.spec.md`);
    r.commit("rename a spec");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /renamed\.spec\.md: new since the cutoff and declares no Touches:/);
  } finally {
    r.done();
  }
});

test("check-spec-touches judges the working tree: a staged spec, and an unstaged edit that drops Touches:", () => {
  // The tree rule reads the working tree; the new rule reads the same
  // text, so plain ci:local before a commit sees what the commit will.
  const r = touchesRepo();
  try {
    r.spec("staged.spec.md");
    r.g("add", "-A");
    let out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /staged\.spec\.md: new since the cutoff and declares no Touches:/);
    r.spec("staged.spec.md", "src/a.ts");
    r.commit("the spec, with Touches:");
    out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    r.spec("staged.spec.md");
    out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /staged\.spec\.md: new since the cutoff and declares no Touches:/);
  } finally {
    r.done();
  }
});

test("check-spec-touches keeps checking a spec that reached main without passing, on every later run", () => {
  // The escape a per-push base left open: once a later push's before-SHA
  // held the spec, it read as existing. Against the cutoff it stays new.
  const r = touchesRepo();
  try {
    r.spec("pushed.spec.md");
    r.commit("a spec pushed straight to main, its run cancelled");
    writeFileSync(join(r.dir, "src", "a.ts"), "export const a = 1;\n");
    r.commit("a later push");
    const out = r.run();
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /pushed\.spec\.md: new since the cutoff and declares no Touches:/);
  } finally {
    r.done();
  }
});

test("check-spec-touches refuses when the cutoff is not in the clone", () => {
  // Without --cutoff the gate looks for the real cutoff commit, which the
  // sandbox does not hold: the same reading as a clone fetched short of it.
  const r = touchesRepo();
  try {
    r.spec("new.spec.md");
    r.commit("add a spec");
    const out = r.run([]);
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(
      out.stderr,
      /cannot answer for new specs -- the cutoff [0-9a-f]+ is not in this clone/,
    );
    assert.match(out.stderr, /git fetch origin main/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    r.done();
  }
});

test("check-spec-touches refuses a --cutoff that names no single commit, about the revision", () => {
  // A typo in a replay is not a stale clone; fetching would not mend it.
  const r = touchesRepo();
  try {
    r.spec("new.spec.md");
    r.commit("add a spec");
    for (const rev of ["f".repeat(40), "no-such-ref"]) {
      const out = r.run(["--cutoff", rev]);
      assert.equal(out.status, 2, out.stdout + out.stderr);
      assert.match(out.stderr, new RegExp(`--cutoff ${rev} names no single commit`));
      assert.doesNotMatch(out.stderr, /fetch/);
    }
  } finally {
    r.done();
  }
});

test("check-spec-touches refuses when git fails to say whether the cutoff exists", () => {
  // rev-parse --verify --quiet exits 1 for "no such commit" and 128 when
  // git itself fails; only the first is a missing cutoff.
  const r = touchesRepo();
  const shim = mkdtempSync(join(tmpdir(), "barwise-touchesreq-git-"));
  try {
    r.spec("new.spec.md", "src/a.ts");
    r.commit("add a spec");
    const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
    writeFileSync(
      join(shim, "git"),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = --verify ] && exit 128; done\nexec "${real}" "$@"\n`,
    );
    chmodSync(join(shim, "git"), 0o755);
    const out = r.run(undefined, { PATH: `${shim}:${process.env.PATH}` });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(
      out.stderr,
      /cannot answer for new specs -- `git rev-parse --verify .*` exited 128/,
    );
    assert.doesNotMatch(out.stderr, /fetch/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(shim, { recursive: true, force: true });
    r.done();
  }
});

test("check-spec-touches answers in a shallow clone that holds the cutoff", () => {
  // The rule reads one tree, not history, so a clone deep enough to hold
  // the cutoff commit can answer.
  const r = touchesRepo();
  const shallow = mkdtempSync(join(tmpdir(), "barwise-touchesreq-deep2-"));
  try {
    r.spec("new.spec.md", "src/a.ts");
    r.commit("add a spec");
    execFileSync("git", ["clone", "-q", "--depth", "2", `file://${r.dir}`, shallow], {
      stdio: "ignore",
    });
    const out = spawnSync(
      process.execPath,
      [join(shallow, "scripts", "check-spec-touches.mjs"), "--cutoff", r.cutoff],
      { cwd: shallow, encoding: "utf8" },
    );
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.match(out.stdout, /1 spec\(s\) new since the cutoff/);
  } finally {
    r.done();
    rmSync(shallow, { recursive: true, force: true });
  }
});

test("check-spec-touches refuses a shallow clone that stops short of the cutoff", () => {
  const r = touchesRepo();
  const shallow = mkdtempSync(join(tmpdir(), "barwise-touchesreq-shallow-"));
  try {
    r.spec("new.spec.md", "src/a.ts");
    r.commit("add a spec");
    execFileSync("git", ["clone", "-q", "--depth", "1", `file://${r.dir}`, shallow], {
      stdio: "ignore",
    });
    const out = spawnSync(
      process.execPath,
      [join(shallow, "scripts", "check-spec-touches.mjs"), "--cutoff", r.cutoff],
      { cwd: shallow, encoding: "utf8" },
    );
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /This clone is shallow\. Fix: git fetch --unshallow/);
  } finally {
    r.done();
    rmSync(shallow, { recursive: true, force: true });
  }
});

/**
 * A `git` that exits `code`, printing nothing, for one subcommand, and is
 * the real git otherwise: 128 is git failing, 0 is git answering emptily.
 */
function failingGit(subcommand, code = 128) {
  const shim = mkdtempSync(join(tmpdir(), "barwise-touchesreq-git-"));
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  writeFileSync(
    join(shim, "git"),
    `#!/bin/sh\n[ "$1" = ${subcommand} ] && exit ${code}\nexec "${real}" "$@"\n`,
  );
  chmodSync(join(shim, "git"), 0o755);
  return shim;
}

test("check-spec-touches refuses when git lists nothing at the cutoff", () => {
  // An empty listing would make every spec read as new, or, with the
  // check inverted, none: either way an answer about no tree at all.
  const r = touchesRepo();
  const shim = failingGit("ls-tree", 0);
  try {
    r.spec("new.spec.md", "src/a.ts");
    r.commit("add a spec");
    const out = r.run(undefined, { PATH: `${shim}:${process.env.PATH}` });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /git listed no files at the cutoff/);
  } finally {
    rmSync(shim, { recursive: true, force: true });
    r.done();
  }
});

test("check-spec-touches refuses when git cannot list the cutoff's tree", () => {
  const r = touchesRepo();
  const shim = failingGit("ls-tree");
  try {
    r.spec("new.spec.md");
    r.commit("add a spec");
    const out = r.run(undefined, { PATH: `${shim}:${process.env.PATH}` });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /cannot answer for new specs -- `git ls-tree .*` failed/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(shim, { recursive: true, force: true });
    r.done();
  }
});

test("check-spec-touches prints the tree rule's findings before a refusal, and fails on them", () => {
  // The tree rule's findings are answers whatever the new-spec rule would
  // say, so a refusal there must not hide them behind exit 2.
  const r = touchesRepo();
  const shim = failingGit("ls-tree");
  try {
    r.spec("rotted.spec.md", "src/moved.ts");
    r.commit("a spec whose entry names nothing tracked");
    const out = r.run(undefined, { PATH: `${shim}:${process.env.PATH}` });
    assert.equal(out.status, 1, out.stdout + out.stderr);
    assert.match(out.stderr, /rotted\.spec\.md: src\/moved\.ts -- names nothing tracked/);
    assert.match(out.stderr, /cannot answer for new specs/);
    assert.ok(
      out.stderr.indexOf("names nothing tracked") < out.stderr.indexOf("cannot answer"),
      out.stderr,
    );
  } finally {
    rmSync(shim, { recursive: true, force: true });
    r.done();
  }
});

/**
 * check-instruction-refs: every path and `node <path>` an instruction file
 * cites resolves (docs/specs/instruction-reference-check.spec.md, WS1).
 *
 * The real corpus exercises only some branches -- its one relative file
 * reference resolves, so it never shows that branch failing -- so each
 * branch gets a passing and a failing case in a sandbox repository with
 * its own allowlist.
 */
function refsRepo({ allow = [], files = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-refs-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  g("init", "-q");
  mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
  for (
    const f of [
      "check-instruction-refs.mjs",
      join("lib", "tracked.mjs"),
      join("lib", "instruction-files.mjs"),
    ]
  ) {
    writeFileSync(join(dir, "scripts", f), readFileSync(join(SCRIPTS, f)));
  }
  writeFileSync(
    join(dir, "scripts", "instruction-refs-allowlist.json"),
    JSON.stringify({ rows: allow }),
  );
  const base = {
    "barwise/docs/guide.md": "# guide\n",
    "barwise/scripts/tool.mjs": "",
    "barwise/scripts/legacy.cjs": "",
    "barwise/pkg/build.mjs": "",
    "barwise/pkg/src/unique.ts": "",
    "barwise/pkg/src/twin.ts": "",
    "barwise/other/src/twin.ts": "",
    ".claude/skills/s/notes.md": "# notes\n",
    "CLAUDE.md": "See `barwise/docs/guide.md`; run `node barwise/scripts/tool.mjs`, "
      + "`node barwise/scripts/legacy.cjs` and "
      + '`node "$(git rev-parse --show-toplevel)/barwise/scripts/tool.mjs" x`.\n',
    "barwise/pkg/CLAUDE.md":
      "Run `node build.mjs`; the entry is `unique.ts`; ours is `src/twin.ts`.\n",
    // `CLAUDE.md` exists at the root and in barwise/pkg/: the root one wins.
    ".claude/skills/s/SKILL.md": "Read `./notes.md`, then `CLAUDE.md`.\n",
    "REVIEW.md": "Also apply `barwise/docs/guide.md`.\n",
  };
  for (const [f, body] of Object.entries({ ...base, ...files })) {
    if (body === null) continue;
    mkdirSync(dirname(join(dir, f)), { recursive: true });
    writeFileSync(join(dir, f), body);
  }
  g("add", "-A");
  const run = (cwd = dir) =>
    spawnSync(process.execPath, [join(dir, "scripts", "check-instruction-refs.mjs")], {
      cwd,
      encoding: "utf8",
    });
  return { dir, run };
}

test("check-instruction-refs passes every live branch, from the root and from a package", () => {
  const r = refsRepo();
  try {
    const top = r.run();
    assert.equal(top.status, 0, top.stdout + top.stderr);
    // notes.md is under .claude/ too, and the root REVIEW.md counts.
    assert.match(top.stdout, /5 instruction file\(s\)/);
    const sub = r.run(join(r.dir, "barwise", "pkg"));
    assert.equal(sub.status, 0, sub.stderr);
    assert.equal(sub.stdout, top.stdout);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

for (
  const [name, files, expected] of [
    [
      "a dead rooted path",
      { "CLAUDE.md": "See `barwise/docs/gone.md`.\n" },
      /barwise\/docs\/gone\.md` -- no tracked file/,
    ],
    [
      "a dead relative path",
      { ".claude/skills/s/SKILL.md": "Read `../no-such.md`.\n" },
      /does not resolve from \.claude\/skills\/s\//,
    ],
    [
      "a dead unrooted name",
      { "barwise/pkg/CLAUDE.md": "See `missing.ts`.\n" },
      /missing\.ts` -- no tracked path/,
    ],
    [
      "an ambiguous name",
      { "CLAUDE.md": "See `src/twin.ts`.\n" },
      /ambiguous, 2 tracked paths end with it: .*pkg\/src\/twin\.ts.*other\/src\/twin\.ts|ambiguous, 2 tracked paths end with it: .*other\/src\/twin\.ts.*pkg\/src\/twin\.ts/,
    ],
    [
      "a dead node command",
      { "CLAUDE.md": "Run `node scripts/beads-crud.mjs`.\n" },
      /node scripts\/beads-crud\.mjs` -- resolves neither/,
    ],
    [
      "a dead .cjs node command",
      { "CLAUDE.md": "Run `node barwise/scripts/gone.cjs`.\n" },
      /node barwise\/scripts\/gone\.cjs` -- resolves neither/,
    ],
    [
      "a dead canonical node command",
      { "CLAUDE.md": 'Run `node "$(git rev-parse --show-toplevel)/barwise/scripts/gone.mjs"`.\n' },
      /show-toplevel\)\/barwise\/scripts\/gone\.mjs` -- resolves neither from the repo root/,
    ],
    [
      // A nested REVIEW.md is read once the default branch is protected.
      "a dead path in a nested REVIEW.md",
      { "barwise/pkg/REVIEW.md": "Apply `barwise/docs/gone.md`.\n" },
      /barwise\/pkg\/REVIEW\.md:1: `barwise\/docs\/gone\.md` -- no tracked file/,
    ],
    [
      // The root REVIEW.md is the one the service reads today (barwise-f4v).
      "a dead path in the root REVIEW.md",
      { "REVIEW.md": "Apply `barwise/docs/gone.md`.\n" },
      /\sREVIEW\.md:1: `barwise\/docs\/gone\.md` -- no tracked file/,
    ],
    [
      // The Copilot reviewer reads it as instructions (barwise-yi6).
      "a dead path in .github/copilot-instructions.md",
      { ".github/copilot-instructions.md": "Apply `barwise/docs/gone.md`.\n" },
      /\.github\/copilot-instructions\.md:1: `barwise\/docs\/gone\.md` -- no tracked file/,
    ],
    [
      // Copilot's path-specific instructions, at any depth (barwise-yi6).
      "a dead path in a nested .github/instructions/*.instructions.md",
      { ".github/instructions/ts/code.instructions.md": "Apply `barwise/docs/gone.md`.\n" },
      /\.github\/instructions\/ts\/code\.instructions\.md:1: `barwise\/docs\/gone\.md` -- no tracked file/,
    ],
    [
      // ... and flat in that directory, the layout Copilot documents.
      "a dead path in a flat .github/instructions/*.instructions.md",
      { ".github/instructions/ts.instructions.md": "Apply `barwise/docs/gone.md`.\n" },
      /\.github\/instructions\/ts\.instructions\.md:1: `barwise\/docs\/gone\.md` -- no tracked file/,
    ],
  ]
) {
  test(`check-instruction-refs fails ${name}`, () => {
    const r = refsRepo({ files });
    try {
      const out = r.run();
      assert.equal(out.status, 1, out.stdout + out.stderr);
      assert.match(out.stderr, expected);
    } finally {
      rmSync(r.dir, { recursive: true, force: true });
    }
  });
}

test("check-instruction-refs does not read a bare URI scheme as a path", () => {
  // `orm-schema://` ends in `/`, so without the scheme rule it is an
  // unrooted directory that no tracked path ends with (barwise-yi6).
  const r = refsRepo({
    files: {
      "CLAUDE.md":
        "Read the `orm-schema://` resource, or `Orm-Model://`; see `HTTPS://example.com/a.md`.\n",
      // Not an instruction file: a dead path here is not read at all.
      ".github/pull_request_template.md": "See `barwise/docs/gone.md`.\n",
      ".github/instructions/README.md": "See `barwise/docs/gone.md`.\n",
    },
  });
  try {
    const out = r.run();
    assert.equal(out.status, 0, out.stdout + out.stderr);
    assert.doesNotMatch(out.stderr, /orm-schema|Orm-Model|gone\.md/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-instruction-refs fails an ignored untracked path unless allowlisted, and a stale row", () => {
  // `git check-ignore` cannot tell a build output from a typo under dist/.
  // The cited file exists on disk and git ignores it: exactly the state a
  // check-ignore rule would wave through (Copilot on #626).
  const files = {
    ".gitignore": "dist/\n",
    "barwise/dist/out.js": "",
    "CLAUDE.md": "Built to `barwise/dist/out.js`.\n",
  };
  let r = refsRepo({ files });
  try {
    assert.equal(r.run().status, 1);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
  const row = { file: "CLAUDE.md", token: "barwise/dist/out.js", why: "a build output" };
  r = refsRepo({ files, allow: [row] });
  try {
    assert.equal(r.run().status, 0);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
  r = refsRepo({ allow: [row] });
  try {
    const out = r.run();
    assert.equal(out.status, 1);
    assert.match(out.stderr, /ALLOWLIST: CLAUDE\.md `barwise\/dist\/out\.js` matches nothing/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-instruction-refs refuses a listing with no instruction file rather than reporting OK", () => {
  // Tracked files exist, so trackedFiles() returns; it is the gate's own
  // filter that comes back empty (Copilot on #626).
  const r = refsRepo({
    files: {
      "CLAUDE.md": null,
      "barwise/pkg/CLAUDE.md": null,
      ".claude/skills/s/SKILL.md": null,
      ".claude/skills/s/notes.md": null,
      "REVIEW.md": null,
    },
  });
  try {
    const out = r.run();
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /none of them an instruction file/);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(r.dir, { recursive: true, force: true });
  }
});

test("check-instruction-refs refuses an empty listing rather than reporting OK", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-refs-empty-"));
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
    for (
      const f of [
        "check-instruction-refs.mjs",
        join("lib", "tracked.mjs"),
        join("lib", "instruction-files.mjs"),
      ]
    ) {
      writeFileSync(join(dir, "scripts", f), readFileSync(join(SCRIPTS, f)));
    }
    writeFileSync(join(dir, "scripts", "instruction-refs-allowlist.json"), '{"rows":[]}');
    const out = spawnSync(process.execPath, [join(dir, "scripts", "check-instruction-refs.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.doesNotMatch(out.stdout, /OK/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * A spec's Touches: header replaces inference (plan-scope-check.spec.md,
 * WS2): a path cited only as context no longer makes an unrelated edit
 * read as implementation, and shared wiring listed in Touches: is
 * ignored by the audit. The control is the same spec without the header,
 * which does trip on the same edit.
 */
test("audit-spec-status reads Touches: instead of every cited path, and ignores wiring", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-touches-audit-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  const run = () =>
    spawnSync(process.execPath, [join(SCRIPTS, "audit-spec-status.mjs"), "--check"], {
      cwd: dir,
      encoding: "utf8",
    });
  const specs = join(dir, "barwise", "docs", "specs");
  try {
    g("init", "-q");
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "test");
    mkdirSync(join(dir, "barwise", "src"), { recursive: true });
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    mkdirSync(specs, { recursive: true });
    mkdirSync(join(dir, ".beads"), { recursive: true });
    writeFileSync(join(dir, ".beads", "issues.jsonl"), "");
    writeFileSync(join(dir, "barwise", "src", "a.ts"), "0\n");
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "0\n");
    writeFileSync(join(dir, "barwise", "spec-status-baseline.json"), '{"specs":{}}\n');
    const body = "Builds `barwise/src/a.ts`; CI runs it from `.github/workflows/ci.yml`.\n";
    writeFileSync(
      join(specs, "declared.spec.md"),
      `# D\n\nStatus: Draft -- no workstream implemented\nTouches: barwise/src/a.ts, .github/workflows/ci.yml\n\n## Body\n\n${body}`,
    );
    writeFileSync(
      join(specs, "inferred.spec.md"),
      `# I\n\nStatus: Draft -- no workstream implemented\n\n## Body\n\n${body}`,
    );
    g("add", "-A");
    g("commit", "-qm", "specs");
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "1\n");
    g("commit", "-qam", "ci");
    const r = run();
    assert.equal(r.status, 1, "the inferred spec reads ci.yml as its subject");
    assert.match(r.stderr, /NEW: inferred\.spec\.md/);
    assert.doesNotMatch(
      r.stderr,
      /declared\.spec\.md/,
      "Touches: lists ci.yml as wiring, which the audit ignores",
    );
    writeFileSync(join(dir, "barwise", "src", "a.ts"), "1\n");
    g("commit", "-qam", "implementation");
    assert.match(run().stderr, /NEW: declared\.spec\.md/, "a declared subject still counts");
    // Touches: that omits ci.yml altogether (the spec's WS2 case): the
    // body still cites it, and an edit to it is not this spec's subject.
    writeFileSync(
      join(specs, "omits.spec.md"),
      `# O\n\nStatus: Draft -- no workstream implemented\nTouches: barwise/src/b.ts\n\n## Body\n\n${body}`,
    );
    writeFileSync(join(dir, "barwise", "src", "b.ts"), "0\n");
    g("add", "-A");
    g("commit", "-qm", "omits");
    writeFileSync(join(dir, ".github", "workflows", "ci.yml"), "2\n");
    g("commit", "-qam", "ci again");
    assert.doesNotMatch(run().stderr, /omits\.spec\.md/);
    // A directory entry is a subject: the audit used to drop it with the
    // non-code entries, which left a directory-only plan unaudited.
    mkdirSync(join(dir, "barwise", "lib"), { recursive: true });
    writeFileSync(join(dir, "barwise", "lib", "c.ts"), "0\n");
    writeFileSync(
      join(specs, "dir.spec.md"),
      "# R\n\nStatus: Draft -- no workstream implemented\nTouches: barwise/lib/\n\n## Body\n",
    );
    g("add", "-A");
    g("commit", "-qm", "dir spec");
    writeFileSync(join(dir, "barwise", "lib", "c.ts"), "1\n");
    g("commit", "-qam", "lib");
    assert.match(run().stderr, /NEW: dir\.spec\.md/);
    // Declared entries pass the audit's filters too: Markdown, a barrel,
    // and wiring under a declared directory are never a spec's subject.
    mkdirSync(join(dir, "barwise", "tool", "tests"), { recursive: true });
    for (const p of ["README.md", "index.ts", "tests/t.mjs", "real.ts"]) {
      writeFileSync(join(dir, "barwise", "tool", p), "0\n");
    }
    mkdirSync(join(dir, "barwise", "scripts", "tests"), { recursive: true });
    writeFileSync(join(dir, "barwise", "scripts", "tests", "w.mjs"), "0\n");
    writeFileSync(
      join(specs, "filtered.spec.md"),
      "# F\n\nStatus: Draft -- no workstream implemented\n"
        + "Touches: barwise/tool/README.md, barwise/tool/index.ts, barwise/scripts/\n\n## Body\n",
    );
    g("add", "-A");
    g("commit", "-qm", "filtered spec");
    for (
      const p of ["barwise/tool/README.md", "barwise/tool/index.ts", "barwise/scripts/tests/w.mjs"]
    ) {
      writeFileSync(join(dir, p), "1\n");
    }
    g("commit", "-qam", "markdown, a barrel, wiring");
    assert.doesNotMatch(run().stderr, /filtered\.spec\.md/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * audit-spec-status: a verdict covers the commits it was written against
 * (barwise-qs8). A refresh once added nine commits to a row under a note
 * describing older ones, and --check passed. --check now reports commits a
 * verdict never recorded, without failing on them, and --write reopens the
 * note so the refresh cannot stand in for a re-read.
 */
test("audit-spec-status reports commits a verdict never covered, and --write reopens the note [adr:baselines-merge-on-write#merge-not-regenerate]", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-specaudit-"));
  const g = (...args) =>
    execFileSync("git", args, { cwd: dir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] })
      .trim();
  const run = (...args) =>
    spawnSync(process.execPath, [join(SCRIPTS, "audit-spec-status.mjs"), ...args], {
      cwd: dir,
      encoding: "utf8",
    });
  const baselineFile = join(dir, "barwise", "spec-status-baseline.json");
  try {
    g("init", "-q");
    g("config", "user.email", "test@example.com");
    g("config", "user.name", "test");
    mkdirSync(join(dir, "barwise", "src"), { recursive: true });
    mkdirSync(join(dir, "barwise", "docs", "specs"), { recursive: true });
    mkdirSync(join(dir, ".beads"), { recursive: true });
    writeFileSync(join(dir, ".beads", "issues.jsonl"), "");
    writeFileSync(join(dir, "barwise", "src", "a.ts"), "0\n");
    g("add", "-A");
    g("commit", "-qm", "source");
    writeFileSync(
      join(dir, "barwise", "docs", "specs", "s.spec.md"),
      "# S\n\nStatus: Draft -- no workstream implemented\n\nBuilds `barwise/src/a.ts`.\n",
    );
    g("add", "-A");
    g("commit", "-qm", "spec");
    const touch = (n) => {
      writeFileSync(join(dir, "barwise", "src", "a.ts"), `${n}\n`);
      g("commit", "-qam", `touch ${n}`);
      return g("rev-parse", "HEAD");
    };

    const first = touch(1);
    // Six characters, shorter than the seven git abbreviates to here: the
    // match must be by prefix, as a growing repository lengthens them.
    writeFileSync(
      baselineFile,
      JSON.stringify({
        specs: {
          "s.spec.md": {
            status: "Draft -- no workstream implemented",
            commits: [first.slice(0, 6)],
            note: "Reviewed: the commit is unrelated to this spec.",
          },
        },
      }),
    );
    let r = run("--check");
    assert.equal(r.status, 0, `a covered verdict passes: ${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /predate commits/, "a recorded commit is not reported");

    const second = touch(2);
    r = run("--check");
    assert.equal(r.status, 0, `an unrecorded commit is reported, not failed: ${r.stderr}`);
    assert.match(r.stdout, new RegExp(`s\\.spec\\.md: ${second.slice(0, 7)}`));

    r = run("--write");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(
      r.stdout,
      new RegExp(
        `reopened \\(re-read before --check passes\\): s\\.spec\\.md: ${second.slice(0, 7)}`,
      ),
      "a write that rewrites a note must say so",
    );
    const note = JSON.parse(readFileSync(baselineFile, "utf8")).specs["s.spec.md"].note;
    assert.match(note, /^TODO: re-read -- /, "the write must reopen the verdict, not keep it");
    assert.match(note, /Previous note: Reviewed: the commit is unrelated/);
    r = run("--check");
    assert.equal(r.status, 1, "a reopened verdict stays red until a person re-reads it");
    assert.match(r.stderr, /UNCLASSIFIED: s\.spec\.md -- reopened: TODO: re-read -- /);
    assert.doesNotMatch(r.stderr, /has no note/, "a reopened row has a note; say what it asks");

    // A commit that lands while the row is reopened joins its TODO, so the
    // re-read covers everything the row will then record.
    const third = touch(3);
    r = run("--write");
    assert.equal(r.status, 0, r.stdout + r.stderr);
    const again = JSON.parse(readFileSync(baselineFile, "utf8")).specs["s.spec.md"].note;
    assert.match(
      again,
      new RegExp(`^TODO: re-read -- ${second.slice(0, 7)}\\w*, ${third.slice(0, 7)}`),
    );
    assert.match(again, /Previous note: Reviewed: the commit is unrelated to this spec\.$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
