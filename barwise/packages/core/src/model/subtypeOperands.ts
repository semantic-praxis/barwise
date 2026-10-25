/**
 * What a constraint over subtypes is about, read once for every reader
 * that names it: the verbalizer, the ConstraintSpec pseudocode, and the
 * constraint router, which places its spill at the supertype's table
 * (schema-export-subtype-constraints.spec.md, barwise-lwy). Before this
 * the verbalizer held the rule and two copies would have had to agree
 * with it.
 */
import type { OrmModel } from "./OrmModel.js";

/** How many of its subtypes each kind lets an instance of the supertype be. */
export const SUBTYPE_QUANTITY = {
  exclusion: "at most one",
  disjunctive_mandatory: "at least one",
  exclusive_or: "exactly one",
} as const;

/**
 * The supertype a constraint's subtype facts name, taken from the first
 * that resolves (validation reports subtype facts naming different
 * supertypes), and each subtype fact's subtype, undefined where the fact
 * or its subtype does not resolve.
 */
export function subtypeOperands(
  subtypeFactIds: readonly string[],
  model: OrmModel,
): {
  readonly supertypeId: string | undefined;
  readonly subtypeIds: readonly (string | undefined)[];
} {
  const facts = subtypeFactIds.map((id) => model.getSubtypeFact(id));
  return {
    supertypeId: facts.find((f) => f !== undefined)?.supertypeId,
    subtypeIds: facts.map((f) => f?.subtypeId),
  };
}
