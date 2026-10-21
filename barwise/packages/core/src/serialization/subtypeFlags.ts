/**
 * The 2.0 subtype flags and the constraints over subtypes that replace them
 * (`docs/specs/orm-format-3.spec.md`, migration step 3 and WS4b).
 *
 * A 2.0 file says a supertype's subtypes are exclusive or exhaustive with
 * an `is_exclusive` or `is_exhaustive` flag on each subtype fact; the model
 * holds an `exclusion`, `disjunctive_mandatory` or `exclusive_or` over the
 * subtype facts instead. Both directions live here, over plain records, so
 * the 2.0 loader, the 2.0 writer and the 3.0 migration convert alike.
 */
import type { ExternalConstraint } from "../model/Constraint.js";
import { derivedId } from "./derivedId.js";

/** The domain tag for the ids step 3 derives. */
export const SUBTYPE_CONSTRAINT_ID_TAG = "barwise.subtype-constraint";

/** A subtype fact as a 2.0 file flags it. */
export interface FlaggedSubtypeFact {
  readonly id: string;
  readonly supertype: string;
  readonly is_exclusive?: boolean;
  readonly is_exhaustive?: boolean;
}

type SubtypeKind = "exclusion" | "disjunctive_mandatory" | "exclusive_or";

/**
 * Step 3: for each supertype, in the order its first subtype fact appears,
 * E is its subtype facts flagged exclusive and X those flagged exhaustive,
 * each in file order. E and X equal with two or more members give one
 * `exclusive_or`; otherwise E with two or more gives an `exclusion` and X
 * with one or more a `disjunctive_mandatory`. A one-member E is dropped:
 * exclusion within a group of one always holds, so it states nothing.
 *
 * Ids are derived from the supertype id and the kind, so a file converts to
 * the same ids every time and a 2.0 save that writes the flags back loads
 * to the same constraints.
 */
export function subtypeConstraintsFromFlags(
  subtypeFacts: readonly FlaggedSubtypeFact[],
): ExternalConstraint[] {
  const groups = new Map<string, { exclusive: string[]; exhaustive: string[]; }>();
  for (const sf of subtypeFacts) {
    const group = groups.get(sf.supertype) ?? { exclusive: [], exhaustive: [] };
    groups.set(sf.supertype, group);
    if (sf.is_exclusive) group.exclusive.push(sf.id);
    if (sf.is_exhaustive) group.exhaustive.push(sf.id);
  }
  const out: ExternalConstraint[] = [];
  const make = (supertype: string, type: SubtypeKind, ids: string[]) =>
    out.push({
      id: derivedId(SUBTYPE_CONSTRAINT_ID_TAG, [supertype, type]),
      type,
      subtypeFactIds: ids,
    });
  for (const [supertype, { exclusive, exhaustive }] of groups) {
    const same = exclusive.length === exhaustive.length
      && exclusive.every((id, i) => exhaustive[i] === id);
    if (same && exclusive.length >= 2) {
      make(supertype, "exclusive_or", exclusive);
      continue;
    }
    if (exclusive.length >= 2) make(supertype, "exclusion", exclusive);
    if (exhaustive.length >= 1) make(supertype, "disjunctive_mandatory", exhaustive);
  }
  return out;
}

/**
 * The flags a 2.0 file writes for each subtype fact a constraint over
 * subtypes names: exclusive under an `exclusion` or `exclusive_or`,
 * exhaustive under a `disjunctive_mandatory` or `exclusive_or`.
 *
 * Every 2.0 file loads to constraints this writes back unchanged. A model
 * built otherwise -- in code, or by a merge that keeps one side's
 * constraint and the other's -- can hold what flags cannot say, and a 2.0
 * save loses it:
 *
 * - two constraints of one kind over one supertype's subtypes merge into
 *   one flagged group, and an exclusive-or beside a disjunctive mandatory
 *   over other subtypes reloads as an exclusion and one wider disjunctive
 *   mandatory, which is weaker;
 * - a deontic modality, and a stated id, which reloads derived;
 * - an exclusion over a single subtype fact, which validation reports,
 *   is dropped, and an exclusive-or over one reloads as the disjunctive
 *   mandatory it is equivalent to;
 * - a subtype fact id that names nothing writes no flag.
 *
 * Format 3.0 stores the constraints themselves (orm-format-3 WS4b, after
 * 4b-i), which ends every case above.
 */
export function subtypeFlagsFromConstraints(
  constraints: readonly ExternalConstraint[],
): Map<string, { exclusive: boolean; exhaustive: boolean; }> {
  const flags = new Map<string, { exclusive: boolean; exhaustive: boolean; }>();
  for (const c of constraints) {
    if (
      c.type !== "exclusion" && c.type !== "disjunctive_mandatory" && c.type !== "exclusive_or"
    ) continue;
    for (const id of c.subtypeFactIds ?? []) {
      const f = flags.get(id) ?? { exclusive: false, exhaustive: false };
      flags.set(id, f);
      if (c.type !== "disjunctive_mandatory") f.exclusive = true;
      if (c.type !== "exclusion") f.exhaustive = true;
    }
  }
  return flags;
}
