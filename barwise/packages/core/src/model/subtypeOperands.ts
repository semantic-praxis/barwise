/**
 * What a constraint over subtypes is about, read once for every reader
 * that names it: the verbalizer, the ConstraintSpec pseudocode, the
 * constraint router, which places its spill at the supertype's table, and
 * model lineage (schema-export-subtype-constraints.spec.md, barwise-lwy).
 * Before this the verbalizer and lineage each held the rule.
 */
import type { ConstraintModel } from "./constraintModel.js";

/**
 * The supertype a constraint's subtype facts name, taken from the first
 * that resolves (validation reports subtype facts naming different
 * supertypes), and each subtype fact's subtype, undefined where the fact
 * or its subtype does not resolve.
 */
export function subtypeOperands(
  subtypeFactIds: readonly string[],
  model: ConstraintModel,
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
