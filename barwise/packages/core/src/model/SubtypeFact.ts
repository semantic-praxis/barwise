import type { DerivationRule } from "./FactType.js";
import { ModelElement } from "./ModelElement.js";

/**
 * Configuration for creating a new SubtypeFact.
 */
export interface SubtypeFactConfig {
  /** Optional stable identifier. Generated if omitted. */
  readonly id?: string;
  /** The id of the subtype (child) entity type. */
  readonly subtypeId: string;
  /** The id of the supertype (parent) entity type. */
  readonly supertypeId: string;
  /**
   * Whether the subtype uses the supertype's reference scheme for
   * identification (preferred identification path). When true, the
   * subtype does not need its own reference mode -- it inherits the
   * supertype's PK in relational mapping.
   */
  readonly providesIdentification?: boolean;
  /**
   * Whether the subtypes of this supertype are mutually exclusive.
   * When true, no supertype instance can simultaneously be an instance
   * of more than one subtype in the same partition group (all
   * SubtypeFacts sharing the same supertype with isExclusive=true).
   *
   * In ORM 2 notation this corresponds to an exclusion constraint
   * across the supertype meta-roles of the subtype partition.
   */
  readonly isExclusive?: boolean;
  /**
   * Whether the subtypes of this supertype are exhaustive (cover
   * all instances). When true, every supertype instance must be an
   * instance of at least one subtype in the same partition group.
   *
   * In ORM 2 notation this corresponds to a disjunctive mandatory
   * constraint across the supertype meta-roles of the subtype partition.
   */
  readonly isExhaustive?: boolean;
  /**
   * Defining rule when this subtype's membership is determined by a
   * derivation rule (Halpin's subtype-defining rules) rather than asserted.
   * Absent for an asserted subtype.
   */
  readonly definingRule?: DerivationRule;
}

/**
 * A SubtypeFact represents a specialization relationship in ORM:
 * entity type A is a subtype of entity type B.
 *
 * Every instance of the subtype is also an instance of the supertype.
 * The subtype inherits all fact types and constraints of the supertype
 * and may have additional ones of its own.
 *
 * Example: "Employee is a subtype of Person" means every Employee is
 * a Person, but not every Person is necessarily an Employee.
 *
 * In relational mapping, subtype facts determine whether the subtype
 * is absorbed into the supertype's table or gets its own table with
 * a FK back to the supertype.
 */
export class SubtypeFact extends ModelElement {
  readonly subtypeId: string;
  readonly supertypeId: string;
  readonly providesIdentification: boolean;
  readonly isExclusive: boolean;
  readonly isExhaustive: boolean;
  readonly definingRule: DerivationRule | undefined;

  constructor(config: SubtypeFactConfig) {
    // Name is derived from the relationship for display purposes.
    // The actual subtype/supertype names are resolved by the model.
    super(
      `subtype:${config.subtypeId}:${config.supertypeId}`,
      config.id,
    );
    this.subtypeId = config.subtypeId;
    this.supertypeId = config.supertypeId;
    this.providesIdentification = config.providesIdentification ?? true;
    this.isExclusive = config.isExclusive ?? false;
    this.isExhaustive = config.isExhaustive ?? false;
    this.definingRule = config.definingRule;

    if (config.subtypeId === config.supertypeId) {
      throw new Error(
        "A subtype fact cannot have the same entity as both subtype and supertype.",
      );
    }
  }
}
