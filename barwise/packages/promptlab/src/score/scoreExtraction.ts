/**
 * The deterministic scorer: the same extraction payload, case, and
 * weights always produce a byte-identical CaseScore. This is the ground
 * truth both `barwise prompt eval` and the DSPy metric consume -- the
 * optimizer is judged by the exact production parse-and-score path.
 */
import { ValidationEngine } from "@barwise/core";
import type { CheckResult, GymExercise } from "@barwise/learn";
import { evaluateCandidate } from "@barwise/learn";
import { enforceConformance, parseDraftModel, parseExtractionResponse } from "@barwise/llm";
import type { LoadedEvalCase, SuiteWeights } from "../evalcase/types.js";

export interface CaseScore {
  readonly caseId: string;
  readonly rubricPassed: number;
  readonly rubricTotal: number;
  readonly conformanceCorrections: number;
  readonly validationErrors: number;
  /** Warning-severity diagnostics (the lint tier). */
  readonly validationWarnings: number;
  /** rubricPassed/rubricTotal minus weighted penalties, floored at 0. */
  readonly score: number;
  /** Per-check outcomes, in authored order (for delta reports). */
  readonly results: readonly CheckResult[];
}

/**
 * Score one extraction payload (the raw JSON the LLM returned) against
 * an eval case. Throws on a payload that does not parse -- callers that
 * sweep (the suite runner, the DSPy metric) treat that as a zero.
 */
export function scoreExtraction(
  payload: string,
  loadedCase: LoadedEvalCase,
  weights: SuiteWeights,
): CaseScore {
  const extraction = parseExtractionResponse(JSON.parse(payload));
  const { response: cleaned, corrections } = enforceConformance(extraction);
  const { model } = parseDraftModel(cleaned, loadedCase.evalCase.id);

  const diagnostics = new ValidationEngine().validate(model);
  const validationErrors = diagnostics
    .filter((d) => d.severity === "error")
    .length;
  const validationWarnings = diagnostics
    .filter((d) => d.severity === "warning")
    .length;

  const report = evaluateCandidate(
    model,
    asExercise(loadedCase),
    loadedCase.reference,
  );

  const rubricTotal = report.results.length;
  const rubricPassed = report.results.filter((r) => r.passed).length;
  const raw = rubricPassed / rubricTotal
    - weights.conformanceCorrection * corrections.length
    - weights.validationError * validationErrors
    - weights.validationWarning * validationWarnings;

  return {
    caseId: loadedCase.evalCase.id,
    rubricPassed,
    rubricTotal,
    conformanceCorrections: corrections.length,
    validationErrors,
    validationWarnings,
    score: Math.max(0, raw),
    results: report.results,
  };
}

/**
 * Adapt an eval case to the gym's exercise shape so `evaluateCandidate`
 * runs the shared check runners. The learner-facing front matter is
 * synthetic and never surfaces in a CaseScore.
 */
function asExercise(loadedCase: LoadedEvalCase): GymExercise {
  return {
    id: loadedCase.evalCase.id,
    title: loadedCase.evalCase.id,
    transition: { from: "naive", to: "naive" },
    exitPerformance: "n/a (prompt eval)",
    brief: "n/a (prompt eval)",
    checks: loadedCase.evalCase.checks,
  };
}
