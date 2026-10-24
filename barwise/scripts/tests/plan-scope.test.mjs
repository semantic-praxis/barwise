/**
 * plan-scope: how a branch compares with the plan it names
 * (docs/specs/plan-scope-check.spec.md, WS3).
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "..", "plan-scope.mjs");

/** A repo with a `main` branch and a feature branch cut from it. */
function planRepo() {
  const dir = mkdtempSync(join(tmpdir(), "barwise-plan-scope-"));
  const g = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path, text) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = (msg, files = {}) => {
    for (const [p, t] of Object.entries(files)) put(p, t);
    g("add", "-A");
    g("commit", "-q", "-m", msg);
  };
  g("init", "-q", "-b", "main");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  commit("base", {
    ".gitattributes": "gen/** linguist-generated=true\n",
    "barwise/docs/specs/p.spec.md":
      "# P\n\nStatus: Draft\nTouches: src/a.ts, +src/new.ts, lib/\n\n## Body\n",
    "barwise/docs/specs/q.spec.md":
      "# Q\n\nStatus: Draft\n\n## Body\n\nChanges `src/b.ts` and `docs/`.\n",
    "src/a.ts": "a\n",
    "src/b.ts": "b\n",
    "src/c.ts": "c\n",
    "lib/x.ts": "x\n",
    "docs/d.md": "d\n",
    "gen/out.txt": "g\n",
  });
  // A merged PR on main, so the percentile has history to read.
  g("checkout", "-q", "-b", "old");
  commit("old work", { "src/c.ts": "c\nc\nc\n" });
  g("checkout", "-q", "main");
  g("merge", "-q", "--no-ff", "-m", "Merge old", "old");
  g("checkout", "-q", "-b", "feature");
  const run = (...args) =>
    spawnSync(process.execPath, [SCRIPT, "--root", dir, "--base", "main", ...args], {
      encoding: "utf8",
    });
  return { dir, g, commit, run, done: () => rmSync(dir, { recursive: true, force: true }) };
}

test("plan-scope lists a changed file the named spec does not plan, and reads Touches: entries", () => {
  const r = planRepo();
  try {
    // p.spec.md is named in the diff. src/a.ts is a file entry, src/new.ts
    // a planned new file, lib/y.ts under a directory entry; src/c.ts is
    // outside, and gen/out.txt is generated and left out entirely.
    r.commit("work", {
      "barwise/docs/specs/p.spec.md":
        "# P\n\nStatus: Draft\nTouches: src/a.ts, +src/new.ts, lib/\n\n## Body\n\nMore.\n",
      "src/a.ts": "a2\n",
      "src/new.ts": "n\n",
      "lib/y.ts": "y\n",
      "src/c.ts": "c2\n",
      "gen/out.txt": "g2\ng3\n",
    });
    const out = r.run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Plan read from: p\.spec\.md \(Touches:\)/);
    assert.match(out.stdout, /Outside the plan \(1 of 5 files\):\n {2}src\/c\.ts\n?$/);
    assert.match(out.stdout, /\(1 generated or recorded files left out\)/);
    assert.doesNotMatch(out.stdout, /gen\/out\.txt|src\/new\.ts|lib\/y\.ts/);
  } finally {
    r.done();
  }
});

test("plan-scope finds a spec through a commit message, and falls back to the paths it names", () => {
  const r = planRepo();
  try {
    r.commit("implement q.spec.md WS1", {
      "src/b.ts": "b2\n",
      "docs/e.md": "e\n",
      "src/a.ts": "a2\n",
    });
    const out = r.run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /q\.spec\.md \(the paths it names; no Touches:\)/);
    assert.match(out.stdout, /Outside the plan \(1 of 3 files\):\n {2}src\/a\.ts/);
  } finally {
    r.done();
  }
});

test("plan-scope says no plan was found, and lists nothing as outside it", () => {
  const r = planRepo();
  try {
    r.commit("drive-by", { "src/c.ts": "c2\n" });
    const out = r.run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /No plan found: no spec in the diff/);
    assert.doesNotMatch(out.stdout, /Outside the plan/);
  } finally {
    r.done();
  }
});

test("plan-scope reads the branch's own changes, not a base that moved since it was cut", () => {
  const r = planRepo();
  try {
    r.commit("work on p", {
      "src/a.ts": "a2\n",
      "barwise/docs/specs/p.spec.md": "# P\n\nStatus: Draft\nTouches: src/a.ts\n\n## B\n",
    });
    // main moves on with an unrelated change; a two-dot diff would count it.
    r.g("checkout", "-q", "main");
    // main also touches src/a.ts, which the branch changed: a two-dot
    // count would diff against main's copy and read a different size.
    r.commit("main moves", { "src/c.ts": "moved on main\n", "src/a.ts": "a\nmain\n" });
    r.g("checkout", "-q", "feature");
    const out = r.run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(out.stdout, /Every changed file is in the plan\./);
    // Lines too: main's 1-line change to src/c.ts must not be counted.
    assert.match(out.stdout, /Size: 6 lines in 2 files/);
  } finally {
    r.done();
  }
});

test("plan-scope reports an ad hoc plan.md outside the specs, and places the size among merged PRs", () => {
  const r = planRepo();
  try {
    r.commit("plan it", { "PLAN.md": "# plan\n", "src/sub/plan.md": "x\n" });
    const out = r.run();
    assert.equal(out.status, 0, out.stderr);
    assert.match(
      out.stdout,
      /Ad hoc plan files outside barwise\/docs\/specs\/[^\n]*\n {2}PLAN\.md\n {2}src\/sub\/plan\.md/,
    );
    // The one merged PR ("old work") changed 2 lines; so does this branch,
    // and "larger than" is strict.
    assert.match(
      out.stdout,
      /Size: 2 lines in 2 files; larger than 0 of the last 1 merged PRs on main\./,
    );
  } finally {
    r.done();
  }
});

test("plan-scope prints no report and exits 2 when git cannot resolve the base", () => {
  const r = planRepo();
  try {
    const out = spawnSync(process.execPath, [SCRIPT, "--root", r.dir, "--base", "no-such-ref"], {
      encoding: "utf8",
    });
    assert.equal(out.status, 2, out.stdout + out.stderr);
    assert.match(out.stderr, /plan-scope: cannot answer/);
    assert.equal(out.stdout, "");
  } finally {
    r.done();
  }
});
