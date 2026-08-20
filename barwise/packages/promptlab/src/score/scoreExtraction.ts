/**
 * The deterministic scorer: the same extraction payload, case, and
 * weights always produce a byte-identical CaseScore. This is the ground
 * truth both `barwise prompt eval` and the DSPy metric consume -- the
 * optimizer is judged by the exact production parse-and-score path.
 */
import { ValidationEngine } from "@barwise/core";
import type { GymCheck, GymExercise } from "@barwise/learn";
import { evaluateCandidate } from "@barwise/learn";
import { enforceConformance, parseDraftModel, parseExtractionResponse } from "@barwise/llm";
import type { LoadedEvalCase, PromptCheck, SuiteWeights } from "../evalcase/types.js";
import { isPromptCheck } from "../evalcase/types.js";
import type { PromptCheckResult } from "./promptChecks.js";
import { ambiguityExcess, runPromptChecks } from "./promptChecks.js";

export interface CaseScore {
  readonly caseId: string;
  readonly rubricPassed: number;
  readonly rubricTotal: number;
  readonly conformanceCorrections: number;
  readonly validationErrors: number;
  /** Warning-severity diagnostics (the lint tier). */
  readonly validationWarnings: number;
  /** Ambiguities reported in the payload, whatever the budget. */
  readonly ambiguitiesReported: number;
  /** Ambiguities beyond the case's budget; 0 when none is declared. */
  readonly ambiguityExcess: number;
  /** rubricPassed/rubricTotal minus weighted penalties, floored at 0. */
  readonly score: number;
  /** Per-check outcomes, in authored order (for delta reports). */
  readonly results: readonly PromptCheckResult[];
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

  // One payload, two graders: the model half runs through the gym's
  // check runners, the payload half through promptlab's own. Both fold
  // into a single rubric fraction, in authored order.
  const declared = loadedCase.evalCase.checks;
  const gymChecks = declared.filter((c): c is GymCheck => !isPromptCheck(c));
  const promptChecks = declared.filter(isPromptCheck);

  const report = evaluateCandidate(
    model,
    asExercise(loadedCase, gymChecks),
    loadedCase.reference,
  );
  const promptResults = runPromptChecks(promptChecks, extraction.ambiguities);
  const results = orderAsAuthored(declared, report.results, promptResults);

  const ambiguitiesReported = extraction.ambiguities.length;
  const excess = ambiguityExcess(
    ambiguitiesReported,
    loadedCase.evalCase.ambiguityBudget,
  );

  const rubricTotal = results.length;
  const rubricPassed = results.filter((r) => r.passed).length;
  const raw = rubricPassed / rubricTotal
    - weights.conformanceCorrection * corrections.length
    - weights.validationError * validationErrors
    - weights.validationWarning * validationWarnings
    - weights.ambiguityExcess * excess;

  return {
    caseId: loadedCase.evalCase.id,
    rubricPassed,
    rubricTotal,
    conformanceCorrections: corrections.length,
    validationErrors,
    validationWarnings,
    ambiguitiesReported,
    ambiguityExcess: excess,
    score: Math.max(0, raw),
    results,
  };
}

/**
 * Reassemble the two graders' results into the order the case author
 * wrote them, so a delta report reads down the rubric as authored.
 * Each grader returns its own subset in its own authored order, so
 * walking the declarations and shifting from the matching queue is
 * enough.
 */
function orderAsAuthored(
  declared: readonly (GymCheck | PromptCheck)[],
  gymResults: readonly PromptCheckResult[],
  promptResults: readonly PromptCheckResult[],
): PromptCheckResult[] {
  const gym = [...gymResults];
  const prompt = [...promptResults];
  return declared.map((check) => {
    const next = isPromptCheck(check) ? prompt.shift() : gym.shift();
    /* c8 ignore next 3 -- both graders return one result per declared
       check, so the queues cannot run dry; the guard keeps the types
       honest rather than covering a reachable branch. */
    if (next === undefined) {
      throw new Error(`Scorer produced no result for a "${check.kind}" check.`);
    }
    return next;
  });
}

/**
 * Adapt an eval case to the gym's exercise shape so `evaluateCandidate`
 * runs the shared check runners. Only the gym's own check family is
 * passed through -- `evaluateCandidate` takes an `OrmModel` and has no
 * vocabulary for the payload checks. The learner-facing front matter is
 * synthetic and never surfaces in a CaseScore.
 */
function asExercise(
  loadedCase: LoadedEvalCase,
  checks: readonly GymCheck[],
): GymExercise {
  return {
    id: loadedCase.evalCase.id,
    title: loadedCase.evalCase.id,
    transition: { from: "naive", to: "naive" },
    exitPerformance: "n/a (prompt eval)",
    brief: "n/a (prompt eval)",
    checks,
  };
}
