/**
 * The pre-push run checks the commit being pushed, not the working tree
 * (docs/specs/pushed-tree-verification.spec.md, workstream 3).
 *
 * The defect, pinned as a pair: a scratch checkout whose committed gate
 * passes only while an untracked build output exists. Plain `ci-local`
 * reads the working tree and passes; `ci-local --commit HEAD` reads a fresh
 * worktree of the commit, the way CI does, and fails. That is PR #641's
 * 7dd1081d in miniature -- a script test that loaded `dist`, passed here and
 * failed in CI.
 *
 * Every case runs in a throwaway repository, never this one: `test:scripts`
 * is itself a gate inside `ci:local`, so touching this checkout's lock or
 * worktrees would interfere with the run executing these tests.
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
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPTS = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const HOOK = resolve(SCRIPTS, "..", ".husky", "pre-push");

/**
 * A git checkout shaped like this one, whose single CI gate passes only when
 * `barwise/dist/marker` exists. The marker is never committed.
 */
function commitRepo({ deps } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-pushed-"));
  const root = join(dir, "barwise");
  mkdirSync(join(root, "scripts", "lib"), { recursive: true });
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(dir, ".github", "workflows", "ci.yml"),
    "jobs:\n  build:\n    steps:\n      - run: npm run probe\n",
  );
  const pkg = {
    name: "fake",
    version: "0.0.0",
    private: true,
    scripts: { probe: "node scripts/probe.mjs" },
    ...(deps ? { dependencies: deps } : {}),
  };
  writeFileSync(join(root, "package.json"), JSON.stringify(pkg));
  // An empty lockfile: npm ci then needs no network. With `deps`, the lock
  // disagrees with package.json and npm ci refuses -- the install failure.
  writeFileSync(
    join(root, "package-lock.json"),
    JSON.stringify({
      name: "fake",
      version: "0.0.0",
      lockfileVersion: 3,
      requires: true,
      packages: { "": { name: "fake", version: "0.0.0" } },
    }),
  );
  writeFileSync(
    join(root, "scripts", "probe.mjs"),
    'import { existsSync } from "node:fs";\n'
      + 'process.exitCode = existsSync("dist/marker") ? 0 : 1;\n',
  );
  writeFileSync(join(root, "scripts", "ci-local.mjs"), readFileSync(join(SCRIPTS, "ci-local.mjs")));
  for (const lib of ["ci-gates.mjs", "changed-class.mjs"]) {
    writeFileSync(join(root, "scripts", "lib", lib), readFileSync(join(SCRIPTS, "lib", lib)));
  }
  writeFileSync(join(dir, ".gitignore"), "node_modules/\n");
  const git = (...a) =>
    execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], {
      cwd: dir,
      encoding: "utf8",
    });
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "base");
  return { dir, root, git, script: join(root, "scripts", "ci-local.mjs") };
}

function ciLocal(repo, ...args) {
  const r = spawnSync(process.execPath, [repo.script, ...args], {
    cwd: repo.root,
    encoding: "utf8",
  });
  return { ...r, all: `${r.stdout}${r.stderr}` };
}

function worktrees(repo) {
  return repo.git("worktree", "list", "--porcelain").split("\n").filter((l) =>
    l.startsWith("worktree ")
  );
}

test("--commit checks the commit, not a working tree holding build output", () => {
  const repo = commitRepo();
  try {
    mkdirSync(join(repo.root, "dist"));
    writeFileSync(join(repo.root, "dist", "marker"), "built\n");

    const tree = ciLocal(repo);
    assert.equal(tree.status, 0, `the working tree has dist/, so this passes:\n${tree.all}`);

    const commit = ciLocal(repo, "--commit", "HEAD");
    assert.equal(commit.status, 1, `the commit has no dist/, as in CI:\n${commit.all}`);
    // The left-behind list names what the push will not carry.
    assert.match(
      commit.stdout,
      /Differs between this working tree and [0-9a-f]{8}; the check reads the commit's copy, which is what is pushed:\n {2}barwise\/dist\/marker/,
    );
    assert.equal(worktrees(repo).length, 1, "the worktree is removed after a failing run");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("--commit passes a commit that holds what its gates need, and cleans up", () => {
  const repo = commitRepo();
  try {
    mkdirSync(join(repo.root, "dist"));
    writeFileSync(join(repo.root, "dist", "marker"), "committed\n");
    repo.git("add", "-f", "barwise/dist/marker");
    repo.git("commit", "-qm", "ship dist");

    const r = ciLocal(repo, "--commit", "HEAD");
    assert.equal(r.status, 0, r.all);
    assert.doesNotMatch(r.stdout, /Differs between this working tree/, "nothing is left behind");
    assert.equal(worktrees(repo).length, 1, "the worktree is removed after a passing run");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("the left-behind list compares with the pushed commit, not HEAD", () => {
  // Pushing a ref that is not checked out: the working tree matches HEAD, so
  // `uncommittedPaths` would report nothing, yet probe.mjs differs from the
  // commit being checked. A tracked file deleted from the working tree is
  // listed too: the commit still holds it, so the check reads it and the
  // push carries it -- which is why the message says "differs", not "left
  // behind".
  const repo = commitRepo();
  try {
    const base = repo.git("rev-parse", "HEAD").trim();
    writeFileSync(join(repo.root, "scripts", "probe.mjs"), "process.exitCode = 0;\n");
    repo.git("commit", "-qam", "probe always passes");
    rmSync(join(repo.dir, ".gitignore"));

    const r = ciLocal(repo, "--commit", base);
    assert.match(r.stdout, / {2}barwise\/scripts\/probe\.mjs/);
    assert.match(r.stdout, /^ {2}\.gitignore$/m, "a deletion is a difference too");
    assert.equal(r.status, 1, "the base's probe still needs dist/");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("--commit refuses (exit 2) a ref that names no commit, and a failed install", () => {
  const repo = commitRepo();
  try {
    const nothing = ciLocal(repo, "--commit", "no-such-ref");
    assert.equal(nothing.status, 2, nothing.all);
    assert.match(nothing.stderr, /no-such-ref does not name a commit/);

    const missing = ciLocal(repo, "--commit");
    assert.equal(missing.status, 2, missing.all);
    assert.match(missing.stderr, /needs a commit/);
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }

  const broken = commitRepo({ deps: { "left-pad": "1.3.0" } });
  try {
    const r = ciLocal(broken, "--commit", "HEAD");
    assert.equal(r.status, 2, r.all);
    assert.match(r.stderr, /npm ci failed in the worktree/);
    assert.equal(worktrees(broken).length, 1, "the worktree is removed after a refusal");
  } finally {
    rmSync(broken.dir, { recursive: true, force: true });
  }
});

test("--commit holds this checkout's lock, so a second run stops", () => {
  const repo = commitRepo();
  try {
    // A live holder: this test process. ci-local refuses rather than run two
    // runs over one checkout (local-ci-isolation.spec.md).
    mkdirSync(join(repo.root, "node_modules"), { recursive: true });
    writeFileSync(
      join(repo.root, "node_modules", ".ci-local.lock"),
      JSON.stringify({ pid: process.pid, started: "test" }),
    );
    const r = ciLocal(repo, "--commit", "HEAD");
    // 2, not 1: no gate ran, so the hook must say "could not be checked".
    assert.equal(r.status, 2, r.all);
    assert.match(r.stderr, /ci:local is already running: pid \d+/);
    assert.equal(worktrees(repo).length, 1, "no worktree is created while the lock is held");
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("--commit refuses (exit 2) when it cannot make a temp directory, and frees the lock", () => {
  const repo = commitRepo();
  try {
    const r = spawnSync(process.execPath, [repo.script, "--commit", "HEAD"], {
      cwd: repo.root,
      encoding: "utf8",
      env: { ...process.env, TMPDIR: join(repo.dir, "no-such-dir") },
    });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /could not set up the check/);
    assert.equal(
      existsSync(join(repo.root, "node_modules", ".ci-local.lock")),
      false,
      "the lock is released, not left for the next run",
    );
  } finally {
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

test("--commit removes a worktree a killed run left behind, and spares a live one", () => {
  const repo = commitRepo();
  // A pid that has certainly exited: a child we waited for.
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  const abandoned = join(tmpdir(), `barwise-commit-${dead}-abandoned`);
  const live = join(tmpdir(), `barwise-commit-${process.pid}-live`);
  try {
    repo.git("worktree", "add", "--detach", "--quiet", abandoned, "HEAD");
    repo.git("worktree", "add", "--detach", "--quiet", live, "HEAD");
    ciLocal(repo, "--commit", "HEAD");
    const paths = worktrees(repo).join("\n");
    assert.doesNotMatch(paths, /-abandoned/, "a dead owner's worktree is removed");
    assert.equal(existsSync(abandoned), false);
    assert.match(paths, /-live/, "a live owner's worktree is left alone");
  } finally {
    rmSync(abandoned, { recursive: true, force: true });
    rmSync(live, { recursive: true, force: true });
    rmSync(repo.dir, { recursive: true, force: true });
  }
});

// --- the hook itself, with `npm` stubbed --------------------------------

/**
 * Run the real pre-push hook with ref lines on stdin and a stub `npm` that
 * records its arguments and exits with `exit`.
 */
function hook(lines, exit, setup) {
  const dir = mkdtempSync(join(tmpdir(), "barwise-hook-"));
  try {
    mkdirSync(join(dir, "barwise"));
    if (setup) lines = setup(dir);
    const bin = join(dir, "bin");
    mkdirSync(bin);
    const log = join(dir, "npm.log");
    writeFileSync(
      join(bin, "npm"),
      `#!/bin/sh\necho "$*" >> "${log}"\nexit ${exit}\n`,
    );
    chmodSync(join(bin, "npm"), 0o755);
    const r = spawnSync("sh", [HOOK], {
      cwd: dir,
      input: lines.map((l) => `${l}\n`).join(""),
      encoding: "utf8",
      env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` },
    });
    let calls = [];
    try {
      calls = readFileSync(log, "utf8").trim().split("\n").filter(Boolean);
    } catch {
      // no calls
    }
    return { ...r, calls };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const A = "a".repeat(40);
const B = "b".repeat(40);
const ZERO = "0".repeat(40);
const ref = (sha, name = "refs/heads/x") => `${name} ${sha} ${name} ${ZERO}`;

test("the hook checks each distinct pushed commit once, and skips a deletion", () => {
  const two = hook([ref(A, "refs/heads/x"), ref(B, "refs/heads/y")], 0);
  assert.equal(two.status, 0, two.stderr);
  assert.deepEqual(two.calls, [
    `run ci:local -- --commit ${A}`,
    `run ci:local -- --commit ${B}`,
  ]);

  const same = hook([ref(A, "refs/heads/x"), ref(A, "refs/heads/y")], 0);
  assert.deepEqual(same.calls, [`run ci:local -- --commit ${A}`]);

  const deletion = hook([ref(ZERO)], 0);
  assert.equal(deletion.status, 0);
  assert.deepEqual(deletion.calls, []);
});

test("the hook checks a branch and an annotated tag on one commit once", () => {
  // git hands the hook the TAG object's sha for an annotated tag; peeled, it
  // is the same commit as the branch, and one tree is checked once.
  let commit;
  const r = hook([], 0, (dir) => {
    const git = (...a) =>
      execFileSync("git", ["-c", "user.email=t@example.com", "-c", "user.name=t", ...a], {
        cwd: dir,
        encoding: "utf8",
      }).trim();
    writeFileSync(join(dir, "barwise", "x"), "x\n");
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "base");
    git("tag", "-a", "v1", "-m", "release");
    commit = git("rev-parse", "HEAD");
    const tagObject = git("rev-parse", "v1");
    assert.notEqual(tagObject, commit, "an annotated tag is its own object");
    return [ref(commit, "refs/heads/main"), ref(tagObject, "refs/tags/v1")];
  });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.calls, [`run ci:local -- --commit ${commit}`]);
});

test("the hook blocks a failing commit and a refused one, each with its own message", () => {
  const failed = hook([ref(A)], 1);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /CI would fail on a{40}/);

  const refused = hook([ref(A)], 2);
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /a{40} could not be checked/);
  assert.doesNotMatch(refused.stderr, /CI would fail/);
});
