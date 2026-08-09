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
}

/** An eval case as authored in a `.eval.yaml` file. */
export interface EvalCase {
  readonly id: string;
  /** Path (relative to the case file) to the fixture transcript. */
  readonly transcript: string;
  /** Path (relative to the case file) to the reference model backing
   *  `forbids_population` checks. */
  readonly reference?: string;
  readonly checks: readonly GymCheck[];
}

/** An eval case with its transcript and reference loaded. */
export interface LoadedEvalCase {
  readonly evalCase: EvalCase;
  /** The transcript text sent to the LLM. */
  readonly transcript: string;
  readonly reference?: OrmModel;
  readonly filePath: string;
}

/** A suite manifest (`suite.yaml`) with every declared case loaded. */
export interface EvalSuite {
  readonly version: string;
  readonly weights: SuiteWeights;
  readonly cases: readonly LoadedEvalCase[];
  readonly manifestPath: string;
}
