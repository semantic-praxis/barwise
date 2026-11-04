/**
 * What the tracker-conflicts workflow says on a pull request, decided
 * purely (docs/specs/tracker-conflict-comment.spec.md). The I/O -- the PR
 * list, the test merges, the comments -- is scripts/tracker-conflicts.mjs.
 *
 * Nothing here may echo text a pull request controls into a comment: the
 * comment is posted with a write token, and the driver's reasons quote
 * field names and values from the PR. Issues appear as an id that passes
 * SAFE_ID and a kind from REPORT_KINDS; a malformed file as a side and a
 * line number.
 */
import { INPUT_LABELS, REPORT_KINDS } from "./beads-merge.mjs";

export const TRACKER = ".beads/issues.jsonl";
export const BOT = "github-actions[bot]";

/** The marker that makes a comment this workflow's, with its episode state. */
export const marker = (state) => `<!-- barwise:tracker-conflict state=${state} -->`;
const MARKER_RE = /^<!-- barwise:tracker-conflict state=(open|closed) -->/;

/** Verdicts that call for a comment; the rest only close an open one. */
const COMMENTING = new Set(["resolves", "needs-person", "malformed"]);

/** An id printed in a comment: nothing that could be markdown, a mention or a marker. */
const SAFE_ID = /^[A-Za-z0-9._-]+$/;

/** The script calls resolveTracker(base, main, pr), so current is main and other is the PR. */
const SIDE = {
  [INPUT_LABELS.base]: "the merge base",
  [INPUT_LABELS.current]: "main",
  [INPUT_LABELS.other]: "this PR",
};

/**
 * The verdict for one PR (the spec's table), the one place the table's
 * rules live. `tracker` is a function returning what step 2 found, called
 * only when the tracker is the sole conflicted path, since step 2 costs
 * three blob reads: `{ reported: [{ id, kind }] }`,
 * `{ malformed: { label, lineNo } }`, or `{ needsHand: true }` when one
 * side deleted the file.
 */
export function verdict(conflictedPaths, trackerResult) {
  if (conflictedPaths.length === 0) return { verdict: "clean" };
  if (conflictedPaths.length !== 1 || conflictedPaths[0] !== TRACKER) return { verdict: "other" };
  const tracker = trackerResult();
  if (tracker.needsHand) return { verdict: "other" };
  if (tracker.malformed) return { verdict: "malformed", malformed: tracker.malformed };
  if (tracker.reported.length > 0) return { verdict: "needs-person", reported: tracker.reported };
  return { verdict: "resolves" };
}

/**
 * The episode state of a comment written by this workflow, or undefined
 * for any other comment. Only BOT's comments count, so a marker typed by
 * anyone else on the PR changes nothing.
 */
export function episodeState(comment) {
  if (comment?.user?.login !== BOT) return undefined;
  return MARKER_RE.exec(comment.body ?? "")?.[1];
}

/**
 * What to do on the PR: post a new comment, edit the open one, or
 * nothing. A new episode gets a new comment because GitHub sends no
 * notification for an edit; at most one comment is ever open.
 */
export function commentAction(v, comments) {
  const open = comments.filter((c) => episodeState(c) === "open").at(-1);
  if (COMMENTING.has(v.verdict)) {
    return open
      ? { action: "edit", commentId: open.id, previous: open.body, state: "open" }
      : { action: "post", state: "open" };
  }
  return open
    ? { action: "edit", commentId: open.id, previous: open.body, state: "closed" }
    : { action: "none" };
}

const MERGE_STEPS = [
  "```sh",
  "npm run prepare        # once per clone: installs the tracker merge driver",
  "git merge origin/main",
  "```",
].join("\n");

/** The comment body for a verdict; every line is built from this file's own text. */
export function commentBody(v, state, mainSha) {
  if (!/^[0-9a-f]{40}$/.test(mainSha)) {
    throw new Error(`not a commit sha: ${JSON.stringify(mainSha)}`);
  }
  const lines = [marker(state), ""];
  if (v.verdict === "resolves") {
    lines.push(
      "This PR conflicts with `main` only on `.beads/issues.jsonl`, and a local merge resolves it with no hand work:",
      "",
      MERGE_STEPS,
    );
  } else if (v.verdict === "needs-person") {
    const shown = v.reported.filter((r) => SAFE_ID.test(r.id) && REPORT_KINDS.includes(r.kind));
    const hidden = v.reported.length - shown.length;
    lines.push(
      "This PR conflicts with `main` only on `.beads/issues.jsonl`. A local merge resolves everything except these issues, which both sides changed in ways the driver will not decide:",
      "",
      ...shown.map((r) => `- \`${r.id}\`: ${r.kind}`),
      ...(hidden > 0 ? [`- and ${hidden} more this note does not name`] : []),
      "",
      MERGE_STEPS,
      "",
      "The merge leaves a conflict block for each; the steward skill, section 1, says how to resolve them.",
    );
  } else if (v.verdict === "malformed") {
    const side = SIDE[v.malformed.label] ?? "one side";
    const line = Number.isInteger(v.malformed.lineNo) ? ` at line ${v.malformed.lineNo}` : "";
    lines.push(
      `This PR conflicts with \`main\` only on \`.beads/issues.jsonl\`, but the tracker at ${side} is not valid${line}, so a local merge falls back to conflict markers on that file. Fix the line, then merge \`main\`.`,
    );
  } else if (v.verdict === "clean") {
    lines.push("Resolved: this PR no longer conflicts with `main`.");
  } else if (v.verdict === "elsewhere") {
    lines.push("This PR no longer targets `main`, so this note no longer applies.");
  } else if (v.verdict === "closed-pr") {
    lines.push("This PR is closed, so this note no longer applies.");
  } else {
    lines.push(
      "This PR now needs a hand merge with `main`: it conflicts on other files too, or on the tracker in a way the merge driver does not resolve.",
    );
  }
  lines.push(
    "",
    `<sub>Checked against \`main\` at \`${
      mainSha.slice(0, 8)
    }\` by the tracker-conflicts workflow (docs/specs/tracker-conflict-comment.spec.md).</sub>`,
  );
  return lines.join("\n");
}
