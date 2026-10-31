import type { Complete } from "../util/complete.js";
import type { DerivationRule } from "./FactType.js";

/**
 * Configuration for creating a new SubtypeFact.
 */
export interface SubtypeFactConfig {
  /** Optional stable identifier. In a model, its minted name if omitted; standalone, generated. */
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
export class SubtypeFact {
  /**
   * Its id, or none: a subtype fact the model could not name, because the
   * ends its sentence reads do not resolve, is left unnamed rather than
   * given a generated id (iri-identity, decision 19).
   */
  readonly id: string | undefined;
  readonly subtypeId: string;
  readonly supertypeId: string;
  readonly providesIdentification: boolean;
  readonly definingRule: DerivationRule | undefined;

  constructor(config: SubtypeFactConfig) {
    this.id = config.id;
    this.subtypeId = config.subtypeId;
    this.supertypeId = config.supertypeId;
    this.providesIdentification = config.providesIdentification ?? true;
    this.definingRule = config.definingRule;

    if (config.subtypeId === config.supertypeId) {
      throw new Error(
        "A subtype fact cannot have the same entity as both subtype and supertype.",
      );
    }
  }
}

/**
 * What makes two subtype facts the same relationship: the subtype and
 * the supertype they relate. One key, read by `OrmModel.addSubtypeFact`
 * when it refuses a repeat and by `structural/duplicate-subtype-fact`
 * when it reports one a lenient load let through, so the store and the
 * rule cannot disagree about what a repeat is.
 */
export function subtypePairKey(
  sf: { readonly subtypeId: string; readonly supertypeId: string; },
): string {
  return `${sf.subtypeId}\u0000${sf.supertypeId}`;
}

/**
 * How a subtype fact is referred to where a string is needed -- a
 * diagnostic, a verbalization, a diagram view: its id, or for one the model
 * left unnamed (decision 19) a fixed reference built from what it relates.
 * No 4.0 id can take that form (a local name holds no `:`).
 */
export function subtypeFactRef(
  sf: {
    readonly id: string | undefined;
    readonly subtypeId: string;
    readonly supertypeId: string;
  },
): string {
  return sf.id ?? `unnamed:${sf.subtypeId}<${sf.supertypeId}`;
}

/**
 * Project a SubtypeFact back to the config shape that constructed it,
 * listing every field once -- the `toObjectTypeConfig` convention
 * (barwise-927) applied to the element kinds the merge started carrying
 * through in barwise-937. A caller that rebuilds a subtype fact spreads
 * this instead of hand-copying its fields, and the `Complete<...>`
 * annotation makes the next field added to `SubtypeFactConfig` a
 * compile error here until it is listed.
 */
export function toSubtypeFactConfig(sf: SubtypeFact): SubtypeFactConfig {
  const config: Complete<SubtypeFactConfig> = {
    id: sf.id,
    subtypeId: sf.subtypeId,
    supertypeId: sf.supertypeId,
    providesIdentification: sf.providesIdentification,
    definingRule: sf.definingRule,
  };
  return config;
}
