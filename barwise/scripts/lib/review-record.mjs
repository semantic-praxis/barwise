/**
 * The session's review record: what review-recorder.mjs writes when a
 * review step happens and pr-open-guard.mjs reads before a pull request
 * opens (docs/specs/review-before-open.spec.md).
 *
 * One file per session, `<base>/<session id>/reviews.jsonl`, beside the
 * exit log masked-exit keeps in the same directory (lib/exit-log.mjs owns
 * the base and the session-id shape). One JSON object per line, appended:
 *
 *   {"t": <ms>, "kind": "code-review", "sha": "<commit>"}
 *   {"t": <ms>, "kind": "checklist",   "sha": "<commit>"}
 *   {"t": <ms>, "kind": "override",    "head": "<branch>", "text": "..."}
 *
 * The layout lives here once, so the writer and the reader cannot disagree
 * about it.
 */
import { spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** The checklist, from the repository root. */
export const CHECKLIST = ".claude/skills/pr-review/checklist.md";

/** A full commit id: sha-1 today, sha-256 if the repository ever moves. */
export const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** How long a local git reading may take before it counts as no answer. */
const LOCAL_GIT_MS = 10_000;

export function reviewLogPath(base, session) {
  return join(base, session, "reviews.jsonl");
}

/** Appends one entry. Throws when it cannot; each hook owns its refusal. */
export function appendReview(base, session, entry) {
  mkdirSync(join(base, session), { recursive: true, mode: 0o700 });
  appendFileSync(reviewLogPath(base, session), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

function wellFormed(e) {
  if (!Number.isFinite(e?.t)) return false;
  if (e.kind === "code-review" || e.kind === "checklist") return COMMIT.test(e.sha ?? "");
  return e.kind === "override" && typeof e.head === "string" && typeof e.text === "string";
}

/**
 * Every entry the record holds, and how many lines it could not read. An
 * absent file is an empty record; any other failure to read it throws,
 * because "could not read" must not arrive as "nothing recorded".
 *
 * A line that parses is believed and one that does not is only counted:
 * an unreadable line can hide an entry and cannot invent one, so the
 * reader decides what the count means.
 */
export function readReviews(base, session) {
  let text;
  try {
    text = readFileSync(reviewLogPath(base, session), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return { entries: [], unreadable: 0 };
    throw err;
  }
  const entries = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    try {
      const e = JSON.parse(line);
      if (!wellFormed(e)) throw new Error("shape");
      entries.push(e);
    } catch {
      unreadable += 1;
    }
  }
  return { entries, unreadable };
}

/**
 * One line of git's output in `cwd`, or null when git failed, timed out or
 * printed nothing. Both hooks read local state through this, in the
 * directory the hook input names, never the process's own.
 */
export function gitLine(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: LOCAL_GIT_MS });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim() || null;
}

/** Where the checklist is for the repository `cwd` is in, or null. */
export function checklistPath(cwd) {
  const root = gitLine(cwd, ["rev-parse", "--show-toplevel"]);
  return root ? join(root, CHECKLIST) : null;
}
