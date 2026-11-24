#!/usr/bin/env node
/**
 * Claude Code PreToolUse hook: refuse to open a pull request on a commit
 * this session has not reviewed (review-policy decision
 * `review-before-open`; docs/specs/review-before-open.spec.md). The
 * counterpart, at the opening end, of merge-guard.mjs at the merge end.
 *
 * A call that opens a pull request is allowed when the session's review
 * record (lib/review-record.mjs, written by review-recorder.mjs) holds a
 * `code-review` entry and a `checklist` entry on the commit the pull
 * request proposes: the tip of the head branch on the remote, asked with
 * `git ls-remote` at the moment of the call. A commit made after a review
 * has another sha, so a run on an earlier commit does not count.
 *
 * The owner's instruction to open without review is a body line starting
 * `Opened-without-review:` with text after it. It is logged to the record
 * and allowed; the body itself is the lasting log.
 *
 * Which calls: the GitHub MCP create tool, and in Bash one literal form of
 * `gh pr create`. What a shell command will make gh do cannot be read off
 * its text (the guard runs before any of it does), so the guard does not
 * try: the literal form is a sublanguage in which the shell expands
 * nothing, every other opening the shared parser sees is refused, and the
 * forms that parser does not see pass unguarded and are listed in
 * lib/gh-command.mjs. The guard holds the paths a session takes by
 * default; it is not a boundary against a command built to get round it.
 *
 * Exit 2 blocks and hands stderr to the agent, and is the only refusal:
 * a state the guard cannot read (the tool call, the session id, the
 * record, the remote) refuses and says which, never 0 or 1
 * (docs/adr/gate-refusal-contract.md).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { checkBase, exitBase, SESSION_ID } from "../lib/exit-log.mjs";
import { flagValue, ghCalls, repoFromRemote, subcommand } from "../lib/gh-command.mjs";
import {
  appendReview,
  CHECKLIST,
  checklistPath,
  COMMIT,
  readReviews,
  reviewLogPath,
} from "../lib/review-record.mjs";

/**
 * The remote read's limit. Measured at 0.6 s through this session's proxy;
 * fifteen is more than ten times that, and short enough that a stalled
 * proxy costs a quarter of a minute and not a hung turn. The guard sets it
 * itself because what the harness does with a hook that outlives the
 * harness's own timeout was not measured.
 */
const REMOTE_MS = 15_000;
const OVERRIDE = "Opened-without-review:";
const LITERAL_FORM = [
  "  gh pr create --repo <owner>/<repo> --head <branch> [--base <branch>]",
  "               [--title '<text>'] [--body '<text>' | --body-file <absolute path>]",
  "               [--draft]",
  "  as the whole command: plain words and single-quoted strings only, each flag",
  "  once, nothing before `gh`, no other command, no double quotes, `$`, or redirect.",
].join("\n");

function refuse(...reasons) {
  console.error(`pr-open-guard: refused.\n${reasons.map((r) => `  - ${r}`).join("\n")}`);
  process.exit(2);
}

/**
 * The words of a command written in the literal sublanguage, or null when
 * it is not. Words are separated by spaces and built only from plain
 * characters and single-quoted strings; anything else outside single
 * quotes (a double quote, `$`, a backtick, a backslash, an operator, a
 * glob, a newline) puts the command outside it. Inside it the shell
 * expands nothing and starts one program with exactly these words, so
 * reading the command is splitting it.
 */
function literalWords(command) {
  const words = [];
  let word = null;
  for (let i = 0; i < command.length; i++) {
    const c = command[i];
    if (c === "'") {
      const end = command.indexOf("'", i + 1);
      if (end < 0) return null;
      word = (word ?? "") + command.slice(i + 1, end);
      i = end;
    } else if (c === " ") {
      if (word !== null) words.push(word);
      word = null;
    } else if (/[A-Za-z0-9_./:=@,+%-]/.test(c)) word = (word ?? "") + c;
    else return null;
  }
  if (word !== null) words.push(word);
  return words;
}

const VALUE_FLAGS = new Map([
  ["--repo", "repo"],
  ["-R", "repo"],
  ["--head", "head"],
  ["-H", "head"],
  ["--base", "base"],
  ["-B", "base"],
  ["--title", "title"],
  ["-t", "title"],
  ["--body", "body"],
  ["-b", "body"],
  ["--body-file", "bodyFile"],
  ["-F", "bodyFile"],
]);
const SWITCHES = new Map([["--draft", "draft"], ["-d", "draft"]]);

/**
 * The flags of a literal `gh pr create`, as `{ fault }` or `{ flags }`. Strict on purpose: a flag outside the form, a repeat, or a
 * stray word is a fault, because gh would read a repeat as its last value
 * and this reads it as the first.
 */
function literalFlags(rest) {
  const flags = {};
  const set = (key, value, spelled) => {
    if (key in flags) return `${spelled} is given more than once`;
    flags[key] = value;
    return null;
  };
  for (let i = 0; i < rest.length; i++) {
    const w = rest[i];
    let fault;
    const eq = w.startsWith("--") ? w.indexOf("=") : -1;
    if (SWITCHES.has(w)) fault = set(SWITCHES.get(w), true, w);
    else if (eq > 0 && VALUE_FLAGS.has(w.slice(0, eq))) {
      fault = set(VALUE_FLAGS.get(w.slice(0, eq)), w.slice(eq + 1), w.slice(0, eq));
    } else if (VALUE_FLAGS.has(w)) {
      if (i + 1 >= rest.length) return { fault: `${w} has no value` };
      fault = set(VALUE_FLAGS.get(w), rest[++i], w);
    } else return { fault: `\`${w}\` is not part of the literal form` };
    if (fault) return { fault };
  }
  if (!flags.repo) return { fault: "--repo is required: without it gh chooses the repository" };
  if (!flags.head) {
    return {
      fault: "--head is required: without it gh proposes the current branch's upstream",
    };
  }
  if (flags.body !== undefined && flags.bodyFile !== undefined) {
    return { fault: "--body and --body-file are both given" };
  }
  if (flags.bodyFile !== undefined && !isAbsolute(flags.bodyFile)) {
    return { fault: "--body-file must be an absolute path to a file" };
  }
  return { flags };
}

/** `--help` or `-h` as a flag of `gh pr create`, not as another flag's value. */
function asksForHelp(rest) {
  const valued = new Set([...VALUE_FLAGS.keys()].concat([
    "-a",
    "--assignee",
    "-l",
    "--label",
    "-m",
    "--milestone",
    "-p",
    "--project",
    "-r",
    "--reviewer",
    "-T",
    "--template",
    "--recover",
  ]));
  for (let i = 0; i < rest.length; i++) {
    if (valued.has(rest[i])) i++;
    else if (rest[i] === "--help" || rest[i] === "-h") return true;
  }
  return false;
}

/** Whether the shared parser finds a pull-request-opening gh call in the command. */
function parserSeesOpening(command) {
  for (const args of ghCalls(command)) {
    const { words, at } = subcommand(args);
    if (words[0] === "pr" && (words[1] === "create" || words[1] === "new")) {
      if (!asksForHelp(args.slice(at[1] + 1))) return true;
    } else if (words[0] === "api" && words[1] === "graphql") {
      if (args.some((a) => /createPullRequest/.test(a))) return true;
    } else if (words[0] === "api") {
      // The endpoint, with or without a leading slash, a host before it or a
      // query after it.
      const pulls = /(?:^|\/)repos\/[^/]+\/[^/]+\/pulls\/?(?:\?.*)?$/;
      if (!words.slice(1).some((w) => pulls.test(w))) continue;
      // gh sends POST once a field or an input is given; a bare path, or
      // an explicit GET, lists. Every spelling counts: `-f k=v`, `-fk=v`,
      // `--field=k=v`, `-XPOST`.
      const method = flagValue(args, ["--method", "-X"])
        ?? args.find((a) => /^-X./.test(a))?.slice(2);
      const sends = args.some((a) => /^(-[fF]|--field|--raw-field|--input)/.test(a));
      if (method ? !/^get$/i.test(method) : sends) return true;
    }
  }
  return false;
}

/**
 * What the tool call would open: null for a call that opens nothing, else
 * `{ slug, head, body, bodyFile }`. Refuses a Bash opening that is not the
 * literal form. Reads no session state: a call that opens nothing passes
 * whatever state the record is in.
 */
function opening(input) {
  const ti = input.tool_input ?? {};
  if (input.tool_name === "mcp__github__create_pull_request") {
    return { slug: `${ti.owner}/${ti.repo}`, head: ti.head, body: ti.body };
  }
  if (input.tool_name !== "Bash") return null;
  if (typeof ti.command !== "string") {
    refuse("the Bash tool call carries no command to read, so it cannot be told from an opening");
  }
  const words = literalWords(ti.command.trim());
  const literal = words?.[0] === "gh" && words[1] === "pr"
    && (words[2] === "create" || words[2] === "new");
  if (!literal) {
    if (!parserSeesOpening(ti.command)) return null;
    refuse(
      "this command opens a pull request with gh, and the guard reads one form only, because it runs before any of the command does and cannot tell what the rest of it will change:\n"
        + LITERAL_FORM,
      "`gh api` has no accepted form. Run the push, or anything else, as a command of its own first.",
    );
  }
  // Asked first, as on the other path: a call for help opens nothing,
  // whatever else it carries.
  if (asksForHelp(words.slice(3))) return null;
  const parsed = literalFlags(words.slice(3));
  if (parsed.fault) refuse(`${parsed.fault}. The form the guard reads:\n${LITERAL_FORM}`);
  const { repo, head, body, bodyFile } = parsed.flags;
  return { slug: repo, head, body, bodyFile };
}

/**
 * The override in a pull request body: `{ text }` for a line that counts,
 * `{ hidden: true }` when the key starts a line only where it does not
 * count, else `{}`. A line counts when it starts with the key outside a
 * fenced code block and outside an HTML comment, where it would be
 * accepted and never rendered. A body that documents the key inline or in
 * a code block is not an override.
 *
 * Fences follow CommonMark: opened by three or more backticks or tildes,
 * closed only by a line of at least as many of the same character and
 * nothing else, so a longer fence can show a shorter one; unclosed, it
 * runs to the end. A comment opener inside an inline code span is text.
 */
function overrideIn(body) {
  let fence = null;
  let comment = false;
  let hidden = false;
  for (const line of body.split(/\r?\n/)) {
    if (fence) {
      const closes = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
      if (closes && closes[1][0] === fence[0] && closes[1].length >= fence.length) fence = null;
      else if (line.startsWith(OVERRIDE)) hidden = true;
      continue;
    }
    const startsInComment = comment;
    if (!comment) {
      const opens = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (opens) {
        fence = opens[1];
        continue;
      }
    }
    // Walk the line's comment markers, so one that closes a comment and
    // opens the next leaves the state open.
    const text = line.replace(/`[^`]*`/g, "");
    for (let at = 0;;) {
      const next = text.indexOf(comment ? "-->" : "<!--", at);
      if (next < 0) break;
      at = next + (comment ? 3 : 4);
      comment = !comment;
    }
    if (!line.startsWith(OVERRIDE)) continue;
    if (startsInComment) hidden = true;
    else return { text: line.slice(OVERRIDE.length).trim() };
  }
  return hidden ? { hidden: true } : {};
}

/** The commit `head` points at on origin, asked now. Refuses when it cannot tell. */
function remoteTip(cwd, head) {
  const ref = `refs/heads/${head}`;
  const r = spawnSync("git", ["ls-remote", "origin", ref], {
    cwd,
    encoding: "utf8",
    timeout: REMOTE_MS,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.error?.code === "ETIMEDOUT" || r.signal) {
    refuse(
      `\`git ls-remote origin ${ref}\` did not answer within ${
        REMOTE_MS / 1000
      } seconds, so the commit this pull request would propose is unknown`,
    );
  }
  if (r.error || r.status !== 0) {
    refuse(
      `\`git ls-remote origin ${ref}\` failed (${
        r.error?.message || r.stderr.trim().split("\n")[0] || `exit ${r.status}`
      }), so the commit this pull request would propose is unknown`,
    );
  }
  const lines = r.stdout.split("\n").filter(Boolean).map((l) => l.split("\t"));
  if (lines.length === 0) {
    refuse(`origin has no branch \`${head}\`. Push it first: the guard checks the pushed commit`);
  }
  // ls-remote matches its argument as a glob against the tail of each ref
  // name, so more than one line, or another name, is not an answer.
  if (lines.length !== 1 || lines[0][1] !== ref || !COMMIT.test(lines[0][0])) {
    refuse(
      `\`git ls-remote origin ${ref}\` did not answer with that one ref (${lines.length} line(s)), so the commit this pull request would propose is unknown`,
    );
  }
  return lines[0][0];
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  refuse(
    "the tool call on stdin could not be parsed, so it cannot be told from one that opens a pull request",
  );
}

if (input === null || typeof input !== "object" || typeof input.tool_name !== "string") {
  refuse(
    "the tool call on stdin names no tool, so it cannot be told from one that opens a pull request",
  );
}

const call = opening(input);
if (call === null) process.exit(0);

// From here the call opens a pull request, and every state the guard
// cannot read is a refusal.
const cwd = input.cwd;
if (typeof cwd !== "string") refuse("the hook input names no cwd to read git in");
const sid = input.session_id;
const base = exitBase();
/** Why this session's record cannot be used, or null. Reported only on the path that needs it. */
function recordFault() {
  if (typeof sid !== "string" || !SESSION_ID.test(sid)) {
    return "the hook input has no usable session_id, so this session's review record cannot be found";
  }
  try {
    checkBase(base);
    return null;
  } catch (err) {
    return `the review record's directory cannot be trusted: ${err.message}`;
  }
}
const sessionFault = recordFault();

if (typeof call.head !== "string" || call.head === "") {
  refuse("the call names no head branch");
}

let body = call.body ?? "";
if (call.bodyFile !== undefined) {
  try {
    body = readFileSync(call.bodyFile, "utf8");
  } catch (err) {
    refuse(`could not read --body-file ${call.bodyFile} (${err.code ?? err.message})`);
  }
}
if (typeof body !== "string") refuse("the call's body is not text");

const { text: override, hidden: overrideHidden } = overrideIn(body);
if (override !== undefined) {
  if (override === "") {
    refuse(
      `the body's \`${OVERRIDE}\` line has no text, and an override with no text records no instruction. Quote the owner's instruction after the colon`,
    );
  }
  if (sessionFault) refuse(`${sessionFault}, so the override cannot be logged`);
  try {
    appendReview(base, sid, { t: Date.now(), kind: "override", head: call.head, text: override });
  } catch (err) {
    refuse(`the override could not be logged to the review record (${err.message})`);
  }
  process.exit(0);
}

if (sessionFault) refuse(sessionFault);

const origin = repoFromRemote(cwd);
if (origin === null) refuse(`git could not name the \`origin\` remote in ${cwd}`);
const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();
if (!same(call.slug, `${origin.owner}/${origin.repo}`)) {
  refuse(
    `the call names the repository \`${call.slug}\`, and origin here is \`${origin.owner}/${origin.repo}\`: the guard can resolve a head only on origin`,
  );
}
let head = call.head;
const colon = head.indexOf(":");
if (colon >= 0) {
  if (!same(head.slice(0, colon), origin.owner)) {
    refuse(
      `the head \`${head}\` is in another owner's repository, which the guard cannot resolve from origin`,
    );
  }
  head = head.slice(colon + 1);
}
if (head === "" || /[*?[\\]/.test(head)) {
  refuse(`the head \`${call.head}\` is not a literal branch name`);
}
const proposed = remoteTip(cwd, head);

let record;
try {
  record = readReviews(base, sid);
} catch (err) {
  refuse(
    `could not read the review record at ${reviewLogPath(base, sid)} (${err.code ?? err.message})`,
  );
}
const on = (kind) => record.entries.filter((e) => e.kind === kind);
const missing = ["code-review", "checklist"].filter((kind) =>
  !on(kind).some((e) => e.sha === proposed)
);
if (missing.length === 0) process.exit(0);

const last = (kind) => {
  const sha = on(kind).at(-1)?.sha;
  return sha ? `last recorded on ${sha.slice(0, 12)}` : "never recorded in this session";
};
const checklist = checklistPath(cwd) ?? CHECKLIST;
const steps = {
  "code-review": `\`/code-review\` has not returned on that commit (${
    last("code-review")
  }). Invoke the code-review skill with the Skill tool`,
  checklist: `the pr-review checklist has not been read whole on that commit (${
    last("checklist")
  }). Read ${checklist} with the Read tool, no offset or limit, in the main conversation, and work through it`,
};
refuse(
  `this pull request would propose ${proposed} (the tip of \`${head}\` on origin), and this session has not reviewed that commit. A step run on an earlier commit does not count`,
  ...missing.map((kind) => steps[kind]),
  ...(record.unreadable > 0
    ? [
      `${record.unreadable} unreadable line(s) in the review record; a step may have been recorded there`,
    ]
    : []),
  ...(overrideHidden
    ? [
      `the body has a line starting \`${OVERRIDE}\` inside a code block or an HTML comment, where it is not rendered and does not count`,
    ]
    : []),
  `when the owner has said to open it without review, quote the instruction in the body on a line starting \`${OVERRIDE}\`. The pr-creation skill has the rest of the readiness gate`,
);
