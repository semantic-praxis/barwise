/**
 * Gate tests: check:architecture's ADR shape, references and Enforced-by: declarations.
 *
 * Split from gates.test.mjs (barwise-bbt) so the gate tests run in parallel;
 * why these tests exist at all is the header of gates-helpers.mjs.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  architectureRepo,
  archPlanted,
  CLAUDE_LLM,
  REPO,
  runArch,
  SCRIPTS,
  stage,
} from "./gates-helpers.mjs";

// --- check:architecture, WS2: ADR shape and references ---

/** regen:architecture run against a fixture tree. */
const regenArch = (dir) =>
  spawnSync(process.execPath, [join(SCRIPTS, "regen-architecture.mjs"), "--root", dir], {
    encoding: "utf8",
  });

/**
 * Stage an ADR in an architectureRepo fixture and regenerate and stage the
 * fixture's ARCHITECTURE.md section, as an author does after adding one --
 * otherwise every such test also reads "stale". It runs the real
 * regenerator, so these tests also see it agree with the check.
 */
function stageAdr(dir, name, text) {
  stage(dir, `barwise/docs/adr/${name}.md`, text);
  const r = regenArch(dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const doc = join(dir, "barwise", "docs", "ARCHITECTURE.md");
  stage(dir, "barwise/docs/ARCHITECTURE.md", readFileSync(doc, "utf8"));
}

const ADR_OK = "# A concern\n\nScope: process\nDate: 2026-10-24\nTracking: barwise-ubc\n"
  + "Enforced-by: tests (the-rule)\n\n"
  + "## Context\n\nWhy.\n\n## Decision\n\n1. **The rule.** {#the-rule} It holds.\n\n"
  + "## Consequences\n\nWhat follows.\n";

test("check:architecture checks each ADR's shape", () => {
  const { dir } = architectureRepo();
  try {
    stageAdr(dir, "a-concern", ADR_OK);
    execFileSync("git", ["commit", "-qm", "adr"], { cwd: dir });
    const ok = runArch(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    const ADR = "barwise/docs/adr/a-concern.md";
    for (
      const [edit, why] of [
        [(s) => s.replace("Scope: process\n", ""), /a-concern\.md: no Scope: line/],
        [
          (s) => s.replace("Scope: process", "Scope: policy"),
          /a-concern\.md: Scope: policy is not one of architecture, process/,
        ],
        [(s) => s.replace("Date: 2026-10-24\n", ""), /a-concern\.md: no Date: line/],
        [(s) => s.replace("## Decision", "## The rule"), /a-concern\.md: no "## Decision" section/],
        [(s) => s.replace("# A concern\n", ""), /a-concern\.md: no "# " title line/],
        // A field in the body is not the ADR's own.
        [
          (s) => s.replace("Scope: process\n", "").replace("Why.", "Scope: process"),
          /no Scope: line/,
        ],
      ]
    ) {
      const r = archPlanted(dir, ADR, edit);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, why);
    }
    // A README in the directory is not an ADR.
    stage(dir, "barwise/docs/adr/README.md", "# ADRs\n\nAn index.\n");
    const readme = runArch(dir);
    assert.equal(readme.status, 0, readme.stdout + readme.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// A package CLAUDE.md that states no internal dependency, as core's does:
// a stub in these tests must keep it, or the table check reports the stub.
const CORE_DEPS =
  "\n## Dependencies\n\n| Direction | Package | What is used |\n| --- | --- | --- |\n| Upstream | none | x |\n";

test("check:architecture resolves each ADR reference in the files that act on it", () => {
  const { dir } = architectureRepo();
  try {
    stageAdr(dir, "a-concern", ADR_OK);
    // Live references in both forms, from each kind of citing file.
    stage(dir, "barwise/packages/core/CLAUDE.md", `See ADR \`a-concern\`.\n${CORE_DEPS}`);
    stage(dir, "barwise/packages/core/src/x.ts", "// docs/adr/a-concern.md\n");
    // A spec may cite an ADR it plans as a `+` Touches: entry.
    stage(
      dir,
      "barwise/docs/specs/p.spec.md",
      "# P\n\nStatus: Draft\nTouches: +barwise/docs/adr/planned.md\n\n## Body\n\nADR `planned`.\n",
    );
    // History is not read: the tracker, an archived spec, a dated record,
    // and a number, which is not a form at all.
    stage(
      dir,
      ".beads/issues.jsonl",
      (existsSync(join(dir, ".beads/issues.jsonl"))
        ? readFileSync(join(dir, ".beads/issues.jsonl"), "utf8")
        : "")
        + '{"id":"barwise-h1","d":"ADR `gone`"}\n',
    );
    stage(dir, "barwise/docs/specs/archive/old.spec.md", "# O\n\nADR `gone`\n");
    stage(dir, "barwise/docs/review-2026-08-27.md", "docs/adr/gone.md\n");
    stage(
      dir,
      "barwise/packages/core/CLAUDE.md",
      `See ADR \`a-concern\`. ADR 0001 too.\n${CORE_DEPS}`,
    );
    execFileSync("git", ["commit", "-qm", "refs"], { cwd: dir });
    const ok = runArch(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    for (
      const [file, edit, why] of [
        [
          "barwise/packages/core/CLAUDE.md",
          (s) => s.replace("ADR `a-concern`", "ADR `a-concrn`"),
          /packages\/core\/CLAUDE\.md:1: names ADR a-concrn, and barwise\/docs\/adr\/a-concrn\.md does not exist/,
        ],
        [
          "barwise/packages/core/src/x.ts",
          (s) => s.replace("a-concern.md", "moved.md"),
          /core\/src\/x\.ts:1: names ADR moved/,
        ],
        // The `+` entry is the spec's own: without it the planned name is dead.
        [
          "barwise/docs/specs/p.spec.md",
          (s) => s.replace("+barwise/docs/adr/planned.md", "+barwise/x.ts"),
          /p\.spec\.md:8: names ADR planned/,
        ],
        // An ADR may cite another, and a retired one is dead there too.
        [
          "barwise/docs/adr/a-concern.md",
          (s) => s.replace("The rule.", "See ADR `retired`."),
          /a-concern\.md:\d+: names ADR retired/,
        ],
      ]
    ) {
      const r = archPlanted(dir, file, edit);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, why);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture resolves each decision citation to a decision id its ADR has", () => {
  const { dir } = architectureRepo();
  try {
    stageAdr(dir, "a-concern", ADR_OK);
    // Both citation forms, a bare name for some other document's anchor
    // (not an ADR, so not read), and a spec citing a decision of an ADR its
    // own Touches: creates, which the check leaves to that PR.
    stage(
      dir,
      "barwise/docs/guide.md",
      "Held by docs/adr/a-concern.md#the-rule, and a-concern.md#the-rule.\n"
        + "See README.md#install for setup, docs/adr/a-concern.md#consequences\n"
        + "for what follows, and notes/a-concern.md#intro, another file.\n",
    );
    stage(
      dir,
      "barwise/docs/specs/p.spec.md",
      "# P\n\nStatus: Draft\nTouches: +barwise/docs/adr/planned.md\n\n## Body\n\nplanned.md#new-rule\n",
    );
    stage(dir, "barwise/scripts/s.mjs", "// Held by docs/adr/a-concern.md#the-rule.\n");
    execFileSync("git", ["commit", "-qm", "cites"], { cwd: dir });
    const ok = runArch(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    for (
      const [file, edit, why] of [
        // A retirement renumbers; an id it removed is a dead citation, in
        // either form.
        [
          "barwise/docs/guide.md",
          (s) => s.replace("docs/adr/a-concern.md#the-rule", "docs/adr/a-concern.md#gone-rule"),
          /guide\.md:1: cites docs\/adr\/a-concern\.md#gone-rule, and a-concern has no decision \{#gone-rule\}/,
        ],
        [
          "barwise/docs/guide.md",
          (s) => s.replace(", and a-concern.md#the-rule", ", and a-concern.md#gone-rule"),
          /guide\.md:1: cites a-concern\.md#gone-rule, and a-concern has no decision/,
        ],
        // An ADR citing a decision of its own by an id it does not have.
        [
          "barwise/docs/adr/a-concern.md",
          (s) => s.replace("It holds.", "It holds; see a-concern.md#no-such."),
          /a-concern\.md:\d+: cites a-concern\.md#no-such/,
        ],
        // A script comment is read too.
        [
          "barwise/scripts/s.mjs",
          (s) => s.replace("#the-rule", "#gone-rule"),
          /scripts\/s\.mjs:1: cites docs\/adr\/a-concern\.md#gone-rule/,
        ],
      ]
    ) {
      const r = archPlanted(dir, file, edit);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, why);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture reads wrapped, retiring and doc references, and skips a deleted file", () => {
  const { dir } = architectureRepo();
  try {
    stageAdr(dir, "a-concern", ADR_OK);
    // A spec retiring an ADR names it in its own `-` Touches: entry.
    stage(
      dir,
      "barwise/docs/specs/r.spec.md",
      "# R\n\nStatus: Draft\nTouches: -barwise/docs/adr/retiring.md\n\n## Body\n\nRetires ADR `retiring`.\n",
    );
    // An undated doc and an evals file act on decisions too.
    stage(dir, "barwise/docs/guide.md", "See ADR\n`a-concern`.\n");
    // Not references: a word ending in ADR, a blank line between, and
    // package history (an eval run, a dated file).
    stage(dir, "barwise/docs/notes.md", "MADR `gone`. See the ADR\n\n`gone` too.\n");
    stage(dir, "barwise/packages/core/eval-runs/r.json", '"docs/adr/gone.md"\n');
    stage(dir, "barwise/packages/core/evals/2026-01-01.yaml", "# docs/adr/gone.md\n");
    stage(dir, "barwise/packages/core/evals/suite.yaml", "# docs/adr/a-concern.md\n");
    stage(dir, "barwise/packages/core/src/y.ts", "// See ADR\n// `a-concern`\n");
    execFileSync("git", ["commit", "-qm", "refs"], { cwd: dir });
    const ok = runArch(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    for (
      const [file, edit, why] of [
        // A reference split by a reflow is still read, at its first line.
        [
          "barwise/docs/guide.md",
          (s) => s.replace("`a-concern`", "`a-concrn`"),
          /guide\.md:1: names ADR a-concrn/,
        ],
        [
          "barwise/packages/core/src/y.ts",
          (s) => s.replace("a-concern", "gone"),
          /core\/src\/y\.ts:1: names ADR gone/,
        ],
        [
          "barwise/packages/core/evals/suite.yaml",
          (s) => s.replace("a-concern", "gone"),
          /evals\/suite\.yaml:1: names ADR gone/,
        ],
        [
          "barwise/docs/specs/r.spec.md",
          (s) => s.replace("-barwise/docs/adr/retiring.md", "-barwise/x.ts"),
          /r\.spec\.md:8: names ADR retiring/,
        ],
        [
          "barwise/docs/adr/a-concern.md",
          (s) => s.replace("2026-10-24", "<YYYY-MM-DD>"),
          /a-concern\.md: Date: <YYYY-MM-DD> is not YYYY-MM-DD/,
        ],
      ]
    ) {
      const r = archPlanted(dir, file, edit);
      assert.equal(r.status, 1, r.stdout + r.stderr);
      assert.match(r.stderr, why);
    }
    // A graph disagreement and an ADR problem are both reported in one run.
    const both = archPlanted(
      dir,
      "barwise/docs/guide.md",
      (s) => s.replace("`a-concern`", "`nope`"),
    );
    assert.equal(both.status, 1);
    const path = join(dir, "CLAUDE.md");
    const before = readFileSync(path, "utf8");
    writeFileSync(path, before.replace(CLAUDE_LLM, "@barwise/llm             (core, diagram)"));
    writeFileSync(join(dir, "barwise/docs/guide.md"), "See ADR `nope`.\n");
    const r = runArch(dir);
    writeFileSync(path, before);
    writeFileSync(join(dir, "barwise/docs/guide.md"), "See ADR\n`a-concern`.\n");
    assert.equal(r.status, 1, r.stderr);
    assert.match(r.stderr, /draws llm -> diagram/);
    assert.match(r.stderr, /guide\.md:1: names ADR nope/);
    // An ADR written but not yet staged is not in the tree CI checks: a
    // reference to it fails, and the run names the file as unchecked.
    writeFileSync(join(dir, "barwise/docs/adr/unstaged.md"), ADR_OK);
    writeFileSync(join(dir, "barwise/docs/guide.md"), "See ADR\n`unstaged`.\n");
    const unstaged = runArch(dir);
    assert.equal(unstaged.status, 1, unstaged.stdout + unstaged.stderr);
    assert.match(unstaged.stdout, /unchecked \(untracked\): barwise\/docs\/adr\/unstaged\.md/);
    assert.match(unstaged.stderr, /guide\.md:1: names ADR unstaged/);
    writeFileSync(join(dir, "barwise/docs/guide.md"), "See ADR\n`a-concern`.\n");
    rmSync(join(dir, "barwise/docs/adr/unstaged.md"));
    // A tracked file deleted from disk is one being removed: it is skipped,
    // and the references it leaves dead are reported, not a refusal.
    rmSync(join(dir, "barwise/docs/adr/a-concern.md"));
    const gone = runArch(dir);
    assert.equal(gone.status, 1, gone.stdout + gone.stderr);
    assert.match(gone.stderr, /guide\.md:1: names ADR a-concern/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture passes the real tree from any working directory", () => {
  // No --root: the list and the files read must be one tree, whatever the cwd.
  for (const cwd of [REPO, tmpdir()]) {
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-architecture.mjs")], {
      cwd,
      encoding: "utf8",
    });
    assert.equal(r.status, 0, `${cwd}: ${r.stdout}${r.stderr}`);
  }
});

test("check:architecture fails a stale generated section, and regen:architecture refreshes it", () => {
  const { dir } = architectureRepo();
  try {
    // A new ADR staged without regenerating: the index no longer lists it.
    stage(dir, "barwise/docs/adr/a-concern.md", ADR_OK);
    const stale = runArch(dir);
    assert.equal(stale.status, 1, stale.stdout + stale.stderr);
    assert.match(
      stale.stderr,
      /generated section of barwise\/docs\/ARCHITECTURE\.md is stale .*run npm run regen:architecture/,
    );
    // Not reported as an ADR problem: an INTENDED edit makes it stale too.
    assert.doesNotMatch(stale.stderr, /ADR problem/);
    // A dollar sign in a title is text, not a replacement pattern.
    stage(
      dir,
      "barwise/docs/adr/b-cost.md",
      ADR_OK.replace("# A concern", () => "# Costs in $& terms"),
    );
    const regen = regenArch(dir);
    assert.equal(regen.status, 0, regen.stdout + regen.stderr);
    assert.match(regen.stdout, /wrote the generated section/);
    const doc = readFileSync(join(dir, "barwise", "docs", "ARCHITECTURE.md"), "utf8");
    assert.match(doc, /- \[A concern\]\(adr\/a-concern\.md\) -- 2026-10-24/);
    assert.ok(doc.includes("- [Costs in $& terms](adr/b-cost.md) -- 2026-10-24"), doc);
    stage(dir, "barwise/docs/ARCHITECTURE.md", doc);
    const fresh = runArch(dir);
    assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
    // Run again, it writes nothing.
    assert.match(regenArch(dir).stdout, /already current/);
    // An ADR on disk but untracked is one the check does not list, so the
    // regenerator must not index it either: otherwise the check reads
    // "stale" and no regen run can make it current.
    writeFileSync(join(dir, "barwise", "docs", "adr", "draft.md"), ADR_OK);
    assert.match(regenArch(dir).stdout, /already current/);
    const still = runArch(dir);
    assert.equal(still.status, 0, still.stdout + still.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture and regen:architecture refuse without the section's markers", () => {
  const { dir } = architectureRepo();
  try {
    const doc = join(dir, "barwise", "docs", "ARCHITECTURE.md");
    // The fixture's own document: its section renders the fixture's ADRs,
    // whose Enforced-by: headers architectureRepo() rewrote.
    const original = readFileSync(doc, "utf8");
    stage(
      dir,
      "barwise/docs/ARCHITECTURE.md",
      original.replace("<!-- END regen:architecture -->", ""),
    );
    const check = runArch(dir);
    assert.equal(check.status, 2, check.stdout + check.stderr);
    assert.match(check.stderr, /ARCHITECTURE\.md has no regen:architecture markers/);
    const regen = regenArch(dir);
    assert.equal(regen.status, 2, regen.stdout + regen.stderr);
    assert.match(regen.stderr, /no regen:architecture markers/);
    // Prose quoting the END marker above the section does not hide it.
    const quoted = original
      .replace(
        "**Last Updated:**",
        "Ends at `<!-- END regen:architecture -->`.\n\n**Last Updated:**",
      );
    stage(dir, "barwise/docs/ARCHITECTURE.md", quoted);
    const q = runArch(dir);
    assert.equal(q.status, 0, q.stdout + q.stderr);
    // A misshapen INTENDED is refused, not rendered as an empty graph.
    stage(dir, "barwise/scripts/lib/intended.cjs", "module.exports = {};\n");
    const empty = regenArch(dir);
    assert.equal(empty.status, 2, empty.stdout + empty.stderr);
    assert.match(empty.stderr, /does not export a map of package to package list/);
    // A bare --root is "could not answer" too.
    const bare = spawnSync(process.execPath, [join(SCRIPTS, "regen-architecture.mjs"), "--root"], {
      encoding: "utf8",
    });
    assert.equal(bare.status, 2, bare.stdout + bare.stderr);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture cannot answer with no ADR to check", () => {
  const { dir } = architectureRepo();
  try {
    execFileSync("git", ["rm", "-rq", "barwise/docs/adr"], { cwd: dir });
    const r = runArch(dir);
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /cannot answer -- no ADR under/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// --- check:architecture, executable ADRs WS1: Enforced-by: declarations ---

/**
 * An ADR declaring all four entry kinds over four decisions, one of whose
 * bold titles wraps, beside the inputs those entries read: a ci.yml whose
 * steps are the gates, the root scripts, and a tracker with an open and a
 * closed issue. Each case below breaks one thing and expects one finding,
 * or one refusal, from the real check.
 */
const ENFORCED_ADR = "# A concern\n\nScope: process\nDate: 2026-10-24\nTracking: barwise-ubc\n"
  + "Enforced-by: npm run check:x (one), npm run audit:y -- --check (two),\n"
  + "tests (three), none (barwise-gap2: two), none (barwise-gap: four)\n\n"
  + "## Context\n\nWhy.\n\n## Decision\n\n"
  + "1. **One.** {#one} The first rule.\n"
  + "2. **Two, whose title\n   wraps.** {#two} The second.\n"
  + "3. **Three.** {#three} The third.\n"
  + "4. **Four.** {#four} The fourth.\n\n"
  + "## Consequences\n\nWhat follows.\n";
const ENFORCED_CI = "name: CI\non: push\njobs:\n  ci:\n    runs-on: ubuntu-latest\n"
  + "    defaults:\n      run:\n        working-directory: barwise\n    steps:\n"
  + "      - uses: actions/checkout@v7\n"
  + "      - run: npm run check:x\n"
  + "      - run: npm run audit:y -- --check\n"
  + "        if: steps.changes.outputs.docs_only != 'true'\n";
const ENFORCED_ROOT_PKG = JSON.stringify({
  scripts: {
    "check:x": "node scripts/x.mjs",
    "audit:y": "node scripts/y.mjs",
    lint: "turbo run lint",
    "check:adr-tests": "node scripts/check-adr-tests.mjs",
  },
});
const ENFORCED_TRACKER =
  '{"id":"barwise-gap","status":"open","title":"Gap: a-concern decision four has no enforcer","labels":["adr-gap"]}\n'
  + '{"id":"barwise-gap2","status":"open","title":"Gap: a-concern decision two is partly held","labels":["adr-gap"]}\n'
  + '{"id":"barwise-shut","status":"closed","title":"s"}\n';
const TRACKER_PATH = ".beads/issues.jsonl";

function enforcementRepo() {
  const fixture = architectureRepo();
  const { dir } = fixture;
  stageAdr(dir, "a-concern", ENFORCED_ADR);
  stage(dir, ".github/workflows/ci.yml", ENFORCED_CI);
  stage(dir, "barwise/package.json", ENFORCED_ROOT_PKG);
  stage(dir, ".beads/issues.jsonl", ENFORCED_TRACKER);
  execFileSync("git", ["commit", "-qm", "enforced"], { cwd: dir });
  return fixture;
}
const ENFORCED_PATH = "barwise/docs/adr/a-concern.md";
const CI_PATH = ".github/workflows/ci.yml";

test("check:architecture accepts every entry kind when each decision is accounted for", () => {
  const { dir, decisions } = enforcementRepo();
  try {
    const ok = runArch(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    // The copied real ADRs declare every decision tested; this fixture's
    // own four are two gates, one tested, one none only, and two carry a
    // gap issue: four, and two beside its gate, since the gap count
    // overlaps the others (enforceable-adr-practice WS2's breakdown).
    assert.match(
      ok.stdout,
      new RegExp(
        `; ${decisions + 4} decisions: 2 with a gate, ${decisions + 1} tests and no gate,`
          + " 1 none only; 2 carry a gap issue\\. OK",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture names each broken Enforced-by: declaration, exit 1", () => {
  const { dir } = enforcementRepo();
  try {
    for (
      const [rel, edit, why] of [
        // Decision ids.
        [
          ENFORCED_PATH,
          (s) => s.replace(" {#three}", ""),
          /decision 3 \(line \d+\) has no \{#id\}/,
        ],
        [
          ENFORCED_PATH,
          (s) => s.replace("{#four}", "{#one}"),
          /decisions 1 and 4 share the id one/,
        ],
        // The header's own form.
        [ENFORCED_PATH, (s) => s.replace("(one),", "(one)"), /is not an entry/],
        [
          ENFORCED_PATH,
          (s) => s.replace("(barwise-gap: four)", "(barwise-gap: four"),
          /unclosed "\("/,
        ],
        [
          ENFORCED_PATH,
          (s) => s.replace("four)\n\n", "four)\nOwner: someone\n\n"),
          /Enforced-by: is not the last header field \(Owner follows it\)/,
        ],
        [
          ENFORCED_PATH,
          (s) => s.replace(/Enforced-by:[^]*?four\)\n/, "Enforced-by:\n"),
          /Enforced-by: declares nothing/,
        ],
        // Gate entries.
        [ENFORCED_PATH, (s) => s.replace("check:x (one)", "lint (one)"), /lint is not a gate name/],
        [
          ENFORCED_PATH,
          (s) => s.replace("check:x (one)", "check:adr-tests (one)"),
          /check:adr-tests checks other gates and cannot vouch/,
        ],
        [
          CI_PATH,
          (s) => s.replace("run: npm run check:x", "run: npm run --silent check:x"),
          /no ci\.yml step's run: is exactly "npm run check:x"/,
        ],
        // The arguments are part of the match: without them the audit never fails CI.
        [
          CI_PATH,
          (s) => s.replace("audit:y -- --check", "audit:y"),
          /no ci\.yml step's run: is exactly "npm run audit:y -- --check"/,
        ],
        [
          CI_PATH,
          (s) => s.replace("!= 'true'", "== 'true'"),
          /a guard that does not run it on every code change/,
        ],
        [
          CI_PATH,
          (s) => s.replace("docs_only != 'true'", "optimizer == 'true'"),
          /a guard that does not run it on every code change/,
        ],
        [
          CI_PATH,
          (s) =>
            s.replace("npm run check:x\n", "npm run check:x\n        continue-on-error: true\n"),
          /"npm run check:x" is continue-on-error/,
        ],
        [
          CI_PATH,
          (s) => s.replace("    runs-on:", "    continue-on-error: true\n    runs-on:"),
          /is continue-on-error, so it cannot fail CI/,
        ],
        [
          CI_PATH,
          (s) =>
            s.replace(
              "npm run check:x\n",
              "npm run check:x\n        working-directory: barwise/packages/core\n",
            ),
          /"npm run check:x" does not run in barwise\//,
        ],
        // A gap issue is the decision's own (enforceable-adr-practice, WS3).
        [
          TRACKER_PATH,
          (s) => s.replace(',"labels":["adr-gap"]', ""),
          /barwise-gap does not carry the adr-gap label/,
        ],
        [
          TRACKER_PATH,
          (s) => s.replace("decision four has", "decision three has"),
          /barwise-gap's title does not begin "Gap: a-concern decision four "/,
        ],
        [
          ENFORCED_PATH,
          (s) => s.replace("none (barwise-gap: four)", "none (barwise-gap: three, four)"),
          /"none \(barwise-gap: three, four\)": lists 2 decisions; a none entry names one/,
        ],
        [
          ENFORCED_PATH,
          (s) => s.replace("tests (three)", "none (barwise-gap: three)"),
          /"none \(barwise-gap: four\)": barwise-gap is also named by .*a-concern\.md: "none \(barwise-gap: three\)"/,
        ],
      ]
    ) {
      const r = archPlanted(dir, rel, edit);
      assert.equal(r.status, 1, `${why}\n${r.stdout}${r.stderr}`);
      assert.match(r.stderr, why);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// The five fact rules are check:adr-model's (adr-conformance-model.spec.md,
// WS4): check:architecture reports none of them, and where one cut a
// verdict rule short it still stops there, silently, so one defect fails
// one gate. Each plant below is a finding of check:adr-model's
// (adr-model.test.mjs) and none of check:architecture's.
test("check:architecture leaves the five fact rules to check:adr-model, and its guards silent", () => {
  const { dir } = enforcementRepo();
  try {
    for (
      const [edit, silentOn] of [
        // ids-exist.
        [(s) => s.replace("tests (three)", "tests (thre)"), /thre/],
        // coverage: decision three keeps no entry, and the OK line names it.
        [(s) => s.replace("\ntests (three), ", "\n"), /decision 3/],
        // script-exists: and no step is looked up for the missing script.
        [(s) => s.replace("check:x (one)", "check:nope (one)"), /check:nope/],
        // issue-tracked and issue-open: and no label or title finding.
        [(s) => s.replace("barwise-gap:", "barwise-nil:"), /barwise-nil/],
        [(s) => s.replace("barwise-gap:", "barwise-shut:"), /barwise-shut/],
        // ids-exist on a none entry: not also a title finding for the id.
        [(s) => s.replace("(barwise-gap: four)", "(barwise-gap: fourr)"), /fourr/],
      ]
    ) {
      // Staged with the generated section regenerated, so the header
      // change is not itself a finding (a stale index).
      stageAdr(dir, "a-concern", edit(ENFORCED_ADR));
      const r = runArch(dir);
      assert.equal(r.status, 0, `${silentOn}\n${r.stdout}${r.stderr}`);
      assert.doesNotMatch(r.stdout + r.stderr, silentOn);
      if (String(silentOn) === String(/decision 3/)) {
        assert.match(r.stdout, /; 1 with no entry, which check:adr-model reports\. OK/);
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture refuses, exit 2, only where it cannot tell, and lists it beside findings", () => {
  const { dir } = enforcementRepo();
  try {
    const unknownGuard = (s) =>
      s.replace("steps.changes.outputs.docs_only != 'true'", "github.ref == 'refs/heads/main'");
    const refused = archPlanted(dir, CI_PATH, unknownGuard);
    assert.equal(refused.status, 2, refused.stdout + refused.stderr);
    // A gate switched off with `if: false` must not keep counting as an
    // enforcer; the check cannot evaluate the form, so it refuses.
    const off = archPlanted(
      dir,
      CI_PATH,
      (s) => s.replace("steps.changes.outputs.docs_only != 'true'", "false"),
    );
    assert.equal(off.status, 2, off.stdout + off.stderr);
    assert.match(off.stderr, /audit:y -- --check.*if: false/);
    assert.match(
      refused.stderr,
      /cannot answer for 1 declaration.*\n.*audit:y -- --check.*if: github\.ref/,
    );
    const expression = archPlanted(
      dir,
      CI_PATH,
      (s) =>
        s.replace(
          "npm run check:x\n",
          "npm run check:x\n        continue-on-error: ${{ matrix.x }}\n",
        ),
    );
    assert.equal(expression.status, 2, expression.stdout + expression.stderr);
    assert.match(expression.stderr, /"npm run check:x \(one\)".*continue-on-error/);
    // One occurrence never runs on a code change and one cannot be read:
    // the unreadable one might qualify, so the answer is a refusal, not a
    // finding (barwise-ym8.7jz review of e247c807).
    const mixed = archPlanted(
      dir,
      CI_PATH,
      (s) =>
        s.replace("!= 'true'", "== 'true'")
        + "      - run: npm run audit:y -- --check\n        if: github.ref == 'refs/heads/main'\n",
    );
    assert.equal(mixed.status, 2, mixed.stdout + mixed.stderr);
    // An expression continue-on-error on a step whose guard never runs it
    // on a code change cannot qualify either way: a finding, not a refusal.
    const never = archPlanted(
      dir,
      CI_PATH,
      (s) =>
        s.replace("!= 'true'", "== 'true'").replace(
          "audit:y -- --check\n",
          "audit:y -- --check\n        continue-on-error: ${{ matrix.x }}\n",
        ),
    );
    assert.equal(never.status, 1, never.stdout + never.stderr);
    assert.match(never.stderr, /a guard that does not run it on every code change/);
    // A finding with a refusal beside it is exit 1, and both are listed.
    writeFileSync(join(dir, CI_PATH), unknownGuard(ENFORCED_CI));
    const both = archPlanted(dir, ENFORCED_PATH, (s) => s.replace("check:x (one)", "lint (one)"));
    assert.equal(both.status, 1, both.stdout + both.stderr);
    assert.match(both.stderr, /lint is not a gate name/);
    assert.match(both.stderr, /cannot answer for 1 declaration/);
    writeFileSync(join(dir, CI_PATH), ENFORCED_CI);
    // An input the entries need and cannot read.
    rmSync(join(dir, ".beads", "issues.jsonl"));
    const noTracker = runArch(dir);
    assert.equal(noTracker.status, 2, noTracker.stdout + noTracker.stderr);
    assert.match(noTracker.stderr, /\.beads\/issues\.jsonl: ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture: an unreadable root scripts file or ci.yml is a refusal, listed in the order the entries reach them", () => {
  // Characterizes the declaration pass before its reads move into
  // scripts/lib/adr-facts.mjs (adr-gate-reader-split.spec.md): what each
  // unreadable input does, and the order the refusals are listed in.
  const { dir } = enforcementRepo();
  try {
    const pkg = join(dir, "barwise", "package.json");
    const ci = join(dir, CI_PATH);
    // Scripts unreadable: no "has no script" finding, and the step check
    // still runs (both gates qualify), so the answer is a refusal alone.
    writeFileSync(pkg, "{ not json");
    const noScripts = runArch(dir);
    assert.equal(noScripts.status, 2, noScripts.stdout + noScripts.stderr);
    assert.match(
      noScripts.stderr,
      /cannot answer for 1 declaration\(s\):\n\s+barwise\/package\.json: /,
    );
    assert.doesNotMatch(noScripts.stderr, /has no script/);
    writeFileSync(pkg, ENFORCED_ROOT_PKG);
    // ci.yml unreadable: no "no ci.yml step" finding, a refusal alone.
    rmSync(ci);
    const noCi = runArch(dir);
    assert.equal(noCi.status, 2, noCi.stdout + noCi.stderr);
    assert.match(noCi.stderr, /\.github\/workflows\/ci\.yml: ENOENT/);
    assert.doesNotMatch(noCi.stderr, /no ci\.yml step/);
    // Both unreadable: the scripts refusal first, as the first npm entry
    // asks for the scripts before the steps.
    writeFileSync(pkg, "{ not json");
    const neither = runArch(dir);
    assert.equal(neither.status, 2, neither.stdout + neither.stderr);
    assert.match(
      neither.stderr,
      /cannot answer for 2 declaration\(s\):\n\s+barwise\/package\.json: .*\n\s+\.github\/workflows\/ci\.yml: ENOENT/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("check:architecture requires Enforced-by:, and reads no ci.yml, scripts or tracker no entry needs", () => {
  // The fixture has no ci.yml, root package.json or tracker, and every ADR
  // in it declares `tests` only, which needs none of them, so none is a
  // refusal.
  const { dir, decisions } = architectureRepo();
  try {
    assert.ok(!existsSync(join(dir, ".beads/issues.jsonl")), "the fixture must carry no tracker");
    stageAdr(dir, "a-concern", ADR_OK);
    execFileSync("git", ["commit", "-qm", "adr"], { cwd: dir });
    const ok = runArch(dir);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr);
    assert.match(
      ok.stdout,
      new RegExp(
        `; ${decisions + 1} decisions: 0 with a gate, ${decisions + 1} tests and no gate,`
          + " 0 none only; 0 carry a gap issue\\. OK",
      ),
    );
    // An ADR without the header is a finding naming it, not a skip.
    const bare = archPlanted(
      dir,
      "barwise/docs/adr/a-concern.md",
      (s) => s.replace("Enforced-by: tests (the-rule)\n", ""),
    );
    assert.equal(bare.status, 1, bare.stdout + bare.stderr);
    assert.match(bare.stderr, /a-concern\.md: no Enforced-by: header/);
    // One decision per none entry and one entry per gap issue need no
    // tracker, so they are findings here, beside the tracker's refusal.
    const shared = archPlanted(
      dir,
      "barwise/docs/adr/a-concern.md",
      (s) =>
        s.replace(
          "Enforced-by: tests (the-rule)",
          "Enforced-by: none (barwise-g: the-rule, x), none (barwise-g: the-rule)",
        ),
    );
    assert.equal(shared.status, 1, shared.stdout + shared.stderr);
    assert.match(shared.stderr, /"none \(barwise-g: the-rule, x\)": lists 2 decisions/);
    assert.match(shared.stderr, /"none \(barwise-g: the-rule\)": barwise-g is also named by/);
    assert.match(
      shared.stderr,
      /\.beads\/issues\.jsonl: /,
      "the tracker it could not read is a refusal",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
