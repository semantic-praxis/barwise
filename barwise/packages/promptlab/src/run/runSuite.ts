/**
 * The suite runner: extract every case's transcript through the LLM
 * with the active prompt artifact and score each run deterministically.
 * The only non-determinism here is the LLM call itself; a score is a
 * sample, so `repeat` controls how many samples each case gets.
 *
 * Two kinds of bad run, deliberately kept apart (barwise-806):
 *
 * - The model never answered -- auth rejected, rate limited, connection
 *   dropped. That is not a measurement of anything, so it is excluded
 *   from the mean and counted as a failure. Folding it in as a zero is
 *   how three junk rows reached the score history on the first keyed
 *   run of this harness.
 * - The model answered and the answer could not be scored. That is a
 *   real result and stays a zero: the prompt produced something the
 *   production parse path rejects, which is exactly what the metric
 *   exists to catch.
 */
import type { LlmClient, PromptArtifact } from "@barwise/llm";
import {
  buildResponseSchema,
  buildSystemPrompt,
  buildUserMessage,
  defaultExtractionArtifact,
} from "@barwise/llm";
import type { EvalSuite, SuiteSplit } from "../evalcase/types.js";
import { hashPrompt } from "../provenance/promptHash.js";
import type { CaseScore } from "../score/scoreExtraction.js";
import { scoreExtraction } from "../score/scoreExtraction.js";
import type { Dispersion } from "../stats/dispersion.js";
import { dispersionOf, sampleSd, splitAtFloor } from "../stats/dispersion.js";
import type { FailureKind, RetryOptions } from "./retry.js";
import { withRetry } from "./retry.js";

export interface RunSuiteOptions {
  /** Variant artifact to render; omitted, the default artifact runs. */
  readonly artifact?: PromptArtifact;
  /** Samples per case (default 1). */
  readonly repeat?: number;
  /** Retry policy for provider failures. */
  readonly retry?: RetryOptions;
  /**
   * Run only one half of the suite. Omitted runs every case, which is
   * what a manifest without splits means anyway.
   *
   * The point of selecting `dev` is that no prompt has been tuned
   * against it: a candidate that wins on train and loses on dev fitted
   * the suite rather than the task (eval-metric-readiness spec).
   */
  readonly split?: SuiteSplit;
}

/** One LLM call's outcome. */
export interface CaseRun {
  /** Present when the run produced a score, including a scored zero. */
  readonly score?: CaseScore;
  /** The message behind a failed or unscorable run. */
  readonly error?: string;
  /**
   * Set when the provider never returned a payload. Such a run is
   * excluded from the mean rather than scored zero.
   */
  readonly failed?: boolean;
  /** How a failed run was judged, for the operator's diagnosis. */
  readonly failureKind?: FailureKind;
  /** Attempts spent on this run, including the first. */
  readonly attempts?: number;
  readonly modelUsed?: string;
}

export interface CaseSummary {
  readonly caseId: string;
  readonly runs: readonly CaseRun[];
  /** Mean over scored runs only; 0 when every run failed. */
  readonly mean: number;
  /** Lowest scored run; 0 when every run failed. */
  readonly worst: number;
  /** Runs that produced a score (the denominator behind `mean`). */
  readonly samples: number;
  /** Runs the provider never answered. */
  readonly failures: number;
  /**
   * Sample standard deviation of this case's scores. Absent below two
   * samples: one run says nothing about spread, and a 0 would claim it
   * says everything.
   */
  readonly sd?: number;
  /**
   * Scored samples below the suite's `collapseFloor`. Absent when the
   * manifest declares no floor.
   */
  readonly collapses?: number;
  /**
   * Mean over the samples at or above the floor -- how good the model
   * was when it survived. Absent when nothing survived: a case that
   * always collapsed has no quality to report, which is a different
   * statement from modelling badly.
   */
  readonly qualityMean?: number;
  /** Spread of those same samples; absent below two of them. */
  readonly qualitySd?: number;
}

export interface SuiteReport {
  readonly suiteVersion: string;
  readonly artifactVersion: string;
  /**
   * Fingerprint of the system prompt this run actually sent. Unlike
   * `artifactVersion`, which is a hand-maintained string, this cannot
   * agree across two runs that rendered different prompts.
   */
  readonly promptHash: string;
  readonly repeat: number;
  readonly cases: readonly CaseSummary[];
  /** Mean of the per-case means, over cases with at least one sample. */
  readonly mean: number;
  /** Lowest single scored run across the suite. */
  readonly worst: number;
  /** Total runs the provider never answered. */
  readonly failures: number;
  /** True when every requested run produced a score. */
  readonly complete: boolean;
  /** Which half ran, when one was selected. */
  readonly split?: SuiteSplit;
  /**
   * How much of `mean` is sampling noise. Read this before comparing
   * two runs: a gap under `resolvableDifference` is not a result.
   */
  readonly dispersion: Dispersion;
}

export async function runSuite(
  suite: EvalSuite,
  client: LlmClient,
  options?: RunSuiteOptions,
): Promise<SuiteReport> {
  const repeat = options?.repeat ?? 1;
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error(`repeat must be a positive integer, got ${repeat}.`);
  }

  const artifact = options?.artifact;
  if (artifact !== undefined && artifact.surface !== "extraction") {
    throw new Error(
      `Prompt artifact surface "${artifact.surface}" cannot drive transcript extraction.`,
    );
  }
  const selected = options?.split;
  const suiteCases = selected === undefined
    ? suite.cases
    : suite.cases.filter((c) => c.split === selected);
  if (suiteCases.length === 0) {
    throw new Error(
      `No cases in split "${selected}". Declare a "splits" block in the suite manifest.`,
    );
  }

  const systemPrompt = buildSystemPrompt(false, artifact);
  const responseSchema = buildResponseSchema(false);

  const runOnce = async (loadedCase: EvalSuite["cases"][number]): Promise<CaseRun> => {
    const attempt = await withRetry(
      () =>
        client.complete({
          systemPrompt,
          userMessage: buildUserMessage(loadedCase.transcript),
          responseSchema,
        }),
      options?.retry,
    );

    if (!attempt.ok) {
      return {
        error: attempt.error.message,
        failed: true,
        failureKind: attempt.kind,
        attempts: attempt.attempts,
      };
    }

    const response = attempt.value;
    try {
      const score = scoreExtraction(response.content, loadedCase, suite.weights);
      return {
        score,
        attempts: attempt.attempts,
        ...(response.modelUsed !== undefined ? { modelUsed: response.modelUsed } : {}),
      };
    } catch (err) {
      // The model answered; the answer was unusable. A real zero.
      return {
        score: unscorable(loadedCase.evalCase.id),
        error: (err as Error).message,
        attempts: attempt.attempts,
        ...(response.modelUsed !== undefined ? { modelUsed: response.modelUsed } : {}),
      };
    }
  };

  const cases: CaseSummary[] = [];
  for (const loadedCase of suiteCases) {
    const runs: CaseRun[] = [];
    for (let i = 0; i < repeat; i++) {
      runs.push(await runOnce(loadedCase));
    }
    const scores = runs
      .filter((r) => r.score !== undefined)
      .map((r) => r.score!.score);
    const sd = sampleSd(scores);
    // The floor separates "did it survive" from "how good when it did".
    // Both are reported; neither replaces `mean`, so every recorded
    // history row stays comparable (eval-metric-readiness spec).
    // Named for the floor, not the train/dev split above -- two
    // different senses of the word meet in this function.
    const atFloor = suite.collapseFloor === undefined
      ? undefined
      : splitAtFloor(scores, suite.collapseFloor);
    const qualityMean = atFloor && atFloor.quality.length > 0
      ? mean(atFloor.quality)
      : undefined;
    const qualitySd = atFloor ? sampleSd(atFloor.quality) : undefined;
    cases.push({
      caseId: loadedCase.evalCase.id,
      runs,
      mean: scores.length > 0 ? mean(scores) : 0,
      worst: scores.length > 0 ? Math.min(...scores) : 0,
      samples: scores.length,
      failures: runs.filter((r) => r.failed === true).length,
      ...(sd !== undefined ? { sd } : {}),
      ...(atFloor !== undefined ? { collapses: atFloor.collapses } : {}),
      ...(qualityMean !== undefined ? { qualityMean } : {}),
      ...(qualitySd !== undefined ? { qualitySd } : {}),
    });
  }

  const scored = cases.filter((c) => c.samples > 0);
  const failures = cases.reduce((sum, c) => sum + c.failures, 0);
  return {
    suiteVersion: suite.version,
    artifactVersion: (artifact ?? defaultExtractionArtifact).version,
    promptHash: hashPrompt(systemPrompt),
    repeat,
    cases,
    mean: scored.length > 0 ? mean(scored.map((c) => c.mean)) : 0,
    worst: scored.length > 0 ? Math.min(...scored.map((c) => c.worst)) : 0,
    failures,
    complete: failures === 0,
    ...(selected !== undefined ? { split: selected } : {}),
    dispersion: dispersionOf(cases),
  };
}

/**
 * The score for a payload the production parse path rejected. Zero
 * rubric checks passed out of zero declared is not a meaningful
 * fraction, so the rubric totals stay at 0 and the score is 0 -- the
 * run is counted as a sample because the model did answer.
 */
function unscorable(caseId: string): CaseScore {
  return {
    caseId,
    rubricPassed: 0,
    rubricTotal: 0,
    conformanceCorrections: 0,
    validationErrors: 0,
    validationWarnings: 0,
    ambiguitiesReported: 0,
    ambiguityExcess: 0,
    score: 0,
    results: [],
  };
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
