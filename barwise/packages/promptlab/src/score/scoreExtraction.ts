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
  /**
   * Which validation rules warned, and how many times each.
   *
   * The count alone says a run lost 0.30 without saying to what. On the
   * first `repeat=5` baseline warnings were roughly 80% of everything
   * lost across the suite, and the recorded answer keys produce none at
   * all -- so the cost is addressable, and this is what says which rule
   * to address (docs/specs/eval-diagnosis.spec.md).
   *
   * Empty rather than absent when nothing warned: a reader should not
   * have to distinguish "no warnings" from "not measured".
   */
  readonly warningsByRule: Readonly<Record<string, number>>;
  /**
   * Which validation rules errored, and how many times each.
   *
   * The sibling of `warningsByRule`, and the one that was missing.
   * An error costs 0.1 against a warning's 0.05, so the record named
   * the cheaper signal and counted the dearer one -- which is how
   * "did that fix move the baseline" became a question only a paid
   * re-run could answer. Empty rather than absent when nothing
   * errored, for the same reason as warnings.
   */
  readonly errorsByRule: Readonly<Record<string, number>>;
  /**
   * Which conformance checks fired, and how many times each.
   *
   * The third tally, and the one the barwise-813 diagnostic round needs
   * most: three of the promotion candidates are now handled by
   * conformance rather than by prompt text, so pricing them means
   * counting `invalid_bounds` and its siblings. A lump
   * `conformanceCorrections` number cannot separate a category worth
   * attacking from one that is merely noticed -- and on the recorded
   * answer keys all fourteen corrections are a single category.
   */
  readonly correctionsByCategory: Readonly<Record<string, number>>;
  /** Ambiguities reported in the payload, whatever the budget. */
  readonly ambiguitiesReported: number;
  /** Ambiguities beyond the case's budget; 0 when none is declared. */
  readonly ambiguityExcess: number;
  /**
   * Object types plus fact types in the scored model: the denominator
   * every size-rated penalty is divided by.
   *
   * Recorded rather than left for readers to recompute, for the reason
   * `MetricLog.scored` exists -- a denominator each consumer derives
   * for itself is a denominator two consumers will eventually derive
   * differently. It is also the tripwire on the one thing rating leaves
   * unpunished: a candidate whose mean `elementCount` climbs alongside
   * its score is inflating its own denominator
   * (docs/specs/eval-split-stratification.spec.md).
   */
  readonly elementCount: number;
  /**
   * rubricPassed/rubricTotal minus size-rated weighted penalties,
   * floored at 0.
   */
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
  const errors = diagnostics.filter((d) => d.severity === "error");
  const validationErrors = errors.length;
  const warnings = diagnostics.filter((d) => d.severity === "warning");
  const validationWarnings = warnings.length;
  // Every rule that fired is listed, not a top-N. The tally exists to
  // find the dominant rule, but a rule firing once here is still the
  // difference between a passing and a failing case elsewhere.
  const warningsByRule = tallyByRule(warnings);
  // Errors get the same treatment, and needed it more: they weigh 0.1
  // against a warning's 0.05, so the more expensive signal was the one
  // recorded as a bare count. That asymmetry made a real question
  // unanswerable -- whether the ring-player and population fixes moved
  // the recorded baselines could not be read off the record, because
  // the record said how many errors a run had and never which
  // (docs/specs/pipeline-observability.spec.md).
  const errorsByRule = tallyByRule(errors);
  const correctionsByCategory: Record<string, number> = {};
  for (const c of corrections) {
    correctionsByCategory[c.category] = (correctionsByCategory[c.category] ?? 0) + 1;
  }

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

  // Penalties are rated by model size, not counted. The rubric half of
  // the score is a fraction bounded to [0, 1] by construction; charging
  // the penalty half per occurrence made the two halves scale
  // differently, so a longer transcript paid more for the same defect
  // *rate* and the clamp below swallowed the difference. Three of the
  // four recorded compilation arms floored at 0.000 and compared equal
  // (docs/specs/eval-split-stratification.spec.md).
  //
  // One denominator serves every rule, knowingly: rating each rule
  // against the population it can actually fire on would make every new
  // validator rule a promptlab change, and across the seven reference
  // models fact types are a near-constant 33-50% of elements, so a
  // single denominator is off by a constant factor for the rules that
  // dominate the tallies -- which is what a weight absorbs.
  //
  // A weight therefore reads as the cost of a model in which *every*
  // element carries that kind of defect. `ambiguityExcess` is left
  // unrated: it is charged against a per-case authored budget, so it is
  // a rate already and rating it again would divide twice.
  //
  // A model with no elements charges nothing rather than dividing by
  // zero. Falling back to the raw count there would make the emptiest
  // possible extraction the one case still scored the old way, and it
  // is already scored by the rubric fraction, which no empty model
  // satisfies.
  const elementCount = model.objectTypes.length + model.factTypes.length;
  const rated = (occurrences: number): number =>
    elementCount === 0 ? 0 : occurrences / elementCount;

  const raw = rubricPassed / rubricTotal
    - weights.conformanceCorrection * rated(corrections.length)
    - weights.validationError * rated(validationErrors)
    - weights.validationWarning * rated(validationWarnings)
    - weights.ambiguityExcess * excess;

  return {
    caseId: loadedCase.evalCase.id,
    rubricPassed,
    rubricTotal,
    conformanceCorrections: corrections.length,
    validationErrors,
    validationWarnings,
    warningsByRule,
    errorsByRule,
    correctionsByCategory,
    ambiguitiesReported,
    ambiguityExcess: excess,
    elementCount,
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
    ...(loadedCase.evalCase.vocabulary !== undefined
      ? { vocabulary: loadedCase.evalCase.vocabulary }
      : {}),
    checks,
  };
}

/**
 * Count diagnostics by rule id.
 *
 * Shared by the warning and error tallies rather than written twice --
 * two copies of this is exactly how the two came to disagree, one
 * naming its rules and the other not.
 */
function tallyByRule(
  diagnostics: readonly { readonly ruleId?: string; }[],
): Record<string, number> {
  const total: Record<string, number> = {};
  for (const d of diagnostics) {
    const id = d.ruleId ?? "(unattributed)";
    total[id] = (total[id] ?? 0) + 1;
  }
  return total;
}
