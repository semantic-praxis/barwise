/**
 * Domain-description summary types.
 */
import type { FactInstance } from "../model/Population.js";

/**
 * Options for describing a domain.
 */
export interface DescribeDomainOptions {
  /**
   * Optional focus: entity name, fact type name, constraint type, or undefined
   * for full summary.
   */
  readonly focus?: string;

  /**
   * Include population data in the description (default: true).
   */
  readonly includePopulations?: boolean;
}

/**
 * Summary of an entity type (object type).
 */
export interface EntitySummary {
  readonly id: string;
  readonly name: string;
  readonly definition?: string;
  readonly kind: "entity" | "value";
  readonly referenceMode?: string;
}

/**
 * Summary of a fact type.
 */
export interface FactTypeSummary {
  readonly id: string;
  readonly name: string;
  readonly arity: number;
  readonly primaryReading: string;
  readonly involvedEntities: readonly string[]; // Entity names
  readonly constraintCount: number;
}

/**
 * Summary of a constraint (orm-format-3, Open decision 9): its own id, and
 * the fact types it applies to, in model order -- one for an internal
 * constraint, every one it spans for a constraint across fact types.
 */
export interface ConstraintSummary {
  readonly id: string;
  readonly type: string;
  readonly verbalization: string;
  /** Names of the fact types the constraint applies to. */
  readonly factTypes: readonly string[];
  /** Ids of the same fact types, in the same order. */
  readonly factTypeIds: readonly string[];
}

/**
 * Summary of population data for a fact type.
 */
export interface PopulationSummary {
  readonly factTypeId: string;
  readonly factTypeName: string;
  readonly description?: string;
  readonly instanceCount: number;
  readonly sampleInstances: readonly FactInstance[];
}

/**
 * Complete domain description.
 */
export interface DomainDescription {
  readonly summary: string; // Human-readable summary
  readonly entityTypes: readonly EntitySummary[];
  readonly factTypes: readonly FactTypeSummary[];
  readonly constraints: readonly ConstraintSummary[];
  readonly populations?: readonly PopulationSummary[];
}
