/**
 * Three-way merge of `.beads/issues.jsonl`: per id, then per field
 * (docs/specs/beads-merge-driver.spec.md). Pure -- text in, text out --
 * so every rule is testable without git. beads-merge-driver.mjs is the
 * I/O around it.
 *
 * "current" is the side git writes the result into (%A) and "other" the
 * side being merged in (%B). In a rebase git swaps them. Every rule here
 * is symmetric, so the swap decides nothing: it changes the order of
 * output lines and, within an issue merged field by field, the order of
 * its keys (current's first), never a value.
 *
 * What this module will not decide, it reports: the caller writes a
 * conflict block for each reported id, which check-beads.sh rejects, so a
 * careless `git add` cannot commit a guess.
 */
import { isDeepStrictEqual as eq } from "node:util";
import { canonicalLine, recomputeCounts } from "./beads-jsonl.mjs";

/** Fields beads-crud derives from `dependencies`; recomputed, never compared. */
export const DERIVED = new Set(["dependency_count", "dependent_count"]);

/**
 * When an event happened, set by whichever side recorded it. Both sides
 * stamping one is agreement that it happened, so the later value is kept
 * rather than reported: `updated_at` on every edit, and `closed_at` when
 * main and a branch both close an issue, which the steward's follow-up
 * closures make routine.
 */
const EVENT_TIMESTAMPS = new Set(["updated_at", "closed_at"]);

/** An input line that is not an issue; the driver hands the file to git's line merge. */
export class MalformedInput extends Error {
  constructor(label, lineNo, reason) {
    super(`${label} line ${lineNo}: ${reason}`);
    this.label = label;
    this.lineNo = lineNo;
  }
}

/**
 * The issues in one version of the file, in order, each with its original
 * line. Blank lines are skipped, as check-beads.sh and beads-crud skip
 * them; a duplicate id is malformed because no rule below can place it.
 */
export function parseTracker(text, label) {
  const issues = [];
  const seen = new Set();
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === "") continue;
    let obj;
    try {
      obj = JSON.parse(raw);
    } catch {
      throw new MalformedInput(label, i + 1, "not valid JSON");
    }
    if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
      throw new MalformedInput(label, i + 1, "not a JSON object");
    }
    if (typeof obj.id !== "string" || obj.id === "") {
      throw new MalformedInput(label, i + 1, "no id");
    }
    if (seen.has(obj.id)) throw new MalformedInput(label, i + 1, `duplicate id ${obj.id}`);
    seen.add(obj.id);
    issues.push({ obj, raw });
  }
  return issues;
}

/**
 * Two versions of an issue say the same thing: equal ignoring key order
 * and the derived counts. A count moves when ANOTHER issue gains a
 * `blocks` edge, so comparing it would turn a clean deletion into a
 * delete-versus-edit conflict.
 */
export function sameIssue(a, b) {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) {
    if (DERIVED.has(k)) continue;
    if (!eq(a[k], b[k])) return false;
  }
  return true;
}

function laterTimestamp(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return a >= b ? a : b;
  return ta >= tb ? a : b;
}

/**
 * Field by field (spec rule 6). Returns the merged object for each side's
 * view of the conflicting fields: identical when nothing conflicted.
 * Keys keep current's order, then keys only other has, in its order.
 */
function mergeFields(base, cur, oth) {
  const order = [...Object.keys(cur)];
  for (const k of Object.keys(oth)) if (!(k in cur)) order.push(k);
  const asCurrent = {};
  const asOther = {};
  const conflicts = [];
  for (const k of order) {
    const b = base?.[k];
    const c = cur[k];
    const o = oth[k];
    let cv;
    let ov;
    if (DERIVED.has(k)) {
      cv = ov = c !== undefined ? c : o; // recomputed by the caller
    } else if (eq(c, o) || eq(o, b)) {
      cv = ov = c; // agreement, or only current changed it
    } else if (eq(c, b)) {
      cv = ov = o; // only other changed it
    } else if (EVENT_TIMESTAMPS.has(k) && c !== undefined && o !== undefined) {
      cv = ov = laterTimestamp(c, o);
    } else {
      cv = c;
      ov = o;
      conflicts.push(k);
    }
    if (cv !== undefined) asCurrent[k] = cv;
    if (ov !== undefined) asOther[k] = ov;
  }
  return { asCurrent, asOther, conflicts };
}

/**
 * Resolve three versions of the tracker. Returns the result's entries in
 * output order -- `{ obj, sources }` for a resolved issue, or `{ conflict }`
 * for a reported one -- and the reported ids with their reasons. A
 * conflict carries either the two sides' raw lines and parsed objects
 * (`current`/`other`, empty for an absent side) or, for a field
 * conflict, the two field-merged candidates (`asCurrent`/`asOther`).
 */
export function resolveIssues(baseIssues, curIssues, othIssues) {
  const base = new Map(baseIssues.map((x) => [x.obj.id, x]));
  const cur = new Map(curIssues.map((x) => [x.obj.id, x]));
  const oth = new Map(othIssues.map((x) => [x.obj.id, x]));
  const ids = [...cur.keys()];
  for (const id of oth.keys()) if (!cur.has(id)) ids.push(id);

  const entries = [];
  const reported = [];
  const report = (id, reason, candidates) => {
    reported.push({ id, reason });
    entries.push({ conflict: { id, reason, ...candidates } });
  };
  const sides = (c, o) => ({
    current: c?.raw ?? "",
    other: o?.raw ?? "",
    currentObj: c && structuredClone(c.obj),
    otherObj: o && structuredClone(o.obj),
  });

  for (const id of ids) {
    const b = base.get(id);
    const c = cur.get(id);
    const o = oth.get(id);
    const sources = [c, o].filter(Boolean);

    // Rule 1: the same id minted twice. check-beads.sh tests a reused id
    // the same way (barwise-984); titles are edited, so they cannot.
    if (c && o && c.obj.created_at !== o.obj.created_at) {
      report(
        id,
        `id collision: created_at ${c.obj.created_at} on current, ${o.obj.created_at} on other`,
        sides(c, o),
      );
      continue;
    }
    // Rule 2: both sides agree (both deleting is handled by never listing it).
    // Rule 6 would reach the same result field by field; this is the
    // spec's rule stated directly, and no test can tell them apart.
    if (c && o && sameIssue(c.obj, o.obj)) {
      entries.push({ obj: structuredClone(c.obj), sources });
      continue;
    }
    if (b) {
      // Rule 3: one side left it as the base had it; the other side's
      // version stands, deletion included.
      if (c && sameIssue(c.obj, b.obj)) {
        if (o) entries.push({ obj: structuredClone(o.obj), sources });
        continue;
      }
      if (o && sameIssue(o.obj, b.obj)) {
        if (c) entries.push({ obj: structuredClone(c.obj), sources });
        continue;
      }
      // Rule 4: deleted on one side, changed on the other.
      if (!c) {
        report(id, "deleted on current, edited on other", sides(c, o));
        continue;
      }
      if (!o) {
        report(id, "deleted on other, edited on current", sides(c, o));
        continue;
      }
    } else if (!c || !o) {
      // Rule 5: added on one side only.
      entries.push({ obj: structuredClone((c || o).obj), sources });
      continue;
    }
    // Rule 6: both sides have it and at least one changed it.
    const merged = mergeFields(b?.obj, c.obj, o.obj);
    if (merged.conflicts.length === 0) {
      entries.push({ obj: merged.asCurrent, sources });
    } else {
      report(id, `both sides changed ${merged.conflicts.join(", ")}`, {
        asCurrent: merged.asCurrent,
        asOther: merged.asOther,
      });
    }
  }
  return { entries, reported };
}

/** A resolved issue's line: its source line byte for byte when unchanged. */
function lineFor(obj, sources) {
  const text = JSON.stringify(obj);
  for (const s of sources) if (JSON.stringify(s.obj) === text) return s.raw;
  return canonicalLine(obj);
}

function conflictBlock(id, reason, current, other) {
  const out = [`<<<<<<< current: ${id} (${reason})`];
  if (current) out.push(current);
  out.push("=======");
  if (other) out.push(other);
  out.push(`>>>>>>> other: ${id}`);
  return out;
}

/**
 * The merged file's text and what was reported. Counts are recomputed over
 * the result, which for a reported issue means a guess: it is counted as
 * kept, in current's version where current has one. Leaving it out instead
 * rewrote the counts of issues neither side touched (an untouched issue
 * blocked by one that is deleted on one side and edited on the other lost
 * its dependent_count). A field conflict's candidates are each counted
 * against that same view. A person who resolves a block the other way can
 * leave a count stale; check-beads.sh does not check counts, and
 * beads-crud recomputes them on its next write to the issues concerned.
 */
export function resolveTracker(baseText, curText, othText) {
  const { entries, reported } = resolveIssues(
    parseTracker(baseText, "base"),
    parseTracker(curText, "current"),
    parseTracker(othText, "other"),
  );

  const asCurrentView = [];
  const asOtherView = [];
  for (const e of entries) {
    if (e.obj) {
      asCurrentView.push(e.obj);
      asOtherView.push(e.obj);
    } else if (e.conflict.asCurrent) {
      asCurrentView.push(e.conflict.asCurrent);
      asOtherView.push(e.conflict.asOther);
    } else {
      const kept = e.conflict.currentObj || e.conflict.otherObj;
      asCurrentView.push(kept);
      asOtherView.push(kept);
    }
  }
  const allIds = asCurrentView.map((o) => o.id);
  recomputeCounts(asCurrentView, allIds);
  // The other view shares every resolved object, already counted; only the
  // other-side candidates need counting, against that view.
  const otherCandidates = entries.filter((e) => e.conflict?.asOther).map((e) =>
    e.conflict.asOther.id
  );
  recomputeCounts(asOtherView, otherCandidates);

  const lines = [];
  for (const e of entries) {
    if (e.obj) {
      lines.push(lineFor(e.obj, e.sources));
      continue;
    }
    const { id, reason } = e.conflict;
    if (e.conflict.asCurrent) {
      lines.push(
        ...conflictBlock(
          id,
          reason,
          canonicalLine(e.conflict.asCurrent),
          canonicalLine(e.conflict.asOther),
        ),
      );
    } else {
      lines.push(...conflictBlock(id, reason, e.conflict.current, e.conflict.other));
    }
  }
  return { text: lines.length ? `${lines.join("\n")}\n` : "", reported };
}
