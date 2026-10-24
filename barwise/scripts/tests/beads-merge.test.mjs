/**
 * The tracker's merge driver (docs/specs/beads-merge-driver.spec.md,
 * barwise-nto). First the resolution rules, against the pure lib; then real
 * `git merge` runs in throwaway repositories, through the installed copy,
 * the sh wrapper and the hooks, because every silent-loss path the spec
 * names lives in how git treats the driver, not in the rules.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
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
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";
import { DRIVER_NAME } from "../install-merge-driver.mjs";
import { canonicalLine } from "../lib/beads-jsonl.mjs";
import { MalformedInput, resolveTracker } from "../lib/beads-merge.mjs";

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), "..");
const REPO = join(SCRIPTS, "..", "..");

const T0 = "2026-01-01T00:00:00Z";
const T1 = "2026-01-02T00:00:00Z";
const T2 = "2026-01-03T00:00:00Z";

/** One issue with every field check-beads requires. */
function issue(id, overrides = {}) {
  return {
    _type: "issue",
    id,
    title: id,
    status: "open",
    priority: 2,
    issue_type: "task",
    owner: "x",
    created_at: T0,
    created_by: "x",
    updated_at: T0,
    dependency_count: 0,
    dependent_count: 0,
    comment_count: 0,
    ...overrides,
  };
}

const blocks = (from, to) => ({
  issue_id: from,
  depends_on_id: to,
  type: "blocks",
  created_at: T0,
  created_by: "x",
  metadata: "{}",
});

const jsonl = (...objs) => objs.map((o) => `${canonicalLine(o)}\n`).join("");
const issuesIn = (text) =>
  text.split("\n").filter((l) => l.startsWith("{")).map((l) => JSON.parse(l));
const idsIn = (text) => issuesIn(text).map((o) => o.id);
const find = (text, id) => issuesIn(text).find((o) => o.id === id);

// --- the rules, against the lib -------------------------------------------

test("two sides that each added an issue keep both, current's order first", () => {
  const r = resolveTracker(
    jsonl(issue("a")),
    jsonl(issue("a"), issue("b")),
    jsonl(issue("a"), issue("c")),
  );
  assert.deepEqual(r.reported, []);
  assert.deepEqual(idsIn(r.text), ["a", "b", "c"]);
});

test("an issue one side deleted and the other left alone stays deleted", () => {
  const base = jsonl(issue("a"), issue("x"));
  for (const [cur, oth] of [[jsonl(issue("a")), base], [base, jsonl(issue("a"))]]) {
    const r = resolveTracker(base, cur, oth);
    assert.deepEqual(r.reported, []);
    assert.deepEqual(idsIn(r.text), ["a"]);
  }
});

test("an edit on one side stands against a side that left the issue alone", () => {
  const base = jsonl(issue("a"));
  const edited = jsonl(issue("a", { title: "renamed", updated_at: T1 }));
  for (const [cur, oth] of [[base, edited], [edited, base]]) {
    const r = resolveTracker(base, cur, oth);
    assert.deepEqual(r.reported, []);
    assert.equal(find(r.text, "a").title, "renamed");
  }
});

test("both sides deleting an issue, or making the same edit, agree", () => {
  const same = issue("a", { priority: 1, updated_at: T1 });
  const r = resolveTracker(jsonl(issue("a"), issue("x")), jsonl(same), jsonl(same));
  assert.deepEqual(r.reported, []);
  assert.deepEqual(idsIn(r.text), ["a"]);
  assert.equal(find(r.text, "a").priority, 1);
});

test("one id minted on both sides is a collision by created_at, not by title", () => {
  const mine = issue("x", { title: "mine", created_at: T1, updated_at: T1 });
  const theirs = issue("x", { title: "theirs", created_at: T2, updated_at: T2 });
  const r = resolveTracker("", jsonl(mine), jsonl(theirs));
  assert.equal(r.reported.length, 1);
  assert.match(r.reported[0].reason, /^id collision/);
  assert.match(r.text, /^<<<<<<< current: x \(id collision/m);
  assert.ok(r.text.includes(canonicalLine(mine)) && r.text.includes(canonicalLine(theirs)));

  // Same created_at, different title: one issue added on both sides with a
  // differing field, which is a field conflict, never a collision.
  const r2 = resolveTracker(
    "",
    jsonl(issue("x", { title: "a" })),
    jsonl(issue("x", { title: "b" })),
  );
  assert.deepEqual(r2.reported.map((x) => x.reason), ["both sides changed title"]);
});

test("a deletion against an edit is reported, either way round", () => {
  const base = jsonl(issue("x"));
  const edited = jsonl(issue("x", { notes: "n", updated_at: T1 }));
  const a = resolveTracker(base, "", edited);
  assert.deepEqual(a.reported, [{ id: "x", reason: "deleted on current, edited on other" }]);
  assert.match(
    a.text,
    /^<<<<<<< current: x[^\n]*\n=======\n\{[^\n]*"notes":"n"[^\n]*\n>>>>>>> other: x$/m,
  );
  const b = resolveTracker(base, edited, "");
  assert.deepEqual(b.reported, [{ id: "x", reason: "deleted on other, edited on current" }]);
});

test("a closure on one side and a later note on the other are both kept", () => {
  const base = jsonl(issue("x"));
  const closed = jsonl(issue("x", { status: "closed", closed_at: T1, updated_at: T1 }));
  const noted = jsonl(issue("x", { notes: "n", updated_at: T2 }));
  for (const [cur, oth] of [[closed, noted], [noted, closed]]) {
    const r = resolveTracker(base, cur, oth);
    assert.deepEqual(r.reported, []);
    const x = find(r.text, "x");
    assert.equal(x.status, "closed");
    assert.equal(x.closed_at, T1);
    assert.equal(x.notes, "n");
    assert.equal(x.updated_at, T2, "updated_at takes the later value");
  }
});

test("a field both sides changed differently is reported, and each candidate keeps the merged fields", () => {
  const r = resolveTracker(
    jsonl(issue("x")),
    jsonl(issue("x", { priority: 1, status: "closed", updated_at: T1 })),
    jsonl(issue("x", { priority: 3, notes: "n", updated_at: T2 })),
  );
  assert.deepEqual(r.reported, [{ id: "x", reason: "both sides changed priority" }]);
  const candidates = issuesIn(r.text);
  assert.equal(candidates.length, 2);
  assert.deepEqual(candidates.map((c) => c.priority), [1, 3]);
  for (const c of candidates) {
    assert.equal(c.status, "closed");
    assert.equal(c.notes, "n");
    assert.equal(c.updated_at, T2);
  }
});

test("derived counts and key order never read as an edit", () => {
  const base = jsonl(issue("x"));
  const countsMoved = jsonl(issue("x", { dependent_count: 1 }));
  const { _type, id, ...rest } = issue("x");
  const reordered = `${JSON.stringify({ id, _type, ...rest })}\n`;
  for (const touched of [countsMoved, reordered]) {
    const r = resolveTracker(base, touched, "");
    assert.deepEqual(r.reported, [], "a clean deletion, not delete-versus-edit");
    assert.deepEqual(idsIn(r.text), []);
  }
  // Inside a value too: a dependency record written with its keys in
  // another order is the same dependency.
  const dep = blocks("x", "y");
  const { type, ...depRest } = dep;
  const withDep = jsonl(issue("y"), issue("x", { dependencies: [dep] }));
  const depReordered = jsonl(issue("y"), issue("x", { dependencies: [{ type, ...depRest }] }));
  const r = resolveTracker(withDep, depReordered, jsonl(issue("y")));
  assert.deepEqual(r.reported, []);
  assert.deepEqual(idsIn(r.text), ["y"]);
});

test("counts are recomputed from the merged dependencies", () => {
  const epic = issue("e");
  const r = resolveTracker(
    jsonl(epic),
    jsonl(
      { ...epic, dependent_count: 1 },
      issue("b1", { dependencies: [blocks("b1", "e")], dependency_count: 1 }),
    ),
    jsonl(
      { ...epic, dependent_count: 1 },
      issue("b2", { dependencies: [blocks("b2", "e")], dependency_count: 1 }),
    ),
  );
  assert.deepEqual(r.reported, []);
  assert.equal(find(r.text, "e").dependent_count, 2);
});

test("a line that comes through unchanged is copied byte for byte", () => {
  const spaced = JSON.stringify(issue("x"), null, 1).replace(/\n\s*/g, " ");
  const base = `${spaced}\n`;
  const r = resolveTracker(base, base, base + jsonl(issue("c")));
  assert.equal(r.text.split("\n")[0], spaced);
});

test("blank lines are skipped and an empty base is valid", () => {
  const r = resolveTracker("", `\n${jsonl(issue("a"))}\n`, jsonl(issue("b")));
  assert.deepEqual(idsIn(r.text), ["a", "b"]);
});

test("a malformed input line is refused with the input and line named", () => {
  const good = jsonl(issue("a"));
  const cases = [
    [`${good}not json\n`, /other line 2: not valid JSON/],
    [`${good}{"title":"no id"}\n`, /other line 2: no id/],
    [`${good}${good}`, /other line 2: duplicate id a/],
  ];
  for (const [oth, message] of cases) {
    assert.throws(
      () => resolveTracker(good, good, oth),
      (e) => e instanceof MalformedInput && message.test(e.message),
    );
  }
});

test("a rebase, which swaps the sides, yields the same lines in another order", () => {
  const base = jsonl(issue("x"), issue("y"));
  const a = jsonl(issue("x", { status: "closed", updated_at: T1 }), issue("b"));
  const b = jsonl(issue("x", { notes: "n", updated_at: T2 }), issue("c"));
  const merge = resolveTracker(base, a, b);
  const rebase = resolveTracker(base, b, a);
  assert.deepEqual(merge.text.split("\n").sort(), rebase.text.split("\n").sort());
  assert.notEqual(merge.text, rebase.text);
});

// --- real merges, in throwaway repositories ---------------------------------

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

/** The environment for a temp repo: nothing inherited from a hook running these tests. */
function cleanEnv(extra = {}) {
  const env = { ...process.env, ...extra };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) {
    if (!(k in extra)) delete env[k];
  }
  return env;
}

/**
 * A repository at `<tmp>/with space/repo` on `main` with `base` committed,
 * this repo's `.gitattributes` line, and the driver installed by the real
 * installer -- and, unlike any barwise checkout, no
 * barwise/scripts/beads-merge-driver.mjs in its work tree, which is the
 * branch-predates-the-driver case. `hooks` adds the validation hooks; it
 * links `barwise/` to this repo for them and runs git with GIT_DIR set, the
 * linked-worktree shape the hooks' GIT_WORK_TREE pin exists for.
 */
function repo(base, { hooks = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "beads-merge-"));
  roots.push(root);
  const dir = join(root, "with space", "repo");
  mkdirSync(dir, { recursive: true });
  const env = cleanEnv(hooks ? { GIT_DIR: join(dir, ".git") } : {});
  const run = (cmd, args) => spawnSync(cmd, args, { cwd: dir, encoding: "utf8", env });
  const git = (...args) => {
    const r = run("git", args);
    assert.equal(r.status, 0, `git ${args.join(" ")}:\n${r.stdout}${r.stderr}`);
    return r.stdout.trim();
  };
  execFileSync("git", ["init", "-q", "-b", "main", dir], { env: cleanEnv() });
  git("config", "user.email", "t@t");
  git("config", "user.name", "t");
  writeFileSync(join(dir, ".gitattributes"), ".beads/issues.jsonl merge=beads\n");
  mkdirSync(join(dir, ".beads"));
  const tracker = join(dir, ".beads", "issues.jsonl");
  const write = (text) => writeFileSync(tracker, text);
  const read = () => readFileSync(tracker, "utf8");
  write(base);
  git("add", "-A");
  git("commit", "-qm", "base");
  const install = run("node", [join(SCRIPTS, "install-merge-driver.mjs")]);
  assert.equal(install.status, 0, install.stderr);
  if (hooks) {
    symlinkSync(join(REPO, "barwise"), join(dir, "barwise"));
    writeFileSync(join(dir, ".git", "info", "exclude"), "barwise\n");
    const hookDir = join(dir, ".git", "test-hooks");
    mkdirSync(hookDir);
    // pre-merge-commit is the real hook. pre-commit is the real one's
    // tracker step alone: the rest (lint-staged, a build, tests) is not
    // what is under test and would take minutes.
    writeFileSync(
      join(hookDir, "pre-merge-commit"),
      "#!/bin/sh\nexec sh barwise/.husky/pre-merge-commit\n",
      { mode: 0o755 },
    );
    writeFileSync(
      join(hookDir, "pre-commit"),
      "#!/bin/sh\nGIT_WORK_TREE=$(pwd); export GIT_WORK_TREE\ncd barwise || exit 1\nexec sh scripts/hooks/check-staged-tracker.sh\n",
      { mode: 0o755 },
    );
    git("config", "core.hooksPath", hookDir);
  }
  const commit = (msg) => {
    git("add", ".beads/issues.jsonl");
    git("commit", "-qm", msg);
  };
  /** Commit `text` on a new branch from main, `mainText` on main, then merge the branch into main. */
  const diverge = (branchText, mainText) => {
    git("checkout", "-qb", "feature");
    write(branchText);
    commit("feature");
    git("checkout", "-q", "main");
    write(mainText);
    commit("main");
    return run("git", ["merge", "--no-edit", "feature"]);
  };
  return { dir, root, git, run, write, read, commit, diverge, tracker };
}

/** check-beads.sh from this repo, over a file, asserted by its error text by the callers. */
function beadsCheck(file) {
  return spawnSync("bash", [join(SCRIPTS, "check-beads.sh"), "--strict", file], {
    cwd: REPO,
    encoding: "utf8",
    env: cleanEnv(),
  });
}

test(".gitattributes routes the tracker to the driver name the installer registers", () => {
  const attrs = readFileSync(join(REPO, ".gitattributes"), "utf8");
  assert.equal(/^\.beads\/issues\.jsonl\s+merge=(\S+)/m.exec(attrs)?.[1], DRIVER_NAME);
});

test("installing twice leaves one registration, its wrapper on disk, and never downgrades", () => {
  const r = repo(jsonl(issue("a")));
  const again = r.run("node", [join(SCRIPTS, "install-merge-driver.mjs")]);
  assert.equal(again.status, 0, again.stderr);
  assert.equal(r.git("config", "--get-all", "merge.beads.driver").split("\n").length, 1);
  assert.equal(r.git("config", "--get", "merge.beads.recursive"), "binary");
  const installed = join(r.dir, ".git", "barwise-merge");
  assert.ok(existsSync(join(installed, "driver.sh")));

  writeFileSync(join(installed, "driver.sh"), "# sentinel\n");
  writeFileSync(join(installed, "version"), "999\n");
  const kept = r.run("node", [join(SCRIPTS, "install-merge-driver.mjs")]);
  assert.match(kept.stderr, /keeping the installed tracker merge driver \(version 999\)/);
  assert.equal(readFileSync(join(installed, "driver.sh"), "utf8"), "# sentinel\n");

  writeFileSync(join(installed, "version"), "1\n");
  r.run("node", [join(SCRIPTS, "install-merge-driver.mjs")]);
  assert.notEqual(
    readFileSync(join(installed, "driver.sh"), "utf8"),
    "# sentinel\n",
    "an equal version is replaced",
  );
});

test("two branches that each added an issue merge cleanly, with no driver in the work tree", () => {
  const base = jsonl(issue("a"));
  const r = repo(base);
  assert.ok(!existsSync(join(r.dir, "barwise", "scripts", "beads-merge-driver.mjs")));
  const m = r.diverge(base + jsonl(issue("b")), base + jsonl(issue("c")));
  assert.equal(m.status, 0, m.stdout + m.stderr);
  assert.deepEqual(idsIn(r.read()), ["a", "c", "b"]);
  assert.doesNotMatch(r.read(), /^<{7}/m);
});

test("main's closure and a later branch note on one issue merge into a closed issue with the note", () => {
  const r = repo(jsonl(issue("x")));
  const m = r.diverge(
    jsonl(issue("x", { notes: "n", updated_at: T2 })),
    jsonl(issue("x", { status: "closed", closed_at: T1, updated_at: T1 })),
  );
  assert.equal(m.status, 0, m.stdout + m.stderr);
  const x = find(r.read(), "x");
  assert.equal(x.status, "closed");
  assert.equal(x.notes, "n");
});

test("a deletion against an edit stops the merge with a block check-beads rejects", () => {
  const r = repo(jsonl(issue("a"), issue("x")));
  const m = r.diverge(
    jsonl(issue("a"), issue("x", { notes: "n", updated_at: T1 })),
    jsonl(issue("a")),
  );
  assert.notEqual(m.status, 0);
  assert.match(m.stderr, /x: deleted on current, edited on other/);
  assert.match(r.read(), /^<<<<<<< current: x/m);
  const check = beadsCheck(r.tracker);
  assert.equal(check.status, 1, check.stdout + check.stderr);
  assert.match(check.stdout, /git merge-conflict marker in JSONL/);
});

test("a driver that crashes falls back to git's markers, never an unmarked file", () => {
  const base = jsonl(issue("a"));
  const r = repo(base);
  writeFileSync(
    join(r.dir, ".git", "barwise-merge", "lib", "beads-merge.mjs"),
    'throw new Error("boom");\n',
  );
  const m = r.diverge(base + jsonl(issue("b")), base + jsonl(issue("c")));
  assert.notEqual(m.status, 0);
  assert.match(m.stderr, /falling back to git's line merge/);
  const text = r.read();
  assert.match(text, /^<<<<<<< current$/m);
  assert.ok(
    text.includes('"id":"b"') && text.includes('"id":"c"'),
    "both sides' issues are in the file",
  );
  assert.match(beadsCheck(r.tracker).stdout, /git merge-conflict marker in JSONL/);
});

test("a malformed line falls back to git's markers", () => {
  const base = jsonl(issue("a"));
  const r = repo(base);
  const m = r.diverge(`${base}not json\n`, base + jsonl(issue("c")));
  assert.notEqual(m.status, 0);
  assert.match(m.stderr, /other line 2: not valid JSON; falling back/);
  assert.match(r.read(), /^<<<<<<< current$/m);
});

test("the driver runs in a linked worktree", () => {
  const base = jsonl(issue("a"));
  const r = repo(base);
  r.git("checkout", "-qb", "feature");
  r.write(base + jsonl(issue("b")));
  r.commit("feature");
  r.git("checkout", "-q", "main");
  const wt = join(r.root, "with space", "wt");
  r.git("worktree", "add", "-q", "-b", "side", wt, "main");
  writeFileSync(join(wt, ".beads", "issues.jsonl"), base + jsonl(issue("c")));
  const env = cleanEnv();
  const g = (...args) => spawnSync("git", args, { cwd: wt, encoding: "utf8", env });
  g("commit", "-qam", "side");
  const m = g("merge", "--no-edit", "feature");
  assert.equal(m.status, 0, m.stdout + m.stderr);
  assert.deepEqual(idsIn(readFileSync(join(wt, ".beads", "issues.jsonl"), "utf8")), [
    "a",
    "c",
    "b",
  ]);
});

test("a criss-cross merge resolves against the bases' common ancestor", () => {
  // Two merge bases that disagree on one field. Run on them, the driver
  // would put a conflict block in the virtual base, and the outer merge
  // would fall back to a line merge; recursive=binary hands it the root.
  const r = repo(jsonl(issue("x")));
  const p1 = jsonl(issue("x", { priority: 1, updated_at: T1 }));
  const p3 = jsonl(issue("x", { priority: 3, updated_at: T1 }));
  r.git("checkout", "-qb", "a");
  r.write(p1);
  r.commit("a1");
  r.git("checkout", "-qb", "b", "main");
  r.write(p3);
  r.commit("b1");
  const a1 = r.git("rev-parse", "a");
  const b1 = r.git("rev-parse", "b");
  r.git("checkout", "-q", "a");
  r.run("git", ["merge", "--no-edit", b1]);
  r.write(p1);
  r.commit("a2");
  r.git("checkout", "-q", "b");
  r.run("git", ["merge", "--no-edit", a1]);
  r.write(p3);
  r.commit("b2");
  assert.equal(r.git("merge-base", "--all", "a", "b").split("\n").length, 2);
  r.git("checkout", "-q", "a");
  const m = r.run("git", ["merge", "--no-edit", "b"]);
  assert.notEqual(m.status, 0, "priority 1 against 3 is a real conflict");
  assert.doesNotMatch(m.stderr, /falling back/);
  assert.deepEqual(issuesIn(r.read()).map((c) => c.priority), [1, 3]);
  assert.match(r.read(), /^<<<<<<< current: x \(both sides changed priority\)$/m);
});

test("a dependency on an issue the other side deleted is refused by pre-merge-commit", () => {
  const r = repo(jsonl(issue("x")), { hooks: true });
  const m = r.diverge(
    jsonl(
      issue("x", { dependent_count: 1 }),
      issue("b", { dependencies: [blocks("b", "x")], dependency_count: 1 }),
    ),
    "",
  );
  assert.notEqual(m.status, 0, "the merge commit must not be created");
  assert.match(m.stdout + m.stderr, /dangling depends_on_id 'x'/);
  assert.match(m.stderr, /pre-merge-commit: tracker validation failed/);
  assert.ok(existsSync(join(r.dir, ".git", "MERGE_HEAD")), "the merge is left in progress");
});

test("a broken tracker that was staged, then fixed on disk without restaging, is refused", () => {
  const good = jsonl(issue("a"));
  const r = repo(good, { hooks: true });
  r.write(`${good}<<<<<<< stray\n`);
  r.git("add", ".beads/issues.jsonl");
  r.write(good + jsonl(issue("b")));
  const c = r.run("git", ["commit", "-qm", "broken in the index"]);
  assert.notEqual(c.status, 0);
  assert.match(c.stdout + c.stderr, /git merge-conflict marker in JSONL/);
});
