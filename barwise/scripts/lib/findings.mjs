/**
 * One reader over the six baselines (docs/specs/audit-finding-reader.spec.md).
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
 *                   free text (a spec-status note) or not recorded (a trial
 *                   row classified by hand, with no catalog class)
 *   issue           for an open row, the issue it names, or null when it
 *                   says `tracked` and names none (a finding of its own)
 *   note            the reason; a recorded verdict needs one
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
// A leaf module: the ratchets and the trial gate import their rules from
// here, so it imports nothing else from scripts/lib.
const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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

/** check:merge-record's: the owner answered for a merge, or an issue holds it. */
const ACCEPTED_OR_TRACKED = new Set(["accepted-by-owner", "tracked"]);

/**
 * Whether a status or verdict says `tracked`, and the issue it names: the
 * `<issue>` of `tracked:<issue>`, or null when it says `tracked` and names
 * none (`tracked`, `tracked: soon`), which the gate reports rather than
 * reading the row as classified.
 */
const tracked = (text) =>
  /^tracked\b/.test(text) ? { issue: /^tracked:([\w.-]+)/.exec(text)?.[1] ?? null } : null;

const fail = (source, id, why) => {
  throw new Error(`${source}: row ${id} ${why}`);
};

/**
 * A row's verdict field: absent or empty is the writer's placeholder (a
 * finding, exit 1); present but not a string is a row nobody can read
 * (a refusal, exit 2).
 */
const verdictOf = (source, id, row, field) => {
  const v = row[field];
  if (v === undefined || v === "") return null;
  if (typeof v !== "string") fail(source, id, `has a ${field} that is not a string`);
  return v;
};

const SOURCES = [
  {
    source: "duplication",
    file: "audit-baseline.json",
    key: "candidates",
    map(id, row) {
      const status = verdictOf(this.source, id, row, "status");
      if (status === null) return { state: "unclassified" };
      const t = tracked(status);
      return {
        state: t ? "open" : "classified",
        issue: t?.issue,
        classification: t ? "tracked" : status,
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
      const verdict = verdictOf(this.source, id, row, "verdict");
      if (verdict === null || verdict === "TODO") return { state: "unclassified" };
      const t = tracked(verdict);
      return {
        state: t ? "open" : "classified",
        issue: t?.issue,
        // `accepted-benign: <reason>`, or `tracked:<issue> <reason>`.
        classification: verdict.split(":")[0],
        vocabulary: BENIGN_OR_TRACKED,
        note: verdict,
      };
    },
  },
  {
    source: "specs",
    file: "spec-status-baseline.json",
    key: "specs",
    map(id, row) {
      const note = verdictOf(this.source, id, row, "note");
      if (isSpecNotePlaceholder(note)) return { state: "unclassified" };
      // The verdict is the note itself; issues it mentions are prose, not
      // claims the gate checks (the spec's Open decision 2).
      return { state: "classified", classification: note, vocabulary: null, note };
    },
  },
  {
    source: "corrections",
    file: "correction-baseline.json",
    key: "records",
    map(id, row) {
      const caughtBy = verdictOf(this.source, id, row, "caught_by");
      if (caughtBy === null || caughtBy.startsWith("TODO")) return { state: "unclassified" };
      return {
        state: "classified",
        classification: caughtBy,
        vocabulary: CAUGHT_BY,
        note: row.note,
      };
    },
  },
  {
    source: "merge-record",
    file: "merge-record-baseline.json",
    key: "merges",
    map(id, row) {
      const status = verdictOf(this.source, id, row, "status");
      if (status === null || status.startsWith("TODO")) return { state: "unclassified" };
      const t = tracked(status);
      return {
        state: t ? "open" : "classified",
        issue: t?.issue,
        classification: t ? "tracked" : status,
        vocabulary: ACCEPTED_OR_TRACKED,
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
      // A row classified by hand has a note and an issue but no catalog
      // class, which trial:gate and the trial README accept.
      const hasClass = row.class !== undefined && row.class !== null;
      return {
        state: "open",
        issue: row.issue,
        classification: hasClass ? row.class : null,
        vocabulary: hasClass ? catalogClasses : null,
        note: row.note,
      };
    },
  },
];

/** A JSON file, refused with its path when it is absent or does not parse. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new Error(`${path}: ${err.message}`);
  }
}

/** The trial catalog's classes, `{ id, issue }`, from `barwise/trial/findings/catalog.json`. */
export function readTrialCatalog(root) {
  const path = join(root, "barwise", "trial", "findings", "catalog.json");
  const json = readJson(path);
  if (!Array.isArray(json?.classes)) throw new Error(`${path}: no classes array`);
  return json.classes.map((c, i) => {
    if (typeof c?.id !== "string") throw new Error(`${path}: class ${i} has no id`);
    return { id: c.id, issue: typeof c.issue === "string" ? c.issue : null };
  });
}

/**
 * Every row of the six baselines in the common shape, in source order and
 * then the file's row order, with the trial catalog they were read
 * against. Throws on an absent or malformed file, or a row its adapter
 * cannot map.
 */
export function readFindings(root) {
  const catalog = readTrialCatalog(root);
  const catalogClasses = new Set(catalog.map((c) => c.id));
  const findings = [];
  for (const s of SOURCES) {
    const path = join(root, "barwise", s.file);
    const rows = readJson(path)?.[s.key];
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
  return { findings, catalog };
}

/** The baseline file each source reads, for messages and tests. */
export const SOURCE_FILES = Object.fromEntries(SOURCES.map((s) => [s.source, s.file]));

/** The object in each baseline that holds its rows. */
export const SOURCE_KEYS = Object.fromEntries(SOURCES.map((s) => [s.source, s.key]));

/**
 * The ratchets, one per baseline (findings-close-by-mechanism
 * decisions 2 and 4): the script that runs it, and the ci.yml `run:` line
 * that wires it into CI, or why it is not wired (`noCi`). A test in
 * gates.test.mjs requires this list to cover every baseline above, each
 * `ci` line to be a step that can fail CI, and each script to be the one
 * its npm script runs; the stale-row cases that test each ratchet live
 * with the tests, not here.
 */
export const RATCHETS = [
  {
    source: "duplication",
    script: "scripts/audit-duplication.mjs",
    ci: "npm run audit:duplication -- --check",
  },
  { source: "rubric", script: "scripts/audit-rubric.mjs", ci: "npm run audit:rubric -- --check" },
  {
    source: "specs",
    script: "scripts/audit-spec-status.mjs",
    ci: "npm run audit:specs -- --check",
  },
  {
    source: "corrections",
    script: "scripts/audit-corrections.mjs",
    ci: "npm run audit:corrections -- --check",
  },
  {
    source: "merge-record",
    script: "scripts/check-merge-record.mjs",
    ci: "npm run check:merge-record",
  },
  {
    source: "trial",
    script: "trial/lib/gate.mjs",
    noCi:
      "needs trial:offline results, which no CI job produces; the trial spec's WS6 wires that lane (barwise-uuy)",
  },
];
