/**
 * Gate tests: the correction ratchet and the ratchet and writer tests over every
 * baseline. Several of these rewrite the repository's LIVE baseline files and
 * restore them in `finally`, and one asserts the live `git status` is unchanged
 * around a gate run, so this file must not run beside any other: the
 * `.serial.test.mjs` suffix tells run-script-tests.mjs to run it alone, after
 * the parallel files.
 *
 * Split from gates.test.mjs (barwise-bbt) so the gate tests run in parallel;
 * why these tests exist at all is the header of gates-helpers.mjs.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { ciSteps } from "../lib/ci-gates.mjs";
import {
  RATCHETS,
  SOURCE_FILES as FINDING_SOURCE_FILES,
  SOURCE_KEYS as FINDING_SOURCE_KEYS,
} from "../lib/findings.mjs";
import { gate, needDist, REPO, SCRIPTS, skipIfShallow, stage, tempRepo } from "./gates-helpers.mjs";

// --- barwise-1013: the correction ratchet fails both ways ---

/**
 * A baseline that only fails on NEW records would let a fixed row sit
 * forever; one that only fails on stale rows would let a new correction
 * ship unclassified. Both halves are asserted, and both are established
 * red here rather than argued -- the gate's whole subject is that a
 * check nobody watched fail is not a check (assertion-audit rule 0).
 *
 * The probes are STAGED, not merely written: the gate enumerates through
 * `trackedFiles()`, so a spec written to disk and never `git add`ed is
 * invisible to it and the run would report a match having read nothing.
 * That is barwise-906's shape, and it is the reason this file has the
 * `stage` helper at all.
 */
function correctionRepo(specs, baselineRecords) {
  const dir = tempRepo();
  for (const [name, body] of Object.entries(specs)) {
    stage(dir, `barwise/docs/specs/${name}`, body);
  }
  stage(
    dir,
    "barwise/correction-baseline.json",
    JSON.stringify({ $comment: "test", records: baselineRecords }, null, 2) + "\n",
  );
  return dir;
}

/** The id the gate assigns, read from its own listing rather than recomputed. */
function idOf(dir, excerptFragment) {
  const listing = gate("audit-corrections.mjs", dir);
  assert.equal(listing.status, 0, `listing failed:\n${listing.stdout}${listing.stderr}`);
  const lines = listing.stdout.split("\n");
  const i = lines.findIndex((l) => l.includes(excerptFragment));
  assert.ok(i > 0, `no record matching ${excerptFragment} in:\n${listing.stdout}`);
  return lines[i - 1].trim();
}

const A_CORRECTION =
  "# Probe\n\nThe draft said the loader was pure, and implementing it showed the\n"
  + "loader reads the environment, so the claim was wrong in kind.\n";

/**
 * The stale half of findings-close-by-mechanism decision 2, per ratchet:
 * a row planted in the real baseline that its detector does not produce
 * (restored in `finally`), or the name of a test that already plants one
 * in a sandbox. Keyed by RATCHETS' sources, which a test below holds to
 * cover them all.
 */
const STALE_CASES = {
  duplication: {
    row: { status: "accepted-benign", note: "a planted stale row", detail: "none" },
    output: /^\s*STALE baseline entry no longer detected: zz-planted-stale-row\b/m,
  },
  rubric: {
    row: {
      case: "none",
      kind: "must_validate",
      message: "x",
      verdict: "accepted-benign: a planted stale row",
    },
    output: /Baseline entry no longer detected: zz-planted-stale-row\b/,
    // Scores through the built promptlab, as its writer test does.
    needsDist: "packages/promptlab/dist/index.js",
  },
  specs: {
    row: { status: "Draft", commits: ["00000000"], note: "a planted stale row" },
    needsHistory: true,
    output: /STALE baseline row: zz-planted-stale-row\b/,
  },
  corrections: {
    testedBy: [
      "barwise/scripts/tests/gates-baselines.serial.test.mjs",
      "audit-corrections fails on a baseline entry no longer detected",
    ],
  },
  "merge-record": {
    testedBy: [
      "barwise/scripts/tests/merge-record.test.mjs",
      "a baseline row naming a commit outside the range is stale",
    ],
  },
  trial: {
    testedBy: [
      "barwise/trial/tests/oracles.test.mjs",
      "evaluateGate: a new failure, a stale row and an unclassified row each fail the gate",
    ],
  },
};

for (const [source, c] of Object.entries(STALE_CASES).filter(([, x]) => x.row)) {
  const rt = RATCHETS.find((x) => x.source === source);
  test(`${rt.script} --check fails on a stale baseline row [adr:findings-close-by-mechanism#ratchet-both-ways]`, (t) => {
    if (c.needsDist !== undefined && needDist(t, c.needsDist)) return;
    if (c.needsHistory && skipIfShallow(t)) return;
    const path = join(REPO, "barwise", FINDING_SOURCE_FILES[source]);
    const before = readFileSync(path, "utf8");
    try {
      const json = JSON.parse(before);
      json[FINDING_SOURCE_KEYS[source]]["zz-planted-stale-row"] = c.row;
      writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
      const r = spawnSync(process.execPath, [join(REPO, "barwise", rt.script), "--check"], {
        cwd: REPO,
        encoding: "utf8",
      });
      const out = `${r.stdout}${r.stderr}`;
      // A build that exists but will not load is not the ratchet's verdict.
      if (c.needsDist !== undefined && needDist(t, c.needsDist, out)) return;
      assert.equal(r.status, 1, `expected a finding (1), got ${r.status}:\n${out}`);
      // The stale message names the planted row itself, on one line.
      assert.match(out, c.output);
    } finally {
      writeFileSync(path, before);
    }
  });
}

/**
 * The other half of findings-close-by-mechanism decision 2: a candidate with
 * no baseline row is a finding. A ratchet either plants it (the first row of
 * the real baseline, by sorted id, deleted and restored in `finally`, so the
 * real detector produces the candidate), or names the test that already
 * shows it, where no `--check` case can withhold a row. A registry test
 * below holds the keys to RATCHETS.
 */
const NEW_CASES = {
  duplication: {
    output: (id) => new RegExp(`NEW candidate not in audit-baseline\\.json:\\s+${escapeRe(id)}\\b`),
  },
  rubric: {
    output: (id) =>
      new RegExp(`NEW non-discriminating check, not in the baseline:\\s+${escapeRe(id)}\\b`),
    needsDist: "packages/promptlab/dist/index.js",
  },
  specs: {
    needsHistory: true,
    output: (id) => new RegExp(`^\\s*NEW: ${escapeRe(id)}$`, "m"),
  },
  corrections: {
    testedBy: [
      "barwise/scripts/tests/gates-baselines.serial.test.mjs",
      "audit-corrections fails on a correction record missing from the baseline",
    ],
  },
  "merge-record": {
    testedBy: [
      "barwise/scripts/tests/merge-record.test.mjs",
      "a merge with no trailer at all is a finding",
    ],
  },
  trial: {
    // One title covers the new, stale and unclassified halves, so
    // STALE_CASES.trial names the same test.
    testedBy: [
      "barwise/trial/tests/oracles.test.mjs",
      "evaluateGate: a new failure, a stale row and an unclassified row each fail the gate",
    ],
  },
};

function escapeRe(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

for (const [source, c] of Object.entries(NEW_CASES).filter(([, x]) => x.output)) {
  const rt = RATCHETS.find((x) => x.source === source);
  test(`${rt.script} --check fails on a candidate with no baseline row [adr:findings-close-by-mechanism#ratchet-both-ways]`, (t) => {
    if (c.needsDist !== undefined && needDist(t, c.needsDist)) return;
    if (c.needsHistory && skipIfShallow(t)) return;
    const path = join(REPO, "barwise", FINDING_SOURCE_FILES[source]);
    const before = readFileSync(path, "utf8");
    try {
      const json = JSON.parse(before);
      const rows = json[FINDING_SOURCE_KEYS[source]];
      const id = Object.keys(rows).sort()[0];
      assert.ok(id, `${source}: the baseline holds no row to withhold`);
      delete rows[id];
      writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
      const r = spawnSync(process.execPath, [join(REPO, "barwise", rt.script), "--check"], {
        cwd: REPO,
        encoding: "utf8",
      });
      const out = `${r.stdout}${r.stderr}`;
      if (c.needsDist !== undefined && needDist(t, c.needsDist, out)) return;
      assert.equal(r.status, 1, `expected a finding (1), got ${r.status}:\n${out}`);
      assert.match(out, c.output(id));
    } finally {
      writeFileSync(path, before);
    }
  });
}

test("every baseline has a registered ratchet, wired into CI with a stale-row case, or a stated reason [adr:findings-close-by-mechanism#ratchet-in-ci]", async () => {
  // RATCHETS (scripts/lib/findings.mjs) must cover every baseline the
  // findings reader reads, so a new audit cannot land with neither check.
  // A ci line must be a step that can fail CI (the judgement adr-judge
  // makes for a declared gate), and the npm script it runs must be the
  // script the stale case runs. An exemption says why, in words.
  assert.deepEqual(
    RATCHETS.map((rt) => rt.source).sort(),
    Object.keys(FINDING_SOURCE_FILES).sort(),
    "a baseline has no ratchet in RATCHETS, or a ratchet names no baseline",
  );
  assert.deepEqual(
    Object.keys(STALE_CASES).sort(),
    RATCHETS.map((rt) => rt.source).sort(),
    "a ratchet has no stale-row case",
  );
  assert.deepEqual(
    Object.keys(NEW_CASES).sort(),
    RATCHETS.map((rt) => rt.source).sort(),
    "a ratchet has no new-candidate case",
  );
  const { ciStepOccurrences } = await import("../lib/ci-occurrences.mjs");
  const { stepGates } = await import("../lib/adr-judge.mjs");
  const steps = ciStepOccurrences(join(REPO, ".github", "workflows", "ci.yml"));
  const scripts = JSON.parse(readFileSync(join(REPO, "barwise", "package.json"), "utf8")).scripts;
  for (const rt of RATCHETS) {
    assert.ok(
      (rt.ci === undefined) !== (rt.noCi === undefined),
      `${rt.source}: a ratchet has a ci line or a noCi reason, exactly one`,
    );
    if (rt.noCi !== undefined) {
      assert.ok(rt.noCi.length > 20, `${rt.source}: an exemption needs its reason`);
      continue;
    }
    assert.ok(
      steps.some((st) => st.run === rt.ci && stepGates(st)),
      `${rt.source}: no ci.yml step running "${rt.ci}" can fail CI`,
    );
    const name = /^npm run (\S+)/.exec(rt.ci)[1];
    assert.equal(
      scripts[name],
      `node ${rt.script}`,
      `${rt.source}: ${name} does not run ${rt.script}, the script the stale case runs`,
    );
  }
  for (const [half, cases] of [["stale-row", STALE_CASES], ["new-candidate", NEW_CASES]]) {
    for (const [source, c] of Object.entries(cases)) {
      if (!c.testedBy) continue;
      const [file, title] = c.testedBy;
      assert.ok(
        readFileSync(join(REPO, file), "utf8").includes(title),
        `${source}: its ${half} test "${title}" is not in ${file}`,
      );
    }
  }
});

test("audit-corrections fails on a correction record missing from the baseline [adr:findings-close-by-mechanism#ratchet-both-ways]", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const red = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(red.status, 1, `expected a finding (1), got ${red.status}`);
    assert.match(`${red.stdout}${red.stderr}`, /NEW correction record/);
    assert.match(`${red.stdout}${red.stderr}`, /probe/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections fails on a baseline entry no longer detected [adr:findings-close-by-mechanism#ratchet-both-ways]", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    const withRow = correctionRepo({ "probe.spec.md": A_CORRECTION }, {
      [id]: { spec: "probe.spec.md", excerpt: "x", caught_by: "execution", note: "" },
    });
    try {
      assert.equal(
        gate("audit-corrections.mjs", withRow, "--check").status,
        0,
        "a classified record must pass before the stale half can mean anything",
      );
      // Rewrite the paragraph past recognition; the row now describes
      // text that is not there.
      stage(withRow, "barwise/docs/specs/probe.spec.md", "# Probe\n\nNothing here.\n");
      const red = gate("audit-corrections.mjs", withRow, "--check");
      assert.equal(red.status, 1, `expected a finding (1), got ${red.status}`);
      assert.match(`${red.stdout}${red.stderr}`, /no longer detected/);
    } finally {
      rmSync(withRow, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections fails a row whose verdict is not a classification", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    const bad = correctionRepo({ "probe.spec.md": A_CORRECTION }, {
      [id]: { spec: "probe.spec.md", excerpt: "x", caught_by: "TODO: classify", note: "" },
    });
    try {
      const red = gate("audit-corrections.mjs", bad, "--check");
      assert.equal(red.status, 1, `expected a finding (1), got ${red.status}`);
      assert.match(`${red.stdout}${red.stderr}`, /no usable verdict/);
    } finally {
      rmSync(bad, { recursive: true, force: true });
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections refuses an empty spec corpus rather than reporting a match", () => {
  // The reading that looks like success: every check filters the record
  // list, so zero specs would print "baseline matches" having read
  // nothing at all.
  const dir = tempRepo();
  try {
    stage(dir, "README.md", "no specs here\n");
    stage(dir, "barwise/correction-baseline.json", '{"records":{}}\n');
    const r = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(r.status, 2, `expected refusal (2), got ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stdout, /baseline matches/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections refuses to WRITE a baseline while a spec is untracked", () => {
  // The defect this gate shipped with, pinned. Its own baseline was
  // generated while its own spec was unstaged: the gate enumerates
  // through trackedFiles(), so the spec was invisible, --check passed
  // locally, and CI went red on five records from that very file the
  // moment it was committed. --check still does not refuse here -- its
  // input is the TRACKED corpus by definition, the same blind spot
  // check-no-nul pins as intended -- but --write persists the
  // incomplete reading, so that is the operation that refuses.
  const dir = correctionRepo({ "tracked.spec.md": A_CORRECTION }, {});
  try {
    writeFileSync(join(dir, "barwise/docs/specs/draft.spec.md"), A_CORRECTION);

    const write = gate("audit-corrections.mjs", dir, "--write");
    assert.equal(write.status, 2, `expected refusal (2), got ${write.status}`);
    assert.match(write.stderr, /draft\.spec\.md/);
    assert.doesNotMatch(write.stdout, /wrote/);

    // --check keeps its verdict and exit code -- the untracked draft is out
    // of its corpus -- but names the draft as unchecked, so the verdict does
    // not read as covering it (barwise-qch).
    const check = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(check.status, 1, "the tracked probe is still unclassified, so --check finds it");
    assert.match(
      check.stdout,
      /audit-corrections: unchecked \(untracked\): barwise\/docs\/specs\/draft\.spec\.md/,
    );

    // An archived spec is outside the corpus even once tracked, so it is
    // neither named as unchecked nor a reason to refuse a write.
    mkdirSync(join(dir, "barwise/docs/specs/archive"), { recursive: true });
    writeFileSync(join(dir, "barwise/docs/specs/archive/old.spec.md"), A_CORRECTION);
    const withArchive = gate("audit-corrections.mjs", dir, "--check");
    assert.doesNotMatch(withArchive.stdout, /archive\/old\.spec\.md/);
    rmSync(join(dir, "barwise/docs/specs/draft.spec.md"));
    const archiveOnly = gate("audit-corrections.mjs", dir, "--write");
    assert.equal(
      archiveOnly.status,
      0,
      `an archived draft alone must not block --write:\n${archiveOnly.stderr}`,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-spec-status refuses to WRITE a baseline while a spec is untracked", () => {
  // The SECOND caller of the shared guard, pinned separately -- because
  // mutating lib/tracked.mjs is caught by the audit-corrections test above
  // whether or not this gate calls it at all. Removing the call here was
  // UNCAUGHT until this test existed, which is barwise-1018's own shape:
  // a fix nothing would notice losing.
  const dir = correctionRepo({ "tracked.spec.md": A_CORRECTION }, {});
  try {
    stage(
      dir,
      "barwise/spec-status-baseline.json",
      JSON.stringify({ $comment: "test", specs: {} }, null, 2) + "\n",
    );
    execFileSync("git", ["commit", "-qm", "base"], { cwd: dir });
    writeFileSync(join(dir, "barwise/docs/specs/draft.spec.md"), A_CORRECTION);

    const write = gate("audit-spec-status.mjs", dir, "--write");
    assert.equal(
      write.status,
      2,
      `expected refusal (2), got ${write.status}:\n${write.stdout}${write.stderr}`,
    );
    assert.match(write.stderr, /draft\.spec\.md/);

    // --check names it as unchecked and keeps its own verdict (barwise-qch).
    const check = gate("audit-spec-status.mjs", dir, "--check");
    assert.equal(check.status, 0, `${check.stdout}${check.stderr}`);
    assert.match(
      check.stdout,
      /audit-spec-status: unchecked \(untracked\): barwise\/docs\/specs\/draft\.spec\.md/,
    );

    // Archived specs are outside this audit's corpus too.
    mkdirSync(join(dir, "barwise/docs/specs/archive"), { recursive: true });
    writeFileSync(join(dir, "barwise/docs/specs/archive/old.spec.md"), A_CORRECTION);
    assert.doesNotMatch(
      gate("audit-spec-status.mjs", dir, "--check").stdout,
      /archive\/old\.spec\.md/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections detects a marker the formatter wrapped across a line break", () => {
  // The detector matched the RAW paragraph, so `turned\nout` did not match
  // /\bturned out\b/ and the record was invisible. Twelve of the seventeen
  // markers are multi-word and dprint owns the wrapping in docs/specs, so
  // whether a correction record was detected depended on where the
  // formatter happened to break the line -- which the author does not
  // choose and cannot see in the source. Five real records across four
  // specs were being missed, two of them in gate-refusal-contract.spec.md,
  // the spec about gates that cannot see their input.
  //
  // The split is the whole test: "turned out" is the only marker in this
  // probe, and it straddles the newline. Passing it means normalisation
  // happens before matching, not after.
  const wrapped = "# Probe\n\nThe estimate of what workstream 2 touches turned\n"
    + "out to be mistaken once the packages were counted, so the figure is\n"
    + "restated here with the real set.\n";
  const dir = correctionRepo({ "probe.spec.md": wrapped }, {});
  try {
    const red = gate("audit-corrections.mjs", dir, "--check");
    assert.equal(
      red.status,
      1,
      `a wrapped marker must still be detected:\n${red.stdout}${red.stderr}`,
    );
    assert.match(`${red.stdout}${red.stderr}`, /NEW correction record/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/*
 * ---------------------------------------------------------------------------
 * Baseline writers merge the verdicts they find.
 *
 * All three writers built their row map from the detector alone, stamping a
 * placeholder into every row -- so the documented way to add ONE row was the
 * way to destroy every judgment in the file. Measured before the fix: 90 of 90
 * verdicts replaced and 74 notes blanked, from the spellings the scripts
 * advertise (barwise-1026, docs/specs/baseline-write-preserves-verdicts.spec.md).
 *
 * The loss was silent: the only reason it was ever noticed is that a later
 * `--check` happened to fail on an untouched row. So these tests assert the
 * write path directly rather than trusting `--check` to catch a clobber.
 * ---------------------------------------------------------------------------
 */

/** The three writers, their baseline file, and the fields a human owns in it. */
const BASELINE_WRITERS = [
  {
    script: "audit-corrections.mjs",
    args: ["--write"],
    file: "barwise/correction-baseline.json",
    key: "records",
    human: ["caught_by", "note"],
    placeholder: "TODO: classify",
  },
  {
    script: "check-merge-record.mjs",
    args: ["--write"],
    file: "barwise/merge-record-baseline.json",
    key: "merges",
    human: ["status", "note"],
    placeholder: "TODO: classify",
  },
  {
    script: "audit-rubric.mjs",
    args: ["--write-baseline"],
    file: "barwise/rubric-baseline.json",
    key: "checks",
    human: ["verdict"],
    placeholder: "TODO",
    // Reads packages/promptlab/dist. ci.yml runs test:scripts after the build,
    // so under CI an absent dist fails (needDist); on a developer's machine it
    // skips: a test that cannot see its input must not report a pass.
    needsDist: "packages/promptlab/dist/index.js",
  },
  {
    script: "audit-spec-status.mjs",
    args: ["--write"],
    file: "barwise/spec-status-baseline.json",
    key: "specs",
    // It reads history, and refuses a shallow clone (skipIfShallow).
    needsHistory: true,
    human: ["note"],
    placeholder: "TODO: classify",
    // The one change a rewrite may make to a verdict: reopening it, with the
    // old note kept whole, when commits it never covered have landed
    // (barwise-qs8). Anything else is the barwise-1026 loss.
    reopened: (before, after) => {
      const inner = /Previous note: ([\s\S]*)$/.exec(before)?.[1] ?? before;
      return typeof after === "string" && /^TODO: re-read -- /.test(after)
        && after.endsWith(`Previous note: ${/^TODO: re-read -- /.test(before) ? inner : before}`);
    },
  },
];

for (const w of BASELINE_WRITERS) {
  test(`${w.script} rewrites without changing a committed verdict [adr:baselines-merge-on-write#merge-not-regenerate]`, (t) => {
    if (w.needsDist !== undefined && needDist(t, w.needsDist)) return;
    if (w.needsHistory && skipIfShallow(t)) return;

    const path = join(REPO, w.file);
    const before = readFileSync(path, "utf8");
    try {
      const r = gate(w.script, REPO, ...w.args);
      assert.equal(r.status, 0, `writer failed:\n${r.stdout}${r.stderr}`);
      const after = readFileSync(path, "utf8");

      // The property, stated over the human-owned fields rather than over the
      // bytes. An earlier version of this test asserted the file came back
      // byte-identical to the committed one, which is NOT a property of
      // audit-spec-status: its `commits` field is derived from `git log`, so it
      // legitimately changes the moment any commit touches a spec's named
      // sources. That test passed locally and failed in CI on this PR's own
      // first commit, because locally it ran before the commit existed -- green
      // for a reason unrelated to what it verified (barwise-906's shape).
      const oldRows = JSON.parse(before)[w.key];
      const newRows = JSON.parse(after)[w.key];
      for (const [id, row] of Object.entries(oldRows)) {
        assert.ok(id in newRows, `${w.file}: row ${id} was dropped by a rewrite`);
        for (const field of w.human) {
          if (w.reopened?.(row[field], newRows[id][field])) continue;
          assert.deepEqual(
            newRows[id][field],
            row[field],
            `${w.file}: ${id}.${field} changed when rewritten over itself. Before the`
              + ` fix this was every verdict in the file replaced by a placeholder.`,
          );
        }
      }

      // And the writer is a function of its inputs: whatever the first write
      // absorbed from a moved history, a second must be a no-op. This is the
      // byte-level half, stated where it is actually true.
      const again = gate(w.script, REPO, ...w.args);
      assert.equal(again.status, 0, `second write failed:\n${again.stdout}${again.stderr}`);
      assert.equal(
        readFileSync(path, "utf8"),
        after,
        `${w.file}: writing twice gave two different files, so the output depends`
          + ` on something other than the findings (row order, most likely).`,
      );
    } finally {
      // Restored unconditionally: a failing assertion must not leave the
      // repository's own baseline rewritten.
      writeFileSync(path, before);
    }
  });

  test(`${w.script} writes rows sorted by id and prints the merge summary [adr:baselines-merge-on-write#findings-order]`, (t) => {
    if (w.needsDist !== undefined && needDist(t, w.needsDist)) return;
    if (w.needsHistory && skipIfShallow(t)) return;
    // The order a writer writes, whatever order its baseline held: the
    // committed rows are reversed first so the input is never already the
    // answer. The sort itself is the helper's (and, for audit-spec-status,
    // its detector's too), so removing it fails the corrections and rubric
    // cases here and the helper's own test.
    const path = join(REPO, w.file);
    const before = readFileSync(path, "utf8");
    try {
      const json = JSON.parse(before);
      json[w.key] = Object.fromEntries(Object.entries(json[w.key]).reverse());
      writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
      const r = gate(w.script, REPO, ...w.args);
      assert.equal(r.status, 0, `writer failed:\n${r.stdout}${r.stderr}`);
      const ids = Object.keys(JSON.parse(readFileSync(path, "utf8"))[w.key]);
      assert.deepEqual(ids, [...ids].sort(), `${w.file}: the writer left its rows out of id order`);
      assert.match(r.stdout, /\d+ verdict\(s\) kept/, `${w.script}: no merge summary printed`);
    } finally {
      writeFileSync(path, before);
    }
  });

  test(`${w.file} has no unclassified row, so the round trip is not vacuous`, () => {
    // The round-trip test above is strong because every row in the committed
    // tree carries a real verdict: a placeholder row would survive a clobber
    // unchanged and the assertion would pass over exactly the data it exists
    // to protect. This is the guard on that precondition.
    const rows = JSON.parse(readFileSync(join(REPO, w.file), "utf8"))[w.key];
    const unclassified = Object.entries(rows).filter(([, row]) =>
      w.human.every((f) => row[f] === w.placeholder || row[f] === "")
    );
    assert.deepEqual(
      unclassified.map(([id]) => id),
      [],
      `${w.file} carries unclassified rows, which weakens the round-trip test above`,
    );
  });
}

test("test:scripts runs after the build whenever a test in this file needs promptlab's dist [adr:baselines-merge-on-write#merge-not-regenerate]", () => {
  const needing = [...BASELINE_WRITERS, ...Object.values(STALE_CASES), ...Object.values(NEW_CASES)]
    .filter((c) => c.needsDist !== undefined);
  assert.ok(needing.length > 0, "no registry entry needs a dist; this order check is vacuous");
  const steps = ciSteps();
  const build = steps.findIndex((s) => s.args === "run build");
  const scripts = steps.findIndex((s) => s.args === "run test:scripts");
  assert.ok(build >= 0 && scripts >= 0, "ci.yml runs both npm run build and npm run test:scripts");
  assert.ok(
    scripts > build,
    "ci.yml runs test:scripts before npm run build, so the rubric tests see no dist (barwise-ym8.fi5)",
  );
});

test("needDist throws under CI and skips otherwise, for an absent dist and one that will not load [adr:baselines-merge-on-write#merge-not-regenerate]", () => {
  const ci = process.env.CI;
  const skipped = [];
  const t = { skip: (why) => skipped.push(why) };
  try {
    delete process.env.CI;
    assert.equal(needDist(t, "packages/none/dist/index.js"), true);
    assert.equal(skipped.length, 1, "without CI an absent dist skips");
    assert.equal(needDist(t, "packages/core/package.json", "Cannot find module 'x'"), true);
    assert.equal(skipped.length, 2, "without CI a dist that will not load skips");
    assert.equal(needDist(t, "packages/core/package.json", "all fine"), false);
    for (const off of ["0", "false"]) {
      process.env.CI = off;
      assert.equal(needDist(t, "packages/none/dist/index.js"), true, `CI=${off} skips`);
    }
    assert.equal(skipped.length, 4, "CI=0 and CI=false skip like an unset CI");
    process.env.CI = "1";
    assert.throws(() => needDist(t, "packages/none/dist/index.js"), /CI is set.*npm run build/);
    assert.throws(
      () => needDist(t, "packages/core/package.json", "dist not found"),
      /does not load.*CI is set/,
    );
    assert.equal(skipped.length, 4, "under CI nothing is skipped");
  } finally {
    if (ci === undefined) delete process.env.CI;
    else process.env.CI = ci;
  }
});

test("audit-corrections --write keeps a classified verdict and its note", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    stage(
      dir,
      "barwise/correction-baseline.json",
      JSON.stringify(
        {
          $comment: "test",
          records: {
            [id]: {
              spec: "probe.spec.md",
              excerpt: "stale excerpt, refreshed by the writer",
              caught_by: "execution",
              note: "Implementing it is what showed the loader reads the environment.",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const w = gate("audit-corrections.mjs", dir, "--write");
    assert.equal(w.status, 0, `--write failed:\n${w.stdout}${w.stderr}`);

    const rows = JSON.parse(
      readFileSync(join(dir, "barwise/correction-baseline.json"), "utf8"),
    ).records;
    assert.equal(rows[id].caught_by, "execution", "the verdict must survive a rewrite");
    assert.match(rows[id].note, /reads the environment/, "the note must survive too");
    // The derived half still refreshes: the detector owns the excerpt, so a
    // stale one is replaced rather than preserved alongside the verdict.
    assert.match(rows[id].excerpt, /the draft said the loader was pure/);
    assert.match(w.stdout, /1 verdict\(s\) kept/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-corrections --write stamps the placeholder on a new record only", () => {
  const second = "# Probe two\n\nThe second estimate turned out to be mistaken once the\n"
    + "packages were counted, so the figure is restated with the real set here.\n";
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    stage(
      dir,
      "barwise/correction-baseline.json",
      JSON.stringify(
        {
          $comment: "test",
          records: {
            [id]: { spec: "probe.spec.md", excerpt: "x", caught_by: "reasoning", note: "kept" },
          },
        },
        null,
        2,
      ) + "\n",
    );
    stage(dir, "barwise/docs/specs/two.spec.md", second);

    const w = gate("audit-corrections.mjs", dir, "--write");
    assert.equal(w.status, 0, `--write failed:\n${w.stdout}${w.stderr}`);

    const rows = JSON.parse(
      readFileSync(join(dir, "barwise/correction-baseline.json"), "utf8"),
    ).records;
    assert.equal(rows[id].caught_by, "reasoning");
    assert.equal(rows[id].note, "kept");
    const fresh = Object.entries(rows).find(([rid]) => rid !== id);
    assert.ok(fresh, "the new record must be written");
    assert.equal(fresh[1].caught_by, "TODO: classify", "a NEW row gets the placeholder");
    assert.match(w.stdout, /1 verdict\(s\) kept, 1 new/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

/*
 * The "empty note survives" case is NOT here: corrections' own placeholder for
 * `note` is `""`, so at this level the merge rule and a naive `||` fallthrough
 * are indistinguishable -- a mutation swapping them passed all 118 tests. It is
 * asserted against the helper instead, in baseline-merge.test.mjs, which is the
 * level where the distinction is observable.
 */

test("audit-corrections --write reports a row it dropped rather than dropping it silently", () => {
  const dir = correctionRepo({ "probe.spec.md": A_CORRECTION }, {});
  try {
    const id = idOf(dir, "the draft said the loader was pure");
    stage(
      dir,
      "barwise/correction-baseline.json",
      JSON.stringify(
        {
          $comment: "test",
          records: {
            [id]: { spec: "probe.spec.md", excerpt: "x", caught_by: "execution", note: "n" },
            "gone::deadbeef0000": {
              spec: "gone.spec.md",
              excerpt: "text that is no longer anywhere",
              caught_by: "reasoning",
              note: "n",
            },
          },
        },
        null,
        2,
      ) + "\n",
    );

    const w = gate("audit-corrections.mjs", dir, "--write");
    assert.equal(w.status, 0, `--write failed:\n${w.stdout}${w.stderr}`);
    assert.match(w.stdout, /1 no longer detected/);
    assert.match(w.stdout, /gone::deadbeef0000/);
    const rows = JSON.parse(
      readFileSync(join(dir, "barwise/correction-baseline.json"), "utf8"),
    ).records;
    assert.ok(!("gone::deadbeef0000" in rows), "an undetected row is not written back");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("audit-spec-status writes nothing without --write [adr:baselines-merge-on-write#specs-write-on-ask]", (t) => {
  if (skipIfShallow(t)) return;
  // The write path used to be the `else` of `--check`, so bare
  // `npm run audit:specs` -- the spelling a reader tries first to see what the
  // gate says -- rewrote the baseline and blanked every note. The operator
  // never asked to write anything.
  const path = join(REPO, "barwise/spec-status-baseline.json");
  const before = readFileSync(path, "utf8");
  try {
    const r = gate("audit-spec-status.mjs", REPO);
    assert.equal(r.status, 0, `survey failed:\n${r.stdout}${r.stderr}`);
    assert.equal(readFileSync(path, "utf8"), before, "a bare invocation must not write");
    assert.match(r.stdout, /Nothing written/);
  } finally {
    writeFileSync(path, before);
  }
});

test("audit-spec-status leaves a stale, unsorted baseline alone unless asked, and rewrites it with --write [adr:baselines-merge-on-write#specs-write-on-ask]", (t) => {
  if (skipIfShallow(t)) return;
  // The committed baseline already equals what --write would produce, so a
  // bare run that wrote identical bytes would pass the test above. Reversing
  // the rows makes a write visible: a bare run must leave them reversed, and
  // --write must change them.
  const path = join(REPO, "barwise/spec-status-baseline.json");
  const before = readFileSync(path, "utf8");
  try {
    const json = JSON.parse(before);
    json.specs = Object.fromEntries(Object.entries(json.specs).reverse());
    const scrambled = JSON.stringify(json, null, 2) + "\n";
    assert.notEqual(scrambled, before, "the fixture must differ from what --write produces");
    writeFileSync(path, scrambled);
    const bare = gate("audit-spec-status.mjs", REPO);
    assert.equal(bare.status, 0, `survey failed:\n${bare.stdout}${bare.stderr}`);
    assert.equal(readFileSync(path, "utf8"), scrambled, "a bare invocation wrote the baseline");
    const written = gate("audit-spec-status.mjs", REPO, "--write");
    assert.equal(written.status, 0, `--write failed:\n${written.stdout}${written.stderr}`);
    assert.notEqual(readFileSync(path, "utf8"), scrambled, "--write did not write");
  } finally {
    writeFileSync(path, before);
  }
});

test("audit-duplication --check changes neither its baseline nor the tree [adr:baselines-merge-on-write#duplication-no-writer]", () => {
  // The text check below sees writeFileSync only; a write through
  // fs.promises, a stream or a helper module would pass it. Running the gate
  // shows any write it makes on the run CI makes: the baseline's bytes and
  // its modification time (a write of identical bytes still moves it), and
  // the whole tree's git status.
  const path = join(REPO, "barwise/audit-baseline.json");
  const status = () =>
    execFileSync("git", ["status", "--porcelain"], { cwd: REPO, encoding: "utf8" });
  const bytes = readFileSync(path, "utf8");
  const mtime = statSync(path).mtimeMs;
  const statusBefore = status();
  const r = gate("audit-duplication.mjs", REPO, "--check");
  // A finding (exit 1) is the gate's business, not this test's; a refusal or
  // a crash is not a run whose writes mean anything.
  assert.ok(
    r.status === 0 || r.status === 1,
    `audit:duplication --check did not run:\n${r.stdout}${r.stderr}`,
  );
  assert.equal(readFileSync(path, "utf8"), bytes, "audit-duplication rewrote its baseline");
  assert.equal(statSync(path).mtimeMs, mtime, "audit-duplication wrote its baseline (same bytes)");
  assert.equal(status(), statusBefore, "audit-duplication changed the working tree");
});

/**
 * Source without its comments: whole-line `//` comments and block comments
 * that open a line. A `/*` or `//` inside a string (a glob, a URL) is
 * left alone, so code after it is never mistaken for a comment.
 */
const codeOnly = (src) =>
  src.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");

/** Every script file under `dir` (relative to the repo root), recursively, tests and fixtures aside. */
function scriptFiles(dir) {
  return readdirSync(join(REPO, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      return ["tests", "fixtures", "node_modules"].includes(e.name)
        ? []
        : scriptFiles(rel);
    }
    return /\.(mjs|cjs|js)$/.test(e.name) ? [rel] : [];
  });
}

test("every baseline has one registered writer, and each merges through baseline-merge.mjs [adr:baselines-merge-on-write#one-merge-owner]", () => {
  // The five baselines are the ones scripts/lib/findings.mjs reads, so a new
  // baseline that lands with a reader but no row here fails. Each writer
  // reads and merges through the helper, or is declared an exception with
  // its reason; each helper-using writer is also one BASELINE_WRITERS runs;
  // and no other script writes a baseline at all.
  const WRITERS = {
    "audit-baseline.json": { none: "decision 5: edited by hand" },
    "correction-baseline.json": { script: "barwise/scripts/audit-corrections.mjs" },
    "merge-record-baseline.json": { script: "barwise/scripts/check-merge-record.mjs" },
    "rubric-baseline.json": { script: "barwise/scripts/audit-rubric.mjs" },
    "spec-status-baseline.json": { script: "barwise/scripts/audit-spec-status.mjs" },
    "trial-baseline.json": {
      script: "barwise/trial/lib/gate.mjs",
      exception: "additive: a run covers some scopes or one tier, and mergeBaselineRows "
        + "writes only the ids it is given; it keeps a row no longer open and prints its own "
        + "summary (baselines-merge-on-write, decision 2; audit-finding-reader.spec.md, Open decision 4)",
    },
  };
  assert.deepEqual(
    Object.keys(WRITERS).sort(),
    Object.values(FINDING_SOURCE_FILES).sort(),
    "a baseline the findings reader reads has no row in WRITERS, or a row names no baseline",
  );
  // The runtime tests above run BASELINE_WRITERS; a writer listed here and
  // not there would be held to its import and never run.
  assert.deepEqual(
    Object.values(WRITERS).filter((w) => w.script && !w.exception).map((w) =>
      w.script.split("/").pop()
    ).sort(),
    BASELINE_WRITERS.map((w) => w.script).sort(),
    "WRITERS and BASELINE_WRITERS disagree about which writers merge through the helper",
  );
  for (const w of Object.values(WRITERS)) {
    if (w.none) continue;
    const src = codeOnly(readFileSync(join(REPO, w.script), "utf8"));
    if (w.exception) {
      assert.ok(
        !/baseline-merge\.mjs/.test(src),
        `${w.script} now imports the helper; drop its exception`,
      );
      continue;
    }
    // The helper's read and merge, imported by name and called, with no
    // local stand-in: importing the module for its summary while reading or
    // merging some other way would pass a check on the import line alone.
    for (const fn of ["readExistingRows", "mergeBaselineRows"]) {
      assert.match(
        src,
        new RegExp(`import\\s*\\{[^}]*\\b${fn}\\b[^}]*\\}\\s*from "\\./lib/baseline-merge\\.mjs"`),
        `${w.script} does not import ${fn} from the helper`,
      );
      assert.match(src, new RegExp(`\\b${fn}\\(`), `${w.script} never calls ${fn}`);
      assert.doesNotMatch(
        src,
        new RegExp(`\\b(const|let|var|function)\\s+${fn}\\b`),
        `${w.script} defines its own ${fn}`,
      );
    }
  }
  // Any other script that names a baseline and writes or moves a file is a
  // second writer the registry does not know.
  const registered = new Set(Object.values(WRITERS).flatMap((w) => (w.script ? [w.script] : [])));
  const WRITE =
    /\b(writeFileSync|writeFile|writeSync|createWriteStream|appendFileSync|appendFile|renameSync|rename|copyFileSync|copyFile|cpSync)\b/;
  const strays = [...scriptFiles("barwise/scripts"), ...scriptFiles("barwise/trial/lib")].filter(
    (rel) => {
      if (registered.has(rel)) return false;
      const src = codeOnly(readFileSync(join(REPO, rel), "utf8"));
      return WRITE.test(src)
        && (Object.keys(WRITERS).some((b) => src.includes(b)) || /\bBASELINE_PATH\b/.test(src));
    },
  );
  assert.deepEqual(strays, [], "these scripts write a baseline outside the registry");
});

test("audit-duplication.mjs still has no baseline writer [adr:baselines-merge-on-write#duplication-no-writer]", () => {
  // docs/adr/baselines-merge-on-write.md (decision 5) and
  // baseline-write-preserves-verdicts.spec.md both say this gate
  // never had the clobber defect BECAUSE it has no writer -- its 48 candidates
  // are hand-maintained. That is a claim about code, so it is checked here
  // rather than asserted in prose: adding a writer to this script would make
  // both documents quietly false, and would reintroduce exactly the hazard the
  // other three just had removed.
  const src = readFileSync(join(SCRIPTS, "audit-duplication.mjs"), "utf8");
  assert.ok(
    !src.includes("writeFileSync"),
    "audit-duplication.mjs gained a writer. If that is deliberate, route it "
      + "through scripts/lib/baseline-merge.mjs and update both documents.",
  );
});
