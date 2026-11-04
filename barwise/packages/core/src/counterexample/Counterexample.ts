import type { Constraint } from "../model/Constraint.js";
import type { Population } from "../model/Population.js";
import type { VerbalizationSegment } from "../verbalization/Verbalization.js";

/**
 * A counterexample is an expectancy probe for a constraint: the minimal
 * sample population the constraint forbids, paired with a short reading
 * of what it rules out.
 *
 * It is the deterministic inverse of population validation -- feeding the
 * `forbidden` populations back through `populationValidationRules` reports
 * a violation of the very constraint this counterexample was generated
 * for. The purpose is not to flag an error (the constraint is satisfied)
 * but to let a modeler confirm the model rules out what it should.
 */
export interface Counterexample {
  /**
   * The fact types the probed constraint applies to, in model order: its
   * own fact type for an internal constraint, every fact type it spans for
   * one across fact types (orm-format-3, Open decision 9). Never the fact
   * type a 2.0 file happened to nest it under.
   */
  readonly factTypeIds: readonly string[];
  /** The constraint this counterexample probes, when it carries an id. */
  readonly constraintId?: string;
  /** The discriminator of the constraint this counterexample probes. */
  readonly constraintType: Constraint["type"];
  /**
   * The minimal sample populations the constraint forbids -- one per fact
   * type involved. Intra-fact-type counterexamples have a single entry;
   * cross-fact-type ones span the fact types of the violation.
   */
  readonly forbidden: readonly Population[];
  /** Structured reading segments (reused from verbalization for linking). */
  readonly segments: readonly VerbalizationSegment[];
  /** The flattened plain-text reading. */
  readonly text: string;
}
