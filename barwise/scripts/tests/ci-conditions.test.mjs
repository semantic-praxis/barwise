/**
 * `ci:local` runs the gates CI runs for a change, not every gate CI has
 * (barwise-954, docs/specs/ci-local-condition-parity.spec.md).
 *
 * Three layers, tested apart because each fails differently:
 *
 *   - `classify`, shared with ci.yml's detect step. A wrong answer here is a
 *     CI bug too, so the boundary the shell guarded (an empty diff is NOT
 *     docs-only) is pinned.
 *   - `shouldRun`, which must run any gate whose `if:` it cannot read. A
 *     test that only ever saw recognised conditions could not show that.
 *   - `ciSteps`, which must read an `if:` written before its `run:` as well
 *     as after. Before-run is how `test:optimizer` is written; a forward
 *     scan would read it as unguarded, which is the SAFE direction -- so it
 *     is pinned here rather than left for nothing to notice.
 *
 * The end-to-end cases run the real `ci-local.mjs --list` inside a
 * throwaway repository and derive their expected counts from the real
 * ci.yml, so adding a gate does not break them and a classifier that
 * silently matches nothing does.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { classify } from "../lib/changed-class.mjs";
import { ciSteps, shouldRun, WORKFLOW } from "../lib/ci-gates.mjs";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("classify: an empty change is not docs-only, as the shell's [ -n ] guard had it", () => {
  assert.deepEqual(classify([]), { docsOnly: false, optimizer: false });
});

test("classify: Markdown and .beads/ only is docs-only; one source file is not", () => {
  assert.equal(classify(["README.md", ".beads/issues.jsonl"]).docsOnly, true);
  assert.equal(classify(["README.md", "barwise/packages/core/src/x.ts"]).docsOnly, false);
  // A .md suffix is required, not a .md substring.
  assert.equal(classify(["notes.md.bak"]).docsOnly, false);
});

test("classify: optimizer fires on the lane or the CLI it shells out to, and nothing else", () => {
  assert.equal(classify(["barwise/optimizer/CLAUDE.md"]).optimizer, true);
  assert.equal(classify(["barwise/packages/cli/src/index.ts"]).optimizer, true);
  assert.equal(classify(["barwise/packages/core/src/x.ts"]).optimizer, false);
  // Anchored at the repo root: a nested path with the same name is not it.
  assert.equal(classify(["docs/barwise/optimizer/x.md"]).optimizer, false);
});

const DOCS = { docsOnly: true, optimizer: false };
const CODE = { docsOnly: false, optimizer: false };
const CLI = { docsOnly: false, optimizer: true };
const OPT_DOCS = { docsOnly: true, optimizer: true };

test("shouldRun reads every condition form ci.yml uses", () => {
  const docsGuard = "steps.changes.outputs.docs_only != 'true'";
  assert.deepEqual(shouldRun(docsGuard, DOCS), { run: false, understood: true });
  assert.deepEqual(shouldRun(docsGuard, CODE), { run: true, understood: true });
  const optGuard =
    "steps.changes.outputs.optimizer == 'true' && steps.changes.outputs.docs_only != 'true'";
  assert.equal(shouldRun(optGuard, CODE).run, false);
  assert.equal(shouldRun(optGuard, CLI).run, true);
  // The case #590 hit: a Markdown-only change under optimizer/ sets both.
  assert.equal(shouldRun(optGuard, OPT_DOCS).run, false);
  assert.deepEqual(shouldRun("", DOCS), { run: true, understood: true });
});

test("shouldRun runs a gate whose condition it cannot read, and says so", () => {
  for (
    const cond of [
      "github.event_name == 'pull_request'",
      "steps.changes.outputs.docs_only != 'true' || failure()",
      "steps.changes.outputs.something_new == 'true'",
      "${{ steps.changes.outputs.docs_only != 'true' }}",
    ]
  ) {
    assert.deepEqual(shouldRun(cond, DOCS), { run: true, understood: false }, cond);
  }
});

test("ciSteps reads an if: written before its run: and one written after", () => {
  const dir = mkdtempSync(join(tmpdir(), "barwise-steps-"));
  try {
    const wf = join(dir, "ci.yml");
    writeFileSync(
      wf,
      [
        "jobs:",
        "  ci:",
        "    steps:",
        "      - uses: actions/cache@v6",
        "        with:",
        "          restore-keys: |",
        "            - not-a-step",
        "      - name: before",
        "        if: steps.changes.outputs.optimizer == 'true'",
        "        run: npm run before",
        "      - run: npm run after",
        "        if: steps.changes.outputs.docs_only != 'true'",
        "      - run: npm run plain",
        "      - run: npm ci",
        "",
      ].join("\n"),
    );
    assert.deepEqual(ciSteps(wf), [
      { args: "run before", condition: "steps.changes.outputs.optimizer == 'true'" },
      { args: "run after", condition: "steps.changes.outputs.docs_only != 'true'" },
      { args: "run plain", condition: "" },
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("every condition on a gate in the real ci.yml is one shouldRun understands", () => {
  // The fail-open rule makes an unknown form safe, but it also makes it
  // invisible to anyone not reading the output. This is where it shows.
  for (const s of ciSteps()) {
    assert.equal(shouldRun(s.condition, DOCS).understood, true, `npm ${s.args}: ${s.condition}`);
  }
  // The before-run ordering is live in the real workflow, not only planted.
  const opt = ciSteps().find((s) => s.args === "run test:optimizer");
  assert.match(opt?.condition ?? "", /optimizer == 'true'/);
});

/** A throwaway repo holding just what `ci-local.mjs --list` reads. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-cilocal-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  mkdirSync(join(dir, "barwise", "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  for (const f of ["ci-local.mjs", "lib/ci-gates.mjs", "lib/changed-class.mjs"]) {
    cpSync(join(SCRIPTS, f), join(dir, "barwise", "scripts", f));
  }
  cpSync(WORKFLOW, join(dir, ".github", "workflows", "ci.yml"));
  git("init", "-q", "-b", "main");
  git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
  return { dir, git };
}

function list(dir) {
  const r = spawnSync(
    process.execPath,
    [join(dir, "barwise", "scripts", "ci-local.mjs"), "--list"],
    {
      cwd: dir,
      encoding: "utf8",
    },
  );
  assert.equal(r.status, 0, r.stderr);
  const m = /(\d+) run, (\d+) skipped\./.exec(r.stdout);
  assert.ok(m, r.stdout);
  return { run: Number(m[1]), skipped: Number(m[2]), out: r.stdout };
}

const steps = ciSteps();
const expected = (cls) => steps.filter((s) => shouldRun(s.condition, cls).run).length;

test("ci:local --list: a tracker-only change runs only what CI runs on a docs-only PR", () => {
  const { dir, git } = sandbox();
  try {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(dir, ".beads"));
    writeFileSync(join(dir, ".beads", "issues.jsonl"), "{}\n");
    const r = list(dir);
    assert.equal(r.run, expected(DOCS));
    assert.equal(r.run + r.skipped, steps.length);
    assert.ok(
      r.skipped > 0,
      "a docs-only change must skip something, or the classifier matched nothing",
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ci:local --list: an uncommitted source edit is not docs-only", () => {
  const { dir, git } = sandbox();
  try {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    writeFileSync(join(dir, "barwise", "x.ts"), "export {};\n");
    assert.equal(list(dir).run, expected(CODE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ci:local --list: an untracked source file beside an untracked .beads/ file is not docs-only", () => {
  // Two untracked files, one docs-shaped and listed first. With `-z` after
  // `--` git read it as a pathspec and returned one newline-joined string,
  // which `^\.beads\/` matched -- so the .ts beside it vanished (PR #602).
  const { dir, git } = sandbox();
  try {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(dir, ".beads"));
    writeFileSync(join(dir, ".beads", "a.jsonl"), "{}\n");
    writeFileSync(join(dir, "x.ts"), "export {};\n");
    assert.equal(list(dir).run, expected(CODE));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ci:local --list: a CLI change runs every gate", () => {
  const { dir, git } = sandbox();
  try {
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(dir, "barwise", "packages", "cli"), { recursive: true });
    writeFileSync(join(dir, "barwise", "packages", "cli", "x.ts"), "export {};\n");
    assert.equal(list(dir).run, steps.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ci:local names the gates it skipped even when a gate it ran failed", () => {
  // The skip list was printed only on the success path, so the run most
  // worth reading -- a red one -- did not say what it had not checked
  // (Copilot, PR #602). A real run, not --list: the failure path is the
  // thing under test.
  const dir = mkdtempSync(join(tmpdir(), "barwise-cilocal-fail-"));
  const git = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  try {
    mkdirSync(join(dir, "barwise", "scripts", "lib"), { recursive: true });
    mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
    for (const f of ["ci-local.mjs", "lib/ci-gates.mjs", "lib/changed-class.mjs"]) {
      cpSync(join(SCRIPTS, f), join(dir, "barwise", "scripts", f));
    }
    writeFileSync(
      join(dir, ".github", "workflows", "ci.yml"),
      [
        "jobs:",
        "  ci:",
        "    steps:",
        "      - run: npm run boom",
        "      - run: npm run heavy",
        "        if: steps.changes.outputs.docs_only != 'true'",
        "",
      ].join("\n"),
    );
    writeFileSync(
      join(dir, "barwise", "package.json"),
      JSON.stringify({
        name: "fake",
        private: true,
        scripts: { boom: 'node -e "process.exitCode = 1"', heavy: 'node -e ""' },
      }),
    );
    git("init", "-q", "-b", "main");
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A");
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qm", "base");
    git("update-ref", "refs/remotes/origin/main", "HEAD");
    mkdirSync(join(dir, ".beads"));
    writeFileSync(join(dir, ".beads", "issues.jsonl"), "{}\n");

    const r = spawnSync(process.execPath, [join(dir, "barwise", "scripts", "ci-local.mjs")], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(r.status, 1, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /1 of 1 gates failed/);
    assert.match(r.stderr, /1 skipped for this change/);
    assert.match(r.stderr, /npm run heavy/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ci:local --list: with no origin/main it runs every gate and says why", () => {
  const { dir } = sandbox();
  try {
    mkdirSync(join(dir, ".beads"));
    writeFileSync(join(dir, ".beads", "issues.jsonl"), "{}\n");
    const r = list(dir);
    assert.equal(r.run, steps.length);
    assert.match(r.out, /Running every gate \(no merge-base with origin\/main\)/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
