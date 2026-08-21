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
import type { GymCheck } from "@barwise/learn";

/** Penalty sizes applied by the scorer, declared in the suite manifest. */
export interface SuiteWeights {
  /** Score subtracted per deterministic conformance correction. */
  readonly conformanceCorrection: number;
  /** Score subtracted per residual error-severity validation diagnostic. */
  readonly validationError: number;
  /**
   * Score subtracted per residual warning-severity validation
   * diagnostic (the lint tier). Omitted in the manifest means 0.
   */
  readonly validationWarning: number;
  /**
   * Score subtracted per ambiguity reported beyond a case's
   * `ambiguityBudget`. Omitted in the manifest means 0. This is the
   * precision half of `requires_ambiguity`: without it, an extraction
   * that flags everything passes every ambiguity check by coincidence.
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
