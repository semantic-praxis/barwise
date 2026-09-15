/**
 * Merging a regenerated baseline over the verdicts already recorded in it.
 *
 * This exists because all three baseline writers built their record map from
 * the detector ALONE, stamping a placeholder verdict into every row. So the
 * documented way to add one row was also the way to destroy every judgment in
 * the file: measured once across the three, 90 of 90 verdicts replaced with a
 * placeholder and 74 notes blanked, from the spellings the scripts advertise
 * (`--write`, `--write-baseline`, and -- worse -- no flag at all). The loss is
 * silent unless a later `--check` happens to fail on an untouched row, which
 * is how barwise-1026 was noticed: luck, on the second occurrence of the shape.
 *
 * Those verdicts are the closure record. CLAUDE.md's rule is that a finding is
 * not closed by a document but by a baseline row that has to be removed when
 * the finding is fixed, so `caught_by`, the rubric `verdict` and the
 * spec-status `note` ARE the findings' resolutions. Blanking them does not
 * lose formatting.
 *
 * **Why one module for three scripts.** The three name their human-owned
 * fields differently, but "which fields does the detector own and which does
 * the person" is one decision wearing three costumes -- a must-agree copy with
 * nothing checking it, if each script answered separately
 * (`docs/specs/duplication-drift-guards.spec.md`). `preserve` is where a
 * caller declares its own vocabulary, so the field names stay independent
 * while the merge rule does not.
 *
 * Spec: docs/specs/baseline-write-preserves-verdicts.spec.md.
 */
import { readFileSync } from "node:fs";

/**
 * The rows a baseline file already holds, or `{}` when it has none yet.
 *
 * Here rather than in each writer because all three need the same three-way
 * reading, and the middle case is the subtle one: an ABSENT file is a first
 * write and yields `{}`, but a MALFORMED file throws. Swallowing a parse error
 * into "no existing rows" would overwrite the file it could not read -- the
 * same clobber this module prevents, wearing the costume of a defensive catch.
 *
 * @param {string} path Absolute path to the baseline JSON.
 * @param {string} key Top-level property holding the rows ("records",
 *   "checks", "specs").
 */
export function readExistingRows(path, key) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
  return JSON.parse(raw)[key] ?? {};
}

/**
 * Rows to write, and what happened to them.
 *
 * Preserves the human-owned fields of any row the detector still produces,
 * refreshes everything else from the detector, and stamps the placeholder only
 * on genuinely new ids. That rule follows from the id rather than from a
 * preference: an id is a digest of the normalised finding text, so while it
 * still appears the detector is reporting the same finding and has learned
 * nothing about who caught it. When the text changes the id changes, and the
 * row is new -- `--check`'s stale-entry half already reports the old one.
 *
 * @param {object} args
 * @param {Record<string, Record<string, unknown>>} args.fresh
 *   id -> derived fields, from the detector. Defines which rows get written.
 * @param {Record<string, Record<string, unknown>>} args.existing
 *   id -> row as committed. `{}` on a first write.
 * @param {Record<string, unknown>} args.preserve
 *   Human-owned field name -> the value a NEW row gets. Both halves matter:
 *   the keys say what survives a rewrite, the values are the placeholder.
 * @returns {{
 *   rows: Record<string, Record<string, unknown>>,
 *   kept: number, added: number, dropped: string[], unclassified: number,
 * }}
 *   `kept` counts rows carrying a real verdict, NOT rows that merely existed:
 *   a row still reading `TODO: classify` was never judged, so counting it as
 *   preserved would overstate what the file holds. Those land in
 *   `unclassified` instead, so the three buckets add up to `rows`.
 *   `dropped` is reported, never written -- a row the detector no longer
 *   produces is the stale-entry case, and it is the caller's to print.
 */
export function mergeBaselineRows({ fresh, existing, preserve }) {
  const preservedKeys = Object.keys(preserve);
  const rows = {};
  let kept = 0;
  let added = 0;
  let unclassified = 0;

  // Sorted by id, because otherwise the file's order is the detector's
  // traversal order and a rerun reshuffles it: regenerating the correction
  // baseline moved 73 of its 74 rows while changing nothing, which is a diff
  // no reviewer can read and is most of why the writers go unrun. Sorting also
  // makes the output a function of the findings alone, so two runs over one
  // tree are byte-identical -- the property WS1's round-trip test asserts.
  for (
    const [id, derived] of Object.entries(fresh).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  ) {
    const prior = existing[id];
    const human = {};
    for (const key of preservedKeys) {
      // `key in prior`, not `prior[key] || preserve[key]`: absent and falsy are
      // different, and only the first should reach for the placeholder.
      //
      // No current caller can tell the two apart, and that was measured rather
      // than assumed -- a mutation swapping them came back UNCAUGHT against the
      // script-level tests. Each caller either rejects a falsy human field in
      // `--check` (spec-status's `!row.note`, corrections' `CAUGHT_BY`
      // membership) or has `""` as its own placeholder, so the distinction has
      // no reachable consequence through any of the three today. It is kept
      // because this is a shared helper whose `preserve` contract admits fields
      // its callers have not declared yet, and it is asserted directly in
      // scripts/tests/baseline-merge.test.mjs rather than left as a guard with
      // no test.
      human[key] = prior !== undefined && key in prior ? prior[key] : preserve[key];
    }

    if (prior === undefined) added += 1;
    else if (isPlaceholder(human, preserve)) unclassified += 1;
    else kept += 1;

    rows[id] = { ...derived, ...human };
  }

  const dropped = Object.keys(existing).filter((id) => !(id in fresh));
  return { rows, kept, added, dropped, unclassified };
}

/**
 * Whether a row still carries the placeholder in every human-owned field.
 *
 * Every field, not any: a row classified but not yet annotated has been
 * judged, and the judgment is the part worth counting.
 */
function isPlaceholder(human, preserve) {
  return Object.keys(preserve).every((key) => human[key] === preserve[key]);
}

/**
 * The one-line report a writer prints.
 *
 * Beside the merge rather than at three call sites because a successful merge
 * and a silent clobber otherwise print the same sentence -- the same
 * two-values-for-three-situations defect the gate-refusal contract fixes for
 * reads, one level down in the same scripts.
 */
export function mergeSummary({ kept, added, dropped, unclassified }) {
  const parts = [`${kept} verdict(s) kept`];
  if (added > 0) parts.push(`${added} new`);
  if (unclassified > 0) parts.push(`${unclassified} still unclassified`);
  if (dropped.length > 0) parts.push(`${dropped.length} no longer detected`);
  return parts.join(", ");
}
