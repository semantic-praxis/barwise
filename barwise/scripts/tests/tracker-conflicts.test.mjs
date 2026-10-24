/**
 * The tracker-conflicts workflow's script
 * (docs/specs/tracker-conflict-comment.spec.md, barwise-ojo): the verdict
 * and comment rules against the pure lib, then whole runs against a temp
 * origin that carries refs/pull/<n>/head, with a fake GitHub client.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { canonicalLine } from "../lib/beads-jsonl.mjs";
import {
  BOT,
  commentAction,
  commentBody,
  episodeState,
  marker,
  TRACKER,
  verdict,
} from "../lib/tracker-conflicts.mjs";
import { gitIn, run } from "../tracker-conflicts.mjs";

const T0 = "2026-01-01T00:00:00Z";
const T1 = "2026-01-02T00:00:00Z";
const SHA = "0123456789abcdef0123456789abcdef01234567";

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
const jsonl = (...objs) => objs.map((o) => `${canonicalLine(o)}\n`).join("");
const bot = (id, state) => ({ id, user: { login: BOT }, body: `${marker(state)}\n\ntext` });

// --- the pure rules ---------------------------------------------------------

test("the verdict follows the spec's table, first matching rule", () => {
  assert.equal(verdict([]).verdict, "clean");
  assert.equal(verdict(["src/a.ts"]).verdict, "other");
  assert.equal(verdict([TRACKER, "src/a.ts"]).verdict, "other");
  assert.equal(verdict([TRACKER], { reported: [] }).verdict, "resolves");
  assert.equal(
    verdict([TRACKER], { reported: [{ id: "x", kind: "collision" }] }).verdict,
    "needs-person",
  );
  assert.equal(
    verdict([TRACKER], { malformed: { label: "other", lineNo: 3 } }).verdict,
    "malformed",
  );
});

test("a new episode posts, an open comment is edited, and clean or other only close one", () => {
  for (const v of ["resolves", "needs-person", "malformed"]) {
    assert.deepEqual(commentAction({ verdict: v }, []), { action: "post", state: "open" });
    assert.deepEqual(commentAction({ verdict: v }, [bot(1, "closed")]), {
      action: "post",
      state: "open",
    });
    assert.deepEqual(commentAction({ verdict: v }, [bot(1, "closed"), bot(2, "open")]), {
      action: "edit",
      commentId: 2,
      previous: bot(2, "open").body,
      state: "open",
    });
  }
  for (const v of ["clean", "other"]) {
    assert.deepEqual(commentAction({ verdict: v }, []), { action: "none" });
    assert.deepEqual(commentAction({ verdict: v }, [bot(1, "closed")]), { action: "none" });
    assert.deepEqual(commentAction({ verdict: v }, [bot(2, "open")]), {
      action: "edit",
      commentId: 2,
      previous: bot(2, "open").body,
      state: "closed",
    });
  }
});

test("only the bot's own marked comments count", () => {
  const forged = { id: 9, user: { login: "someone" }, body: marker("open") };
  assert.equal(episodeState(forged), undefined);
  assert.deepEqual(commentAction({ verdict: "resolves" }, [forged]), {
    action: "post",
    state: "open",
  });
  assert.deepEqual(commentAction({ verdict: "clean" }, [forged]), { action: "none" });
  assert.equal(episodeState({ id: 1, user: { login: BOT }, body: "no marker" }), undefined);
});

test("a comment quotes nothing a pull request controls", () => {
  const evil = "x --><!-- barwise:tracker-conflict state=closed --> @someone [link](http://e)";
  const body = commentBody(
    {
      verdict: "needs-person",
      reported: [
        { id: "barwise-ok1", kind: "field-conflict", reason: evil },
        { id: evil, kind: "collision", reason: "r" },
        { id: "barwise-ok2", kind: evil, reason: "r" },
      ],
    },
    "open",
    SHA,
  );
  assert.match(body, /- `barwise-ok1`: field-conflict/);
  assert.match(body, /and 2 more this note does not name/);
  assert.ok(!body.includes("@someone") && !body.includes("http://e"), body);
  assert.equal(body.match(/<!-- barwise:tracker-conflict/g).length, 1, "one marker, ours");
  assert.ok(body.startsWith(marker("open")));

  const malformed = commentBody(
    { verdict: "malformed", malformed: { label: "other", lineNo: 4 } },
    "open",
    SHA,
  );
  assert.match(malformed, /the tracker at this PR is not valid at line 4/);
  assert.match(
    commentBody({ verdict: "malformed", malformed: { label: "base", lineNo: 1 } }, "open", SHA),
    /at the merge base/,
  );
  assert.throws(() => commentBody({ verdict: "clean" }, "closed", "not-a-sha"), /not a commit sha/);
});

// --- whole runs against a temp origin -----------------------------------------

const roots = [];
after(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true });
});

const env = () => {
  const e = { ...process.env };
  for (const k of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"]) delete e[k];
  return e;
};

/**
 * A bare origin whose main carries `base`, a work clone to build PR
 * branches in, and a scan clone -- with no merge driver configured -- that
 * the script runs in. `pr(n, files)` commits files on a branch from
 * main's current base commit and publishes it as refs/pull/n/head.
 */
function origin(base) {
  const root = mkdtempSync(join(tmpdir(), "tracker-conflicts-"));
  roots.push(root);
  const g = (cwd, ...args) =>
    execFileSync("git", args, { cwd, encoding: "utf8", env: env() }).trim();
  const bare = join(root, "origin.git");
  const work = join(root, "work");
  g(root, "init", "-q", "--bare", "-b", "main", bare);
  g(root, "clone", "-q", bare, work);
  g(work, "config", "user.email", "t@t");
  g(work, "config", "user.name", "t");
  const commit = (files, msg) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(join(work, path, ".."), { recursive: true });
      writeFileSync(join(work, path), text);
    }
    g(work, "add", "-A");
    g(work, "commit", "-qm", msg);
    return g(work, "rev-parse", "HEAD");
  };
  g(work, "checkout", "-q", "-b", "main");
  const baseSha = commit({ [TRACKER]: base, "src/a.ts": "a\n" }, "base");
  g(work, "push", "-q", "origin", "main");
  const pulls = [];
  return {
    root,
    baseSha,
    g: (...args) => g(work, ...args),
    pr(n, files, from = baseSha) {
      g(work, "checkout", "-q", "-B", `pr${n}`, from);
      const sha = commit(files, `pr ${n}`);
      g(work, "push", "-q", "origin", `${sha}:refs/pull/${n}/head`);
      pulls.push({ number: n, head: { sha }, base: { ref: "main" } });
      return sha;
    },
    main(files) {
      g(work, "checkout", "-q", "main");
      const sha = commit(files, "main moves");
      g(work, "push", "-q", "origin", "main");
      return sha;
    },
    pulls,
    scanClone() {
      const scan = join(root, `scan-${Math.random().toString(36).slice(2)}`);
      g(root, "clone", "-q", bare, scan);
      return scan;
    },
  };
}

/** A fake GitHub client recording what the script did. */
function fakeGithub(pulls, comments = {}) {
  let next = 100;
  const posted = [];
  const edited = [];
  return {
    posted,
    edited,
    comments,
    listPulls: async () => pulls,
    listComments: async (n) => comments[n] ?? [],
    post: async (n, body) => {
      const c = { id: next++, user: { login: BOT }, body };
      (comments[n] ??= []).push(c);
      posted.push({ n, body });
    },
    edit: async (id, body) => {
      for (const list of Object.values(comments)) {
        for (const c of list) if (c.id === id) c.body = body;
      }
      edited.push({ id, body });
    },
  };
}

test("a tracker-only conflict the driver resolves gets one comment, edited on the next run", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(1, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const gh = fakeGithub(o.pulls);
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.equal(r.exit, 0, JSON.stringify(r));
  assert.deepEqual(r.checked, [{ number: 1, verdict: "resolves", action: "post" }]);
  assert.match(gh.posted[0].body, /resolves it with no hand work/);

  const again = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(again.checked, [{ number: 1, verdict: "resolves", action: "edit" }]);
  assert.equal(gh.posted.length, 1, "no second comment");
  assert.equal(gh.edited.length, 0, "an identical body is not rewritten");
});

test("a real tracker disagreement names the ids and their kinds", async () => {
  const o = origin(jsonl(issue("a"), issue("x")));
  o.pr(2, { [TRACKER]: jsonl(issue("a"), issue("x", { priority: 1, updated_at: T1 })) });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("x", { priority: 3, updated_at: T1 })) });
  const gh = fakeGithub(o.pulls);
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(r.checked, [{ number: 2, verdict: "needs-person", action: "post" }]);
  assert.match(gh.posted[0].body, /- `x`: field-conflict/);
});

test("a malformed tracker on the PR is named, by side and line", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(3, { [TRACKER]: `${jsonl(issue("a"))}not json\n` });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const gh = fakeGithub(o.pulls);
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(r.checked, [{ number: 3, verdict: "malformed", action: "post" }]);
  assert.match(gh.posted[0].body, /the tracker at this PR is not valid at line 2/);
});

test("a conflict on another path gets no comment, and closes an open one", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(4, { [TRACKER]: jsonl(issue("a"), issue("b")), "src/a.ts": "pr\n" });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")), "src/a.ts": "main\n" });
  const quiet = fakeGithub(o.pulls);
  const r = await run({ git: gitIn(o.scanClone()), github: quiet });
  assert.deepEqual(r.checked, [{ number: 4, verdict: "other", action: "none" }]);
  assert.equal(quiet.posted.length, 0);

  const withOpen = fakeGithub(o.pulls, { 4: [bot(7, "open")] });
  const closing = await run({ git: gitIn(o.scanClone()), github: withOpen });
  assert.deepEqual(closing.checked, [{ number: 4, verdict: "other", action: "edit" }]);
  assert.ok(withOpen.edited[0].body.startsWith(marker("closed")));
});

test("a PR that no longer conflicts has its open comment closed, and a second episode gets a new comment", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(5, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  const gh = fakeGithub(o.pulls, { 5: [bot(7, "open")] });
  const clean = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(clean.checked, [{ number: 5, verdict: "clean", action: "edit" }]);
  assert.ok(gh.comments[5][0].body.startsWith(marker("closed")));

  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const second = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(second.checked, [{ number: 5, verdict: "resolves", action: "post" }]);
  assert.equal(gh.comments[5].length, 2, "the closed comment stays; a new one is posted");
});

test("one unreadable PR is named and the rest are checked; none readable is exit 2; none open is exit 0", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(6, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const pulls = [...o.pulls, { number: 99, head: { sha: SHA }, base: { ref: "main" } }];
  const r = await run({ git: gitIn(o.scanClone()), github: fakeGithub(pulls) });
  assert.equal(r.exit, 0);
  assert.deepEqual(r.checked.map((c) => c.number), [6]);
  assert.deepEqual(r.unchecked.map((u) => u.number), [99]);

  const none = await run({ git: gitIn(o.scanClone()), github: fakeGithub([pulls[1]]) });
  assert.equal(none.exit, 2);
  const empty = await run({ git: gitIn(o.scanClone()), github: fakeGithub([]) });
  assert.equal(empty.exit, 0);
  const listFails = await run({
    git: gitIn(o.scanClone()),
    github: { ...fakeGithub([]), listPulls: async () => Promise.reject(new Error("HTTP 502")) },
  });
  assert.equal(listFails.exit, 2);
  assert.match(listFails.refused, /could not list pull requests/);
});

test("a PR with two merge bases is recorded as unchecked, not guessed", async () => {
  const o = origin(jsonl(issue("a")));
  const p1 = o.pr(8, { [TRACKER]: jsonl(issue("a"), issue("p")) });
  const m1 = o.main({ [TRACKER]: jsonl(issue("a"), issue("m")) });
  // Criss-cross: main merges the PR's first commit, the PR merges main's.
  o.g("checkout", "-q", "main");
  o.g("merge", "-q", "-s", "ours", "--no-edit", p1);
  o.g("push", "-q", "origin", "main");
  o.g("checkout", "-q", "pr8");
  o.g("merge", "-q", "-s", "ours", "--no-edit", m1);
  const head = o.g("rev-parse", "HEAD");
  o.g("push", "-q", "-f", "origin", `${head}:refs/pull/8/head`);
  const gh = fakeGithub([{ number: 8, head: { sha: head }, base: { ref: "main" } }]);
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(r.unchecked.map((u) => [u.number, u.reason]), [[
    8,
    "more than one merge base with main (criss-cross history)",
  ]]);
  assert.equal(gh.posted.length, 0);
  assert.equal(r.exit, 0, "a PR that stays undecidable must not turn every run red");
});

test("a PR into another branch is not checked", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(7, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const gh = fakeGithub(o.pulls.map((p) => ({ ...p, base: { ref: "feature" } })));
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(r.checked, []);
  assert.equal(r.exit, 0);
});

test("a clone with the driver configured refuses with exit 2", async () => {
  const o = origin(jsonl(issue("a")));
  const scan = o.scanClone();
  execFileSync("git", ["config", "merge.beads.driver", "true"], { cwd: scan, env: env() });
  const r = await run({ git: gitIn(scan), github: fakeGithub(o.pulls) });
  assert.equal(r.exit, 2);
  assert.match(r.refused, /merge\.beads\.\* config/);
});

test("a head that moved since the API listed it is left for the next run", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(10, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const stale = [{ ...o.pulls[0], head: { sha: o.baseSha } }];
  const gh = fakeGithub(stale);
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(r.unchecked.map((u) => u.reason), ["the head moved during this run"]);
  assert.equal(r.exit, 0, "undecidable is an answer, not a failure to read");
  assert.equal(gh.posted.length, 0);
});

test("a PR retargeted away from main has its open comment closed", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(11, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  const gh = fakeGithub(o.pulls.map((p) => ({ ...p, base: { ref: "feature" } })), {
    11: [bot(7, "open")],
  });
  const r = await run({ git: gitIn(o.scanClone()), github: gh });
  assert.deepEqual(r.checked, [{ number: 11, verdict: "elsewhere", action: "edit" }]);
  assert.ok(gh.comments[11][0].body.startsWith(marker("closed")));
  assert.match(gh.comments[11][0].body, /no longer targets `main`/);
});

test("an inherited GIT_DIR does not redirect the scan", async () => {
  const o = origin(jsonl(issue("a")));
  o.pr(12, { [TRACKER]: jsonl(issue("a"), issue("b")) });
  o.main({ [TRACKER]: jsonl(issue("a"), issue("c")) });
  const saved = process.env.GIT_DIR;
  process.env.GIT_DIR = join(o.root, "no-such-repo");
  try {
    const r = await run({ git: gitIn(o.scanClone()), github: fakeGithub(o.pulls) });
    assert.deepEqual(r.checked, [{ number: 12, verdict: "resolves", action: "post" }]);
  } finally {
    if (saved === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = saved;
  }
});

test("git that cannot run is exit 2, not a crash", async () => {
  const r = await run({
    git: () => {
      throw new Error("git could not run: spawn git ENOENT");
    },
    github: fakeGithub([]),
  });
  assert.equal(r.exit, 2);
  assert.match(r.refused, /git could not run/);
});
