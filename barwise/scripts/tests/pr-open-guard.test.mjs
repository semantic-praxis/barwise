/**
 * The opening guard refuses a pull request on a commit this session has
 * not reviewed, and the recorder writes the record it reads
 * (review-policy decision review-before-open;
 * docs/specs/review-before-open.spec.md, Workstream 1).
 *
 * Both hooks are driven as Claude Code drives them: JSON on stdin, the
 * verdict in the exit code. Nothing is stubbed but one `git` that sleeps,
 * for the timeout: the remote is a bare repository, `git ls-remote` is
 * real, and the record is written by the recorder into a TMPDIR of this
 * file's own. Each test takes a session id nobody else uses.
 *
 * The event shapes are the ones a probe hook captured from Claude Code
 * 2.1.329 on 2026-11-20 (the spec, "What counts"): a forked Skill return
 * carries success, status, agentId and result; a Read carries
 * file.startLine, numLines and totalLines; a subagent's call carries the
 * parent's session_id and an agent_id.
 */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { envWithoutRepoLocation, envWithoutUserGitConfig } from "../lib/git-env.mjs";
import { CHECKLIST as CHECKLIST_REL } from "../lib/review-record.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD = join(HERE, "..", "hooks", "pr-open-guard.mjs");
const RECORDER = join(HERE, "..", "hooks", "review-recorder.mjs");
const ROOT = join(HERE, "..", "..", "..");
const TAG = "[adr:review-policy#review-before-open]";

const T = mkdtempSync(join(tmpdir(), "pr-open-guard-"));
const TMP = join(T, "tmp");
const ORIGIN = join(T, "o", "r.git");
const WORK = join(T, "work");
const OTHER = join(T, "other");
const CHECKLIST = join(WORK, CHECKLIST_REL);
const ENV = { ...envWithoutRepoLocation(envWithoutUserGitConfig()), TMPDIR: TMP };
const BASE = join(TMP, `barwise-exit-${process.getuid?.() ?? "user"}`);

function git(cwd, ...args) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: ENV }).trim();
}

mkdirSync(TMP);
mkdirSync(dirname(ORIGIN), { recursive: true });
git(T, "init", "-q", "--bare", "-b", "main", ORIGIN);
git(T, "clone", "-q", ORIGIN, WORK);
git(WORK, "config", "user.email", "t@t");
git(WORK, "config", "user.name", "t");
mkdirSync(dirname(CHECKLIST), { recursive: true });
writeFileSync(CHECKLIST, "# Checklist\n\n- one\n");
git(WORK, "add", ".");
git(WORK, "commit", "-q", "-m", "base");
git(WORK, "push", "-q", "origin", "HEAD:refs/heads/main");
git(T, "clone", "-q", ORIGIN, OTHER);

let n = 0;
const session = () => `s${++n}`;
/** A branch of its own, one commit past main, pushed and checked out; returns its tip. */
function branch(name) {
  git(WORK, "checkout", "-q", "-B", name, "origin/main");
  return commit(name, true);
}
function commit(name, push) {
  git(WORK, "commit", "-q", "--allow-empty", "-m", `${name} ${++n}`);
  if (push) git(WORK, "push", "-q", "-f", "origin", `HEAD:refs/heads/${name}`);
  return git(WORK, "rev-parse", "HEAD");
}

function run(hook, input, opts = {}) {
  return spawnSync(process.execPath, [hook], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    // Not a repository: the hooks must read git in the input's cwd.
    cwd: T,
    env: { ...ENV, ...opts.env },
  });
}
const skillEvent = (sid, over = {}) => ({
  session_id: sid,
  cwd: WORK,
  hook_event_name: "PostToolUse",
  tool_name: "Skill",
  tool_input: { skill: "code-review", args: "low" },
  tool_response: {
    success: true,
    commandName: "code-review",
    status: "forked",
    agentId: "a1",
    result: "[]",
  },
  ...over,
});
const readEvent = (sid, over = {}, file = {}) => ({
  session_id: sid,
  cwd: WORK,
  hook_event_name: "PostToolUse",
  tool_name: "Read",
  tool_input: { file_path: CHECKLIST },
  tool_response: {
    type: "text",
    file: {
      filePath: CHECKLIST,
      content: "...",
      numLines: 3,
      startLine: 1,
      totalLines: 3,
      ...file,
    },
  },
  ...over,
});
const mcp = (sid, over = {}, top = {}) => ({
  session_id: sid,
  cwd: WORK,
  hook_event_name: "PreToolUse",
  tool_name: "mcp__github__create_pull_request",
  tool_input: { owner: "o", repo: "r", title: "t", head: "feat", base: "main", body: "b", ...over },
  ...top,
});
const bash = (sid, command, top = {}) => ({
  session_id: sid,
  cwd: WORK,
  hook_event_name: "PreToolUse",
  tool_name: "Bash",
  tool_input: { command },
  ...top,
});

/** Runs the recorder for both steps on the current HEAD, as a reviewed session would. */
function review(sid, kinds = ["code-review", "checklist"]) {
  for (const kind of kinds) {
    const r = run(RECORDER, kind === "code-review" ? skillEvent(sid) : readEvent(sid));
    assert.equal(r.status, 0, r.stderr);
  }
}
function recorded(sid, base = BASE) {
  const file = join(base, sid, "reviews.jsonl");
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
function refused(input, reason, opts) {
  const r = run(GUARD, input, opts);
  assert.equal(r.status, 2, `expected a refusal, got ${r.status}: ${r.stderr}`);
  assert.match(r.stderr, /^pr-open-guard: refused\./);
  for (const re of [reason].flat()) assert.match(r.stderr, re);
  return r;
}
function allowed(input, opts) {
  const r = run(GUARD, input, opts);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
}
const LITERAL = (head, rest = "--title 'A title (x)' --body 'b'") =>
  `gh pr create --repo o/r --head ${head} --base main ${rest}`.trim();

// ---------------------------------------------------------------- recorder

test(`the recorder writes a code-review entry on HEAD when the skill returns ${TAG}`, () => {
  const sha = branch("rec1");
  const sid = session();
  const r = run(RECORDER, skillEvent(sid));
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stderr, "");
  const [e] = recorded(sid);
  assert.deepEqual({ kind: e.kind, sha: e.sha }, { kind: "code-review", sha });
  assert.ok(Number.isFinite(e.t));
});

test("the recorder ignores another skill, and a code-review that did not succeed", () => {
  branch("rec2");
  const sid = session();
  for (
    const over of [
      { tool_input: { skill: "pr-review" } },
      { tool_response: { success: false, commandName: "code-review", result: "[]" } },
      { tool_response: { commandName: "code-review", result: "[]" } },
      // A skill that only loaded into the turn: success, and no result yet.
      { tool_response: { success: true, commandName: "code-review" } },
      { hook_event_name: "PreToolUse" },
    ]
  ) {
    const r = run(RECORDER, skillEvent(sid, over));
    assert.equal(r.status, 0, r.stderr);
  }
  assert.deepEqual(recorded(sid), []);
});

test(`the recorder writes a checklist entry for a whole-file read in the main conversation ${TAG}`, () => {
  const sha = branch("rec3");
  const sid = session();
  const r = run(RECORDER, readEvent(sid));
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(recorded(sid).map((e) => [e.kind, e.sha]), [["checklist", sha]]);
});

test("the recorder ignores a partial read, a subagent's read, another file and another checkout's checklist", () => {
  branch("rec4");
  const sid = session();
  const elsewhere = join(OTHER, CHECKLIST_REL);
  for (
    const event of [
      readEvent(sid, {}, { numLines: 2 }),
      readEvent(sid, {}, { startLine: 2, numLines: 2 }),
      readEvent(sid, {}, { totalLines: 0, numLines: 0 }),
      readEvent(sid, { agent_id: "a7", agent_type: "Explore" }),
      readEvent(sid, { tool_input: { file_path: join(WORK, "README.md") } }),
      readEvent(sid, { tool_input: { file_path: elsewhere } }),
      readEvent(sid, { tool_response: { type: "text" } }),
    ]
  ) {
    const r = run(RECORDER, event);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stderr, "");
  }
  assert.deepEqual(recorded(sid), []);
});

test("the recorder says why, with exit 2, when a matching event cannot be recorded", () => {
  branch("rec5");
  const cases = [
    [skillEvent(undefined), /no usable session_id/],
    [skillEvent("../escape"), /no usable session_id/],
    [skillEvent(session(), { cwd: T }), /could not name HEAD/],
    [readEvent(session(), { cwd: T }), /could not name the repository root/],
    ["not json", /could not be parsed/],
  ];
  for (const [event, why] of cases) {
    const r = run(RECORDER, event);
    assert.equal(r.status, 2, r.stderr);
    assert.match(r.stderr, /^review-recorder: could not record/);
    assert.match(r.stderr, why);
  }
  // A base another user could write to is not trusted with the record.
  const open = join(T, "tmp-open");
  const base = join(open, `barwise-exit-${process.getuid?.() ?? "user"}`);
  mkdirSync(base, { recursive: true });
  chmodSync(base, 0o755);
  const sid = session();
  const r = run(RECORDER, skillEvent(sid), { env: { TMPDIR: open } });
  assert.equal(r.status, 2, r.stderr);
  assert.match(r.stderr, /open to other users/);
  assert.deepEqual(recorded(sid, base), []);
});

test("the checklist is where the hooks look for it", () => {
  // The clone above carries a stand-in at the same relative path, so the
  // suite would stay green if the real file moved and every opening were
  // then refused for a read nobody can make.
  assert.ok(existsSync(join(ROOT, CHECKLIST_REL)), `${CHECKLIST_REL} is not in this repository`);
});

// ------------------------------------------------------- guard, MCP call

test(`refuses a create_pull_request call when nothing was reviewed ${TAG}`, () => {
  const sha = branch("feat");
  const r = refused(mcp(session()), [
    new RegExp(`would propose ${sha}`),
    /`\/code-review` has not returned on that commit \(never recorded in this session\)/,
    /checklist has not been read whole on that commit \(never recorded in this session\)/,
    new RegExp(`Read ${CHECKLIST.replace(/[.]/g, "\\.")} with the Read tool`),
    /Opened-without-review:/,
  ]);
  assert.doesNotMatch(r.stderr, /unreadable/);
});

test(`refuses when only one of the two steps ran on the commit ${TAG}`, () => {
  branch("feat");
  let sid = session();
  review(sid, ["code-review"]);
  let r = refused(mcp(sid), /checklist has not been read whole/);
  assert.doesNotMatch(r.stderr, /`\/code-review` has not returned/);
  sid = session();
  review(sid, ["checklist"]);
  r = refused(mcp(sid), /`\/code-review` has not returned/);
  assert.doesNotMatch(r.stderr, /checklist has not been read whole/);
});

test(`a run on an earlier commit does not count ${TAG}`, () => {
  const earlier = branch("feat");
  const sid = session();
  review(sid);
  allowed(mcp(sid));
  const later = commit("feat", true);
  refused(mcp(sid), [
    new RegExp(`would propose ${later}`),
    new RegExp(`has not returned on that commit \\(last recorded on ${earlier.slice(0, 12)}\\)`),
    new RegExp(`read whole on that commit \\(last recorded on ${earlier.slice(0, 12)}\\)`),
  ]);
  review(sid);
  allowed(mcp(sid));
});

test(`allows the call once both steps ran on the proposed commit ${TAG}`, () => {
  branch("feat");
  const sid = session();
  refused(mcp(sid), /has not reviewed that commit/);
  review(sid);
  allowed(mcp(sid));
  // A draft is a pull request, and one session's record is not another's.
  allowed(mcp(sid, { draft: true }));
  refused(mcp(session(), { draft: true }), /has not reviewed that commit/);
});

test(`the proposed commit is the remote tip, not the local HEAD ${TAG}`, () => {
  const pushed = branch("tip");
  const sid = session();
  review(sid);
  const local = commit("tip", false);
  // Reviewed and pushed: allowed, whatever HEAD has moved to since.
  allowed(mcp(sid, { head: "tip" }));
  // Reviewed locally and never pushed: the pull request would propose the pushed commit.
  const other = session();
  review(other);
  refused(mcp(other, { head: "tip" }), [
    new RegExp(`would propose ${pushed}`),
    new RegExp(`last recorded on ${local.slice(0, 12)}`),
  ]);
});

test("refuses a head it cannot resolve on origin, and says which", () => {
  branch("feat");
  const sid = session();
  review(sid);
  refused(
    mcp(sid, { head: "never-pushed" }),
    /origin has no branch `never-pushed`\. Push it first/,
  );
  refused(
    mcp(sid, { owner: "someone" }),
    /names the repository `someone\/r`, and origin here is `o\/r`/,
  );
  refused(mcp(sid, { repo: "elsewhere" }), /names the repository `o\/elsewhere`/);
  refused(mcp(sid, { head: "fork:feat" }), /another owner's repository/);
  refused(mcp(sid, { head: "fea*" }), /not a literal branch name/);
  refused(mcp(sid, { head: undefined }), /names no head branch/);
  refused(mcp(sid, {}, { cwd: undefined }), /names no cwd/);
  refused(mcp(sid, {}, { cwd: T }), /could not name the `origin` remote/);
  // GitHub ignores case in owner and repository, and owner:branch is this repository.
  allowed(mcp(sid, { owner: "O", repo: "R", head: "o:feat" }));
});

test("refuses an ls-remote answer that is not the one ref asked for", () => {
  // ls-remote matches its argument against the tail of each ref name.
  branch("amb");
  git(WORK, "push", "-q", "origin", "HEAD:refs/heads/refs/heads/amb");
  const sid = session();
  review(sid);
  refused(mcp(sid, { head: "amb" }), /did not answer with that one ref \(2 line\(s\)\)/);
});

test("refuses, on its own 15-second limit, when the remote does not answer", () => {
  branch("feat");
  const sid = session();
  review(sid);
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const slow = join(T, "slow-git");
  mkdirSync(slow);
  writeFileSync(
    join(slow, "git"),
    `#!/bin/sh\ncase " $* " in *" ls-remote "*) exec sleep 60 ;; esac\nexec ${real} "$@"\n`,
  );
  chmodSync(join(slow, "git"), 0o755);
  const started = Date.now();
  refused(mcp(sid), /did not answer within 15 seconds/, {
    env: { PATH: `${slow}:${process.env.PATH}` },
  });
  assert.ok(Date.now() - started < 40_000, "the guard waited on git past its own limit");
});

test(`a record it cannot read refuses and says why ${TAG}`, () => {
  branch("feat");
  // An unreadable line can hide an entry: said when the entry is missing.
  let sid = session();
  review(sid, ["code-review"]);
  writeFileSync(join(BASE, sid, "reviews.jsonl"), "{not json\n", { flag: "a" });
  writeFileSync(join(BASE, sid, "reviews.jsonl"), '{"kind":"checklist","sha":"short"}\n', {
    flag: "a",
  });
  refused(mcp(sid), [
    /checklist has not been read whole/,
    /2 unreadable line\(s\) in the review record/,
  ]);
  // It cannot invent one: the entries that parse still count.
  review(sid, ["checklist"]);
  allowed(mcp(sid));
  // The record is there and cannot be read at all.
  sid = session();
  mkdirSync(join(BASE, sid, "reviews.jsonl"), { recursive: true });
  refused(mcp(sid), /could not read the review record at .*reviews\.jsonl \(EISDIR\)/);
  refused(mcp(undefined), /no usable session_id/);
  refused(mcp("a/b"), /no usable session_id/);
  const open = join(T, "tmp-open-guard");
  const base = join(open, `barwise-exit-${process.getuid?.() ?? "user"}`);
  mkdirSync(base, { recursive: true });
  chmodSync(base, 0o755);
  refused(mcp(session()), /directory cannot be trusted: .*open to other users/, {
    env: { TMPDIR: open },
  });
});

test(`a tool call it cannot parse refuses: exit 2, never 0 or 1 ${TAG}`, () => {
  refused("not json", /could not be parsed, so it cannot be told from one that opens/);
  refused({ tool_name: "Bash", tool_input: {} }, /carries no command to read/);
  refused("null", /names no tool, so it cannot be told from one that opens/);
  refused(
    { tool_input: { command: "gh pr create --repo o/r --head feat" } },
    /names no tool, so it cannot be told from one that opens/,
  );
});

test("a call that opens nothing passes whatever the session state is", () => {
  for (
    const input of [
      { tool_name: "Read", tool_input: { file_path: "/x" } },
      { tool_name: "mcp__github__merge_pull_request", tool_input: { pullNumber: 1 } },
      bash(undefined, "ls -la"),
      bash(undefined, "gh pr list --repo o/r"),
      bash(undefined, "gh pr create --help"),
      bash(undefined, "gh pr create -h"),
      bash(undefined, "gh pr create --repo o/r --help | head -40"),
      bash(undefined, "gh api repos/o/r/pulls"),
      bash(undefined, "gh api -X GET repos/o/r/pulls -f state=open"),
      bash(undefined, "gh api -XGET repos/o/r/pulls -f state=open"),
      bash(undefined, "gh api 'repos/o/r/pulls?state=open&per_page=5'"),
      bash(undefined, "gh api --method=get repos/o/r/pulls --field=state=open"),
      bash(undefined, "gh pr create --fill --help"),
      bash(undefined, "gh pr create --repo o/r --head feat --label x -h"),
      bash(undefined, "gh api graphql -f query='{ viewer { login } }'"),
      bash(undefined, "git commit -m 'explain gh pr create --head x'"),
      bash(undefined, "cat <<'EOF' > notes.md\ngh pr create --head feat\nEOF"),
      bash(undefined, 'grep -rn "gh pr create" docs'),
    ]
  ) allowed(input);
});

// -------------------------------------------------------------- override

test(`an Opened-without-review line allows the call and is logged ${TAG}`, () => {
  const sid = session();
  const body = 'Why.\n\nOpened-without-review: "open it now" (owner, 2026-11-24)\n\nMore.';
  // No pushed branch is needed: the override is read before the head is resolved.
  allowed(mcp(sid, { head: "not-pushed-yet", body }));
  const [e] = recorded(sid);
  assert.deepEqual(
    { kind: e.kind, head: e.head, text: e.text },
    { kind: "override", head: "not-pushed-yet", text: '"open it now" (owner, 2026-11-24)' },
  );
});

test(`an override with no text, or one that cannot be logged, is refused ${TAG}`, () => {
  branch("feat");
  refused(mcp(session(), { body: "Opened-without-review:   \n" }), /has no text/);
  refused(mcp(undefined, { body: "Opened-without-review: go" }), [
    /no usable session_id/,
    /so the override cannot be logged/,
  ]);
});

test(`a body that only shows the key is not an override ${TAG}`, () => {
  branch("feat");
  const bodies = [
    "The key is `Opened-without-review:` and it goes in the body.",
    "  Opened-without-review: indented, so not at the start of a line",
    "```\nOpened-without-review: in a fence\n```",
    "~~~\nOpened-without-review: in a tilde fence\n~~~",
    "```text\nOpened-without-review: in an unclosed fence",
    "<!--\nOpened-without-review: in a comment, so never rendered\n-->",
    "<!-- a comment that opens\nOpened-without-review: and is still open\n",
    // A longer fence shows a shorter one: the inner fence does not close it.
    '````md\n```\nOpened-without-review: "quote the owner here"\n```\n````',
    "~~~~\n~~~\nOpened-without-review: in a tilde fence of four\n~~~\n~~~~",
    // A fence closes only on a line that is nothing but the fence.
    "```\n```js is not a closing line\nOpened-without-review: still fenced\n",
    // The line that closes one comment opens the next.
    "<!-- a --> x <!--\nhidden\n--> y <!--\nOpened-without-review: go\n-->",
  ];
  for (const body of bodies) {
    const sid = session();
    const r = refused(mcp(sid, { body }), /has not reviewed that commit/);
    assert.deepEqual(recorded(sid), [], body);
    // Said when the key starts a line that does not count, and only then.
    const atLineStart = /^Opened-without-review:/m.test(body);
    assert.equal(/inside a code block or an HTML comment/.test(r.stderr), atLineStart, body);
  }
  // A comment opener in an inline code span is text, not a comment.
  const spans = session();
  allowed(
    mcp(spans, {
      body: "It counts outside an HTML comment (`<!--`).\n\nOpened-without-review: owner said go\n",
    }),
  );
  assert.equal(recorded(spans)[0].text, "owner said go");
  // After the fence or the comment closes, the line counts again.
  const sid = session();
  allowed(mcp(sid, { body: "```\ncode\n```\n<!-- note -->\nOpened-without-review: yes, go\n" }));
  assert.equal(recorded(sid)[0].text, "yes, go");
});

// ------------------------------------------------------------------ Bash

test(`the literal gh pr create form is held to the record like the MCP call ${TAG}`, () => {
  const sha = branch("feat");
  const sid = session();
  refused(bash(sid, LITERAL("feat")), new RegExp(`would propose ${sha}`));
  review(sid);
  const file = join(T, "body.md");
  writeFileSync(file, "A body.\n");
  for (
    const command of [
      LITERAL("feat"),
      `${LITERAL("feat")}\n`,
      "gh pr new -R o/r -H feat -B main -t 'T' -b 'B' -d",
      `gh pr create --repo=o/r --head=feat --title='It works (barwise-953)' --body-file=${file}`,
      "gh pr create --head feat --repo O/R --draft",
    ]
  ) allowed(bash(sid, command));
});

test(`the literal form's body carries the override, from --body or --body-file ${TAG}`, () => {
  const file = join(T, "override.md");
  writeFileSync(file, "Text.\n\nOpened-without-review: owner said so\n");
  let sid = session();
  allowed(bash(sid, `gh pr create --repo o/r --head nowhere --title 'T' --body-file ${file}`));
  assert.deepEqual(recorded(sid).map((e) => [e.kind, e.head, e.text]), [
    ["override", "nowhere", "owner said so"],
  ]);
  sid = session();
  allowed(bash(sid, "gh pr create --repo o/r --head nowhere --body 'Opened-without-review: go'"));
  assert.equal(recorded(sid)[0].text, "go");
  refused(
    bash(session(), `gh pr create --repo o/r --head feat --body-file ${join(T, "absent.md")}`),
    /could not read --body-file .*absent\.md \(ENOENT\)/,
  );
});

test(`a gh pr create that is almost the literal form is refused with the reason ${TAG}`, () => {
  branch("feat");
  const sid = session();
  review(sid);
  const cases = [
    ["gh pr create --head feat", /--repo is required/],
    ["gh pr create --repo o/r", /--head is required/],
    ["gh pr create --repo o/r --head feat --head other", /--head is given more than once/],
    ["gh pr create --repo o/r -H feat --head=other", /--head is given more than once/],
    ["gh pr create --repo o/r --head feat --fill", /`--fill` is not part of the literal form/],
    ["gh pr create --repo o/r --head feat --web", /`--web` is not part of the literal form/],
    [
      "gh pr create --repo o/r --head feat --dry-run",
      /`--dry-run` is not part of the literal form/,
    ],
    ["gh pr create --repo o/r --head feat extra", /`extra` is not part of the literal form/],
    ["gh pr create --repo o/r --head feat --title", /--title has no value/],
    ["gh pr create --repo o/r --head feat --body-file body.md", /must be an absolute path/],
    ["gh pr create --repo o/r --head feat --body-file -", /must be an absolute path/],
    ["gh pr create --repo o/r --head feat --body 'b' -F /tmp/b", /both given/],
    [
      "gh pr create --repo x/y --head feat",
      /names the repository `x\/y`, and origin here is `o\/r`/,
    ],
  ];
  for (const [command, why] of cases) refused(bash(sid, command), why);
});

test(`every other gh opening the shared parser sees is refused, reviewed or not ${TAG}`, () => {
  branch("feat");
  const sid = session();
  review(sid);
  for (
    const command of [
      `git push origin feat && ${LITERAL("feat")}`,
      `${LITERAL("feat")}; echo done`,
      `${LITERAL("feat")} 2>&1`,
      `${LITERAL("feat")} | cat`,
      `GH_REPO=o/r ${LITERAL("feat")}`,
      `env ${LITERAL("feat")}`,
      `sh -c "${LITERAL("feat", "")}"`,
      `echo $(${LITERAL("feat", "")})`,
      'gh pr create --repo o/r --head feat --title "T" --body "B"',
      'gh pr create --repo o/r --head "$BRANCH"',
      "gh pr create --repo o/r --head feat --body \"$(cat <<'EOF'\nbody\nEOF\n)\"",
      "gh -R o/r pr create --head feat",
      "/usr/bin/gh pr create --repo o/r --head feat",
      "gh api repos/o/r/pulls -f head=feat -f base=main -f title=t",
      "gh api /repos/o/r/pulls -f head=feat -f base=main -f title=t",
      "gh api repos/{owner}/{repo}/pulls -X POST --input pr.json",
      "gh api -X POST repos/o/r/pulls",
      "gh api -XPOST repos/o/r/pulls",
      "gh api -X POST 'repos/o/r/pulls?per_page=1' --input pr.json",
      "gh api repos/o/r/pulls --field=title=T --field=head=feat --field=base=main",
      "gh api repos/o/r/pulls --raw-field=title=T --raw-field=head=feat",
      "gh api repos/o/r/pulls -ftitle=T -fhead=feat -fbase=main",
      "gh api repos/o/r/pulls -Fdraft=true -fhead=feat",
      "gh api repos/o/r/pulls --input=pr.json",
      "gh api https://api.github.com/repos/o/r/pulls -f title=T -f head=feat -f base=main",
      "gh api graphql -f query='mutation { createPullRequest(input: {}) { clientMutationId } }'",
    ]
  ) {
    refused(bash(sid, command), [
      /the guard reads one form only/,
      /gh pr create --repo <owner>\/<repo> --head <branch>/,
    ]);
  }
});

test("the forms the shared parser does not see pass unguarded: the stated limits", () => {
  // Pinned so that the limits lib/gh-command.mjs and the spec list are the
  // real ones. A parser change that closes one fails here, and the list
  // changes with it; this is not a promise that these should pass.
  branch("feat");
  const open = "gh pr create --repo o/r --head feat";
  for (
    const command of [
      `timeout 60 ${open}`,
      `env -C /wt ${open}`,
      `if git push origin feat; then ${open}; fi`,
      `git push && { ${open}; }`,
      `git push && ( ${open} )`,
      `! ${open}`,
      `bash -lc "${open}"`,
      `echo "see <<EOF"\n${open}`,
      `xargs ${open}`,
      `eval "${open}"`,
      "$GH pr create --repo o/r --head feat",
    ]
  ) allowed(bash(session(), command));
});

// ---------------------------------------------------------------- wiring

test(`settings.json wires the guard to the opening calls and the recorder to Skill and Read ${TAG}`, () => {
  const settings = JSON.parse(readFileSync(join(ROOT, ".claude", "settings.json"), "utf8"));
  const wired = (event, script, names) => {
    const entries = settings.hooks[event].filter((e) =>
      e.hooks.some((h) => h.type === "command" && h.command.includes(`hooks/${script}`))
    );
    for (const name of names) {
      assert.ok(
        entries.some((e) => new RegExp(`^(?:${e.matcher})$`).test(name)),
        `no ${event} entry running ${script} matches ${name}`,
      );
    }
    for (const e of entries) {
      for (const h of e.hooks.filter((h) => h.command.includes(`hooks/${script}`))) {
        assert.ok(h.command.startsWith("env -u BARWISE_EXIT_DIR node "), h.command);
      }
    }
  };
  wired("PreToolUse", "pr-open-guard.mjs", ["mcp__github__create_pull_request", "Bash"]);
  wired("PostToolUse", "review-recorder.mjs", ["Skill", "Read"]);
});
