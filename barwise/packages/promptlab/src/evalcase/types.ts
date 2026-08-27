/**
 * The eval-case format for prompt evaluation
 * (docs/specs/prompt-optimization-harness.spec.md, workstream 2).
 *
 * An eval case pairs a fixture transcript with a rubric of semantic
 * checks -- the same `GymCheck` vocabulary the modeling gym uses -- and
 * a reference model that backs `forbids_population` derivation. A suite
 * manifest declares its cases explicitly and carries the score weights,
 * so reweighting is a data change recorded in git.
 */
import type { OrmModel } from "@barwise/core";
import type { GymCheck, NameLicence } from "@barwise/learn";

/**
 * Penalty sizes applied by the scorer, declared in the suite manifest.
 *
 * As of suite 2.0.0 the first three are **rates**, not per-occurrence
 * charges: the scorer divides each rule's occurrence count by the
 * scored model's element count before applying the weight, so a weight
 * reads as the cost of a model in which every element carries that kind
 * of defect (docs/specs/eval-split-stratification.spec.md). The types
 * did not change when the meaning did, so the manifest `version` is the
 * only signal that a weight authored against the old scale is wrong.
 */
export interface SuiteWeights {
  /** Rated cost of conformance corrections, per element. */
  readonly conformanceCorrection: number;
  /** Rated cost of residual error-severity validation diagnostics, per element. */
  readonly validationError: number;
  /**
   * Rated cost of residual warning-severity validation diagnostics (the
   * lint tier), per element. Omitted in the manifest means the 2.0.0
   * default rather than 0.
   */
  readonly validationWarning: number;
  /**
   * Score subtracted per ambiguity reported beyond a case's
   * `ambiguityBudget`. Omitted in the manifest means the 2.0.0 default
   * rather than 0. This is the precision half of `requires_ambiguity`:
   * without it, an extraction that flags everything passes every
   * ambiguity check by coincidence.
   *
   * Unrated, alone among the four: it is charged against a per-case
   * authored budget, so it is a rate already and dividing it by element
   * count would divide twice.
   */
  readonly ambiguityExcess: number;
}

/**
 * A promptlab-native check, evaluated against the extraction payload
 * rather than the parsed model
 * (docs/specs/eval-transcript-realism.spec.md).
 *
 * `@barwise/learn` grades an `OrmModel` for a human learner, and
 * `evaluateCandidate` never sees the payload -- so a check over the
 * extractor's ambiguity list has no home in the `GymCheck` union and
 * lives here instead.
 */
export type PromptCheck = {
  readonly kind: "requires_ambiguity";
  /**
   * Case-insensitive substrings. An ambiguity matches when its
   * description contains every one of them, so a multi-term match
   * narrows rather than widens.
   */
  readonly matches: readonly string[];
  /** Shown only on failure; the case author's nudge. */
  readonly hint?: string;
};

/** True for checks promptlab evaluates itself. */
export function isPromptCheck(check: GymCheck | PromptCheck): check is PromptCheck {
  return check.kind === "requires_ambiguity";
}

/** An eval case as authored in a `.eval.yaml` file. */
export interface EvalCase {
  readonly id: string;
  /** Path (relative to the case file) to the fixture transcript. */
  readonly transcript: string;
  /** Path (relative to the case file) to the reference model backing
   *  `forbids_population` checks. */
  readonly reference?: string;
  /**
   * How many ambiguities this transcript can carry before the excess
   * penalty applies. Omitted means unbounded -- which is what every
   * case written before this field meant, so the seed suite is
   * unaffected.
   */
  readonly ambiguityBudget?: number;
  /**
   * Optional licensed names (docs/specs/eval-name-licensing.spec.md):
   * each entry lists words the case declares to denote one concept, so
   * an extraction naming it with any of them resolves against a rubric
   * or reference name using another. Both check families consult it --
   * `requires_element` when resolving a named object type, and
   * `forbids_population` when corresponding fact types by player names
   * -- and it only ever rescues a comparison that would otherwise fail.
   */
  readonly vocabulary?: NameLicence;
  readonly checks: readonly (GymCheck | PromptCheck)[];
}

/** Which half of the suite a case belongs to. */
export type SuiteSplit = "train" | "dev";

/** An eval case with its transcript and reference loaded. */
export interface LoadedEvalCase {
  readonly evalCase: EvalCase;
  /**
   * The split this case belongs to, when the manifest declares splits.
   * Absent means the manifest declares none and every case runs.
   */
  readonly split?: SuiteSplit;
  /** The transcript text sent to the LLM. */
  readonly transcript: string;
  readonly reference?: OrmModel;
  readonly filePath: string;
}

/** A suite manifest (`suite.yaml`) with every declared case loaded. */
export interface EvalSuite {
  readonly version: string;
  readonly weights: SuiteWeights;
  /**
   * Score below which a scored sample counts as a collapse rather than
   * a bad model (docs/specs/eval-metric-readiness.spec.md). Declared in
   * the manifest, not in code, for the same reason the weights are: it
   * is a judgment, and a judgment belongs in a reviewable diff.
   * Omitted means no split, and today's report byte for byte.
   */
  readonly collapseFloor?: number;
  readonly cases: readonly LoadedEvalCase[];
  readonly manifestPath: string;
}
