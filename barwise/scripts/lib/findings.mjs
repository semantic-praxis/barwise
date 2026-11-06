/**
 * One reader over the five audit baselines (docs/specs/audit-finding-reader.spec.md).
 *
 * Each ratchet keeps its file, its row key and its vocabulary; an adapter
 * per source maps a row to one shape, so the rules about findings are
 * stated once (check:findings) instead of once per ratchet:
 *
 *   { id, source, state, issue, classification, vocabulary, note }
 *
 *   state           "open"         the row names an issue that must stay live
 *                   "classified"   a recorded verdict that needs no issue
 *                   "unclassified" the writer's placeholder is still there
 *   classification  the audit's own word for the verdict
 *   vocabulary      the Set it must belong to, or null when the verdict is
 *                   free text (a spec-status note)
 *
 * Each source's placeholder test and vocabulary live here and nowhere
 * else: the ratchet scripts import them, so a value is added in one place.
 *
 * Reading only. An absent or malformed file, or a row an adapter cannot
 * map, throws, so a gate built on this refuses (exit 2) rather than
 * reading a file it could not see as clean.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMap } from "./architecture-section.mjs";

/** audit:corrections' verdicts: how a correction was caught, a taxonomy. */
export const CAUGHT_BY = new Set([
  // Implementing it, writing the test, re-running a count, probing a
  // tool, mutation, replaying recorded eval data.
  "execution",
  // An objection raised, a question asked, a reviewer's request --
  // before or without running anything.
  "reasoning",
  // Writing the claim down with the command that produced it, which is
  // what exposed the claim.
  "provenance",
  // The detector surfaced a paragraph that records no correction.
  "not-a-correction",
]);

/** audit:specs' placeholder: no note, or the writer's `TODO: classify` / `TODO: re-read`. */
export const isSpecNotePlaceholder = (note) => !note || note.startsWith("TODO");

/**
 * trial:gate's placeholder. The README's contract for a classified row is
 * a note and an issue (and, for a defect, a reproduction, which the gate
 * itself checks), so a row missing either is unclassified.
 */
export const isTrialRowUnclassified = (row) =>
  !row.note || /^\(unclassified\)/.test(row.note) || !row.issue;

/** audit:duplication's and audit:rubric's two verdicts. */
const BENIGN_OR_TRACKED = new Set(["accepted-benign", "tracked"]);

/** `tracked:<issue>` at the start of a status or verdict, and the issue it names. */
const trackedIssue = (text) => /^tracked:([\w.-]+)/.exec(text)?.[1] ?? null;

const fail = (source, id, why) => {
  throw new Error(`${source}: row ${id} ${why}`);
};

const SOURCES = [
  {
    source: "duplication",
    file: "audit-baseline.json",
    key: "candidates",
    map(id, row) {
      if (row.status === undefined || row.status === "") return { state: "unclassified" };
      if (typeof row.status !== "string") {
        fail(this.source, id, "has a status that is not a string");
      }
      const issue = trackedIssue(row.status);
      return {
        state: issue ? "open" : "classified",
        issue,
        classification: issue ? "tracked" : row.status,
        vocabulary: BENIGN_OR_TRACKED,
        note: row.note,
      };
    },
  },
  {
    source: "rubric",
    file: "rubric-baseline.json",
    key: "checks",
    map(id, row) {
      if (typeof row.verdict !== "string") fail(this.source, id, "has no verdict string");
      if (row.verdict === "TODO") return { state: "unclassified" };
      const issue = trackedIssue(row.verdict);
      return {
        state: issue ? "open" : "classified",
        issue,
        // `accepted-benign: <reason>`, or `tracked:<issue> <reason>`.
        classification: row.verdict.split(":")[0],
        vocabulary: BENIGN_OR_TRACKED,
        note: row.verdict,
      };
    },
  },
  {
    source: "specs",
    file: "spec-status-baseline.json",
    key: "specs",
    map(id, row) {
      if (row.note !== undefined && typeof row.note !== "string") {
        fail(this.source, id, "has a note that is not a string");
      }
      if (isSpecNotePlaceholder(row.note)) return { state: "unclassified" };
      // The verdict is the note itself; issues it mentions are prose, not
      // claims the gate checks (the spec's Open decision 2).
      return { state: "classified", classification: row.note, vocabulary: null, note: row.note };
    },
  },
  {
    source: "corrections",
    file: "correction-baseline.json",
    key: "records",
    map(id, row) {
      if (typeof row.caught_by !== "string") fail(this.source, id, "has no caught_by string");
      if (row.caught_by.startsWith("TODO")) return { state: "unclassified" };
      return {
        state: "classified",
        classification: row.caught_by,
        vocabulary: CAUGHT_BY,
        note: row.note,
      };
    },
  },
  {
    source: "trial",
    file: "trial-baseline.json",
    key: "findings",
    map(id, row, { catalogClasses }) {
      if (isTrialRowUnclassified(row)) return { state: "unclassified" };
      return {
        state: "open",
        issue: row.issue,
        classification: row.class,
        vocabulary: catalogClasses,
        note: row.note,
      };
    },
  },
];

/** The trial catalog's classes, `{ id, issue }`, from `barwise/trial/findings/catalog.json`. */
export function readTrialCatalog(root) {
  const path = join(root, "barwise", "trial", "findings", "catalog.json");
  const json = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(json?.classes)) throw new Error(`${path}: no classes array`);
  return json.classes.map((c, i) => {
    if (typeof c?.id !== "string") throw new Error(`${path}: class ${i} has no id`);
    return { id: c.id, issue: typeof c.issue === "string" ? c.issue : null };
  });
}

/**
 * Every row of the five baselines in the common shape, in source order and
 * then the file's row order. Throws on an absent or malformed file, or a
 * row its adapter cannot map.
 */
export function readFindings(root) {
  const catalogClasses = new Set(readTrialCatalog(root).map((c) => c.id));
  const findings = [];
  for (const s of SOURCES) {
    const path = join(root, "barwise", s.file);
    const json = JSON.parse(readFileSync(path, "utf8"));
    const rows = json?.[s.key];
    if (!isMap(rows)) throw new Error(`${s.file}: no "${s.key}" object`);
    for (const [id, row] of Object.entries(rows)) {
      if (!isMap(row)) fail(s.source, id, "is not an object");
      const m = s.map(id, row, { catalogClasses });
      findings.push({
        id,
        source: s.source,
        state: m.state,
        issue: m.issue ?? null,
        classification: m.classification ?? null,
        vocabulary: m.vocabulary ?? null,
        note: m.note ?? null,
      });
    }
  }
  return findings;
}

/** The baseline file each source reads, for messages and tests. */
export const SOURCE_FILES = Object.fromEntries(SOURCES.map((s) => [s.source, s.file]));
