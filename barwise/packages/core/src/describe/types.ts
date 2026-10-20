/**
 * Domain-description summary types.
 */
import type { FactInstance } from "../model/Population.js";
import type { ConstraintReport } from "../verbalization/ConstraintVerbalizer.js";

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
 * Summary of a constraint: what `ConstraintVerbalizer.reportInView` says
 * about it (its own id, sentence, and the fact types it applies to;
 * orm-format-3, Open decision 9), plus its kind.
 */
export interface ConstraintSummary extends ConstraintReport {
  readonly type: string;
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
