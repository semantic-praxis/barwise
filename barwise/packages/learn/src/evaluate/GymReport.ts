/**
 * The evaluator's output: one result per rubric check, plus an overall
 * pass flag. Pure data -- the same candidate and exercise always produce
 * the same report.
 */
import type { GymCheck } from "../exercise/types.js";

/** The outcome of running one check against a candidate. */
export interface CheckResult {
  readonly kind: GymCheck["kind"];
  readonly passed: boolean;
  /** A concrete, learner-facing explanation of the outcome. */
  readonly message: string;
  /** Shown only on failure; the exercise author's nudge. */
  readonly hint?: string;
}

/** The full evaluation of a candidate against an exercise. */
export interface GymReport {
  readonly exerciseId: string;
  /** True iff every check passed. */
  readonly passed: boolean;
  /** One result per check, in the order the checks were authored. */
  readonly results: readonly CheckResult[];
}
