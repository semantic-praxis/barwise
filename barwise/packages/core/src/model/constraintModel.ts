/**
 * What the constraint verbalizer reads of a model, as an interface of its
 * own (iri-identity 6a). `OrmModel` implements it; the verbalizer and the
 * modules it imports name it instead of `OrmModel`, so the model can call
 * the verbalizer -- which minting a constraint's name at its add needs
 * (6b) -- without an import cycle. A leaf: it imports element types only,
 * none of which imports `OrmModel`. dependency-cruiser's `no-circular`
 * counts type-only imports, so the check is that one rule, not this
 * comment.
 */
import type { Constraint, ExternalConstraint, InternalConstraint } from "./Constraint.js";
import type { FactType } from "./FactType.js";
import type { ObjectType } from "./ObjectType.js";
import type { Role } from "./Role.js";
import type { SubtypeFact } from "./SubtypeFact.js";

/**
 * A constraint in a view of fact types: an internal one with the fact type
 * it lives in, one across fact types with none. The second has no host
 * (orm-format-3, Open decision 9), so a reader that wants to name its fact
 * types asks for the ones it spans rather than being handed one.
 */
export type ConstraintInView =
  | readonly [constraint: InternalConstraint, factType: FactType]
  | readonly [constraint: ExternalConstraint, factType: undefined];

/** The members of `OrmModel` that constraint verbalization reads. */
export interface ConstraintModel {
  readonly factTypes: readonly FactType[];
  getObjectType(id: string): ObjectType | undefined;
  getFactType(id: string): FactType | undefined;
  getSubtypeFact(id: string): SubtypeFact | undefined;
  getConstraint(id: string): Constraint | undefined;
  findRole(id: string): Role | undefined;
  constraintsTouching(factTypeId: string): readonly Constraint[];
  factTypesNaming(inView: ConstraintInView): readonly FactType[];
  factTypesHolding(roleIds: readonly string[]): readonly FactType[];
}
