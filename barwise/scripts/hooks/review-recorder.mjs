#!/usr/bin/env node
/**
 * Claude Code PostToolUse hook: records that a review step happened, and
 * on which commit (docs/specs/review-before-open.spec.md). pr-open-guard.mjs
 * reads the record before a pull request opens.
 *
 * Two events are recorded, each with `git rev-parse HEAD` in the event's
 * cwd:
 *   - the Skill tool returned for `code-review` with success. That skill
 *     runs forked, so the event fires when the review comes back;
 *   - the Read tool returned all of .claude/skills/pr-review/checklist.md
 *     to the main conversation. A partial read cannot be told from reading
 *     the headings, and a subagent's read (it carries the parent's session
 *     id and an agent_id) is not this session running the checklist.
 *
 * It records that the step happened on that commit. What a review found,
 * whether its findings were fixed, and whether the checklist was applied
 * are not seen; the spec lists the rest.
 *
 * Every other event exits 0 in silence: this runs after every Read and
 * Skill call. A matching event that cannot be recorded exits 2, which
 * PostToolUse shows the model and which blocks nothing: the guard would
 * otherwise refuse later with nothing saying why the record is empty.
 */
import { readFileSync, realpathSync } from "node:fs";
import { checkBase, exitBase, SESSION_ID } from "../lib/exit-log.mjs";
import { appendReview, CHECKLIST, checklistPath, COMMIT, gitLine } from "../lib/review-record.mjs";

function cannot(why) {
  console.error(
    `review-recorder: could not record this review step -- ${why}.\n`
      + "pr-open-guard will refuse to open a pull request on it "
      + "(docs/specs/review-before-open.spec.md).",
  );
  process.exit(2);
}

const real = (p) => {
  try {
    return realpathSync(p);
  } catch {
    return null;
  }
};

/** "code-review", "checklist", or null for an event that is neither. */
function kindOf(input) {
  if (input?.hook_event_name !== "PostToolUse") return null;
  const ti = input.tool_input ?? {};
  if (input.tool_name === "Skill") {
    return ti.skill === "code-review" && input.tool_response?.success === true
      ? "code-review"
      : null;
  }
  if (input.tool_name !== "Read" || typeof ti.file_path !== "string") return null;
  // The cheap test first: this runs on every Read, and git is asked only
  // about a file that could be the checklist.
  if (!ti.file_path.replaceAll("\\", "/").endsWith(`/${CHECKLIST}`)) return null;
  if (input.agent_id !== undefined) return null;
  const f = input.tool_response?.file;
  const whole = Number.isInteger(f?.totalLines) && f.totalLines > 0 && f.startLine === 1
    && f.numLines === f.totalLines;
  if (!whole) return null;
  if (typeof input.cwd !== "string") cannot("the hook input names no cwd");
  const expected = checklistPath(input.cwd);
  if (expected === null) {
    cannot(`git could not name the repository root in ${input.cwd}`);
  }
  // Another checkout's copy is a different file: not this repository's checklist.
  return real(ti.file_path) !== null && real(ti.file_path) === real(expected) ? "checklist" : null;
}

let input;
try {
  input = JSON.parse(readFileSync(0, "utf8"));
} catch {
  cannot("the hook input on stdin could not be parsed");
}

const kind = kindOf(input);
if (kind === null) process.exit(0);

const sid = input.session_id;
if (typeof sid !== "string" || !SESSION_ID.test(sid)) {
  cannot("the hook input has no usable session_id");
}
if (typeof input.cwd !== "string") cannot("the hook input names no cwd");
const sha = gitLine(input.cwd, ["rev-parse", "--verify", "HEAD^{commit}"]);
if (sha === null || !COMMIT.test(sha)) cannot(`git could not name HEAD in ${input.cwd}`);
try {
  const base = exitBase();
  checkBase(base);
  appendReview(base, sid, { t: Date.now(), kind, sha });
} catch (err) {
  cannot(err.message);
}
process.exit(0);
