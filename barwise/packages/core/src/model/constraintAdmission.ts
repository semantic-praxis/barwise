/**
 * How a fact type in a model hands the model a constraint added after the
 * fact type joined it (iri-identity WS6, 6b). `FactType.addConstraint` is
 * called on fact types a model already holds (dbt, Ossie, the LLM parser),
 * and the model has to see each such constraint: to enter its id in the
 * model's id index now, and in format 4.0 to mint its name.
 *
 * A narrow interface in a leaf module, not `OrmModel` itself: a fact type
 * holding the model would close `FactType` -> `OrmModel` -> `FactType`,
 * and a fact type minting for itself would close `FactType` -> `mint.ts`
 * -> `ConstraintVerbalizer` -> `FactType`. The model admits; the fact
 * type asks it to.
 */
import type { InternalConstraint } from "./Constraint.js";

export interface ConstraintAdmission {
  /**
   * The constraint as the model stores it, with its id, for the fact type
   * `hostId` names. By id, not the fact type itself: a type naming
   * `FactType` here would close the cycle this module exists to avoid.
   */
  admitConstraint<C extends InternalConstraint>(constraint: C, hostId: string): C;
}
