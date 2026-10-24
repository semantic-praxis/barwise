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
import { blocksIn, blocksOut, canonicalLine } from "./beads-jsonl.mjs";

/** The labels resolveTracker gives its three inputs, as MalformedInput carries them. */
export const INPUT_LABELS = Object.freeze({ base: "base", current: "current", other: "other" });

/** What a reported issue is, without the PR data its reason quotes. */
export const REPORT_KINDS = Object.freeze(["collision", "deleted-vs-edited", "field-conflict"]);

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

/**
 * Fields that describe one state together. If any of them conflicts, each
 * candidate takes all of them from its own side: mixing them wrote an
 * in-progress issue carrying the other side's closed_at and close_reason,
 * the open-and-closed row beads-crud refuses to write (barwise-1064).
 */
const CLOSURE = ["status", "closed_at", "close_reason"];

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

/** A value the later-timestamp rule may compare; anything else is reported. */
function isTimestamp(v) {
  return typeof v === "string" && !Number.isNaN(Date.parse(v));
}

function laterTimestamp(a, b) {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  // Equal instants spelled differently fall to the string order, so the
  // answer never depends on which side is current.
  if (ta === tb) return a >= b ? a : b;
  return ta > tb ? a : b;
}

/**
 * Field by field (spec rule 6). Returns the merged object for each side's
 * view of the conflicting fields: identical when nothing conflicted.
 * Keys keep current's order, then keys only other has, in its order.
 */
function mergeFields(base, cur, oth) {
  const order = [...Object.keys(cur)];
  for (const k of Object.keys(oth)) if (!Object.hasOwn(cur, k)) order.push(k);
  // Prototype-free, so a field named like an Object member, or __proto__,
  // is an ordinary key here.
  const asCurrent = Object.create(null);
  const asOther = Object.create(null);
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
    } else if (EVENT_TIMESTAMPS.has(k) && isTimestamp(c) && isTimestamp(o)) {
      cv = ov = laterTimestamp(c, o);
    } else {
      cv = c;
      ov = o;
      conflicts.push(k);
    }
    if (cv !== undefined) asCurrent[k] = cv;
    if (ov !== undefined) asOther[k] = ov;
  }
  if (conflicts.some((k) => CLOSURE.includes(k))) {
    for (const k of CLOSURE) {
      for (const [into, from] of [[asCurrent, cur], [asOther, oth]]) {
        if (Object.hasOwn(from, k)) into[k] = from[k];
        else delete into[k];
      }
      if (!eq(cur[k], oth[k]) && !conflicts.includes(k)) conflicts.push(k);
    }
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
  // `kind` is one of REPORT_KINDS, so a reader that must not echo PR
  // data (the tracker-conflicts workflow's comment) can name the case
  // without printing `reason`, which quotes field names and values.
  const report = (id, kind, reason, candidates) => {
    if (!REPORT_KINDS.includes(kind)) throw new Error(`unknown report kind: ${kind}`);
    reported.push({ id, kind, reason });
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
        "collision",
        `id collision: created_at ${c.obj.created_at} on current, ${o.obj.created_at} on other`,
        sides(c, o),
      );
      continue;
    }
    // Rule 2, both sides agreeing, needs no branch of its own: an issue
    // both deleted is never listed, and two equal versions come through
    // rule 3 or rule 6 unchanged (a separate branch was a mutant no test
    // could kill).
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
        report(id, "deleted-vs-edited", "deleted on current, edited on other", sides(c, o));
        continue;
      }
      if (!o) {
        report(id, "deleted-vs-edited", "deleted on other, edited on current", sides(c, o));
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
      report(id, "field-conflict", `both sides changed ${merged.conflicts.join(", ")}`, {
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
 * the result, every issue, every merge. A reported issue counts with the
 * union of its candidates' blocks edges: no side wins, so a merge and a
 * rebase write the same counts, and an issue neither side touched keeps a
 * count that matches whichever candidate has the edge. Leaving reported
 * issues out rewrote such counts. A person who resolves a block against
 * that guess can leave a count stale: check-beads.sh does not check counts,
 * and the next merge of the tracker, which recounts everything, repairs it.
 */
export function resolveTracker(baseText, curText, othText) {
  const { entries, reported } = resolveIssues(
    parseTracker(baseText, INPUT_LABELS.base),
    parseTracker(curText, INPUT_LABELS.current),
    parseTracker(othText, INPUT_LABELS.other),
  );

  const edgesOf = (o) => o?.dependencies || [];
  const union = (a, b) => {
    const seen = new Set(a.map((d) => JSON.stringify(d)));
    return [...a, ...b.filter((d) => !seen.has(JSON.stringify(d)))];
  };
  const counted = entries.map((e) => {
    if (e.obj) return e.obj;
    const [a, b] = e.conflict.asCurrent
      ? [e.conflict.asCurrent, e.conflict.asOther]
      : [e.conflict.currentObj, e.conflict.otherObj];
    return { dependencies: union(edgesOf(a), edgesOf(b)) };
  });
  const dependents = blocksIn(counted);
  const count = (o) => {
    o.dependency_count = blocksOut(o);
    o.dependent_count = dependents.get(o.id) ?? 0;
  };
  for (const e of entries) {
    if (e.obj) count(e.obj);
    else if (e.conflict.asCurrent) {
      count(e.conflict.asCurrent);
      count(e.conflict.asOther);
    }
  }

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
