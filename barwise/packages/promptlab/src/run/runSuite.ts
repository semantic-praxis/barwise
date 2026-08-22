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
 *
 * A third kind joined them: the model answered and the answer was cut
 * off at the output-token ceiling. That measures the budget the caller
 * set, not the prompt, so it is excluded with the first group rather
 * than scored with the second (docs/specs/output-budget.spec.md). It is
 * the most dangerous of the three, because a truncated tool_use block
 * still parses -- it arrives as well-formed JSON containing almost
 * nothing, and scored a near-zero three runs running before anything
 * said why.
 */
import type { LlmClient, PromptArtifact } from "@barwise/llm";
import {
  buildResponseSchema,
  buildSystemPrompt,
  buildUserMessage,
  defaultExtractionArtifact,
  suggestMaxTokens,
} from "@barwise/llm";
import type { EvalSuite, SuiteSplit } from "../evalcase/types.js";
import { hashPrompt } from "../provenance/promptHash.js";
import type { CaseScore } from "../score/scoreExtraction.js";
import { scoreExtraction } from "../score/scoreExtraction.js";
import type { Dispersion } from "../stats/dispersion.js";
import { dispersionOf, sampleSd, splitAtFloor } from "../stats/dispersion.js";
import type { FailureKind, RetryOptions } from "./retry.js";
import { describeProviderError, withRetry } from "./retry.js";

/**
 * What a run says about itself while it is still running.
 *
 * A sweep is dozens of sequential provider calls and used to print
 * nothing until all of them finished, which makes a rate-limited run
 * and a hung one look identical. The events are pushed to a caller-
 * supplied sink rather than written here, for the same reason the date
 * and the build provenance are: this package does no I/O.
 */
export type RunProgress =
  | {
    readonly kind: "sample";
    readonly caseId: string;
    /** 1-based position of this case among those being run. */
    readonly caseIndex: number;
    readonly caseCount: number;
    /** 1-based sample number within the case. */
    readonly run: number;
    readonly repeat: number;
    readonly attempts: number;
    /** Absent when the provider never answered. */
    readonly score?: number;
    /** True when the provider never answered; the sample is excluded. */
    readonly failed?: boolean;
    /**
     * True when the answer was cut off at the output ceiling. Also
     * `failed`, and reported separately because the two call for
     * opposite responses: a failure means look at the provider, a
     * truncation means raise `--max-tokens` and re-run.
     */
    readonly truncated?: boolean;
    /** True when the score fell below the suite's collapse floor. */
    readonly collapsed?: boolean;
    readonly latencyMs?: number;
    /** Tokens generated, against the ceiling this call was given. */
    readonly outputTokens?: number;
    readonly maxTokens?: number;
    /** Why a run failed, or why a payload could not be scored. */
    readonly error?: string;
  }
  | {
    readonly kind: "retry";
    readonly caseId: string;
    readonly run: number;
    readonly attempt: number;
    readonly delayMs: number;
    readonly error: string;
  };

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
  /**
   * Output-token ceiling for every call in the run, overriding the
   * budget each case would otherwise derive from its own transcript
   * length. One number for the whole sweep on purpose: the derived
   * budget is a floor against truncation, and an operator raising it
   * is answering "was this run starved", which is a question about the
   * run and not about one case.
   */
  readonly maxTokens?: number;
  /**
   * Called as each sample finishes and before each retry backoff.
   * Omitted, the run is silent, which is what every caller before this
   * got.
   */
  readonly onProgress?: (event: RunProgress) => void;
}

/** One LLM call's outcome. */
export interface CaseRun {
  /** Present when the run produced a score, including a scored zero. */
  readonly score?: CaseScore;
  /** The message behind a failed or unscorable run. */
  readonly error?: string;
  /**
   * Set when the run produced no usable payload -- the provider never
   * answered, or the answer was cut off. Such a run is excluded from
   * the mean rather than scored zero.
   */
  readonly failed?: boolean;
  /** How a failed run was judged, for the operator's diagnosis. */
  readonly failureKind?: FailureKind;
  /** Set when the answer stopped at the output-token ceiling. */
  readonly truncated?: boolean;
  /** Attempts spent on this run, including the first. */
  readonly attempts?: number;
  readonly modelUsed?: string;
  /**
   * Wall-clock time the provider reported for this call. Measured by
   * every provider already and dropped on the floor until now; kept so
   * progress output can show a run getting slower.
   */
  readonly latencyMs?: number;
  /**
   * The provider's own word for why it stopped. `truncated` is the
   * derived answer; this is the evidence, and it is what a provider's
   * documentation is written against.
   */
  readonly stopReason?: string;
  /** Tokens the provider billed for this call, where it reported them. */
  readonly promptTokens?: number;
  readonly outputTokens?: number;
  /**
   * The ceiling this call was given. Meaningless alone and the whole
   * story next to `outputTokens`: equal values are a truncation, and a
   * near-equal pair on a healthy run is the warning that the next,
   * slightly longer transcript will not fit.
   */
  readonly maxTokens?: number;
  /** HTTP status behind a failure, where the SDK reported one. */
  readonly status?: number;
  /** The provider's error taxonomy, e.g. "rate_limit_error". */
  readonly errorType?: string;
  /**
   * Provider-side identifier for the call. Worth keeping precisely
   * because it is useless locally: it is the only handle anyone has on
   * a call that already happened when asking the provider about it.
   */
  readonly requestId?: string;
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
  /** Runs that produced no usable payload, truncations included. */
  readonly failures: number;
  /**
   * The subset of `failures` that were cut off at the output ceiling.
   * Broken out because it is the one failure an operator fixes without
   * touching the provider: raise the budget and re-run.
   */
  readonly truncations: number;
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
  /** Total runs that produced no usable payload. */
  readonly failures: number;
  /** The subset of those cut off at the output ceiling. */
  readonly truncations: number;
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

  // Every call in a sweep sends the same ~5,780-token preamble -- the
  // system prompt plus the schema riding in the tool definition -- so
  // caching it turns fifty full-price copies into one write and
  // forty-nine reads (docs/specs/prompt-caching.spec.md).
  //
  // Both conditions are about break-even, and they differ. A cache
  // write costs about 1.25x and a read 0.1x, so a breakpoint only pays
  // from the second request that reads it. The preamble repeats across
  // every call the run makes; a transcript only repeats when the same
  // case is sampled again. A run of one call reads neither back.
  const totalCalls = suiteCases.length * repeat;
  const cacheSystemPrompt = totalCalls >= 2;
  const cacheUserMessage = repeat >= 2;

  const report = options?.onProgress;

  const runOnce = async (
    loadedCase: EvalSuite["cases"][number],
    run: number,
  ): Promise<CaseRun> => {
    const caseId = loadedCase.evalCase.id;
    // Derived per case, not per run: the transcript does not change
    // between samples, so neither should the budget -- two samples of
    // one case must stay comparable to each other.
    const maxTokens = options?.maxTokens ?? suggestMaxTokens(loadedCase.transcript);
    const attempt = await withRetry(
      () =>
        client.complete({
          systemPrompt,
          userMessage: buildUserMessage(loadedCase.transcript),
          responseSchema,
          maxTokens,
          cacheSystemPrompt,
          cacheUserMessage,
        }),
      {
        ...options?.retry,
        onRetry: (info) => {
          options?.retry?.onRetry?.(info);
          report?.({
            kind: "retry",
            caseId,
            run,
            attempt: info.attempt,
            delayMs: info.delayMs,
            error: info.error.message,
          });
        },
      },
    );

    if (!attempt.ok) {
      const info = describeProviderError(attempt.error);
      return {
        error: info.message,
        failed: true,
        failureKind: attempt.kind,
        attempts: attempt.attempts,
        maxTokens,
        ...(info.status !== undefined ? { status: info.status } : {}),
        ...(info.errorType !== undefined ? { errorType: info.errorType } : {}),
        ...(info.requestId !== undefined ? { requestId: info.requestId } : {}),
      };
    }

    const response = attempt.value;
    // Everything the provider said about the call, kept whether it
    // succeeded or not: on a healthy run the token pair is the early
    // warning that the next transcript will not fit.
    const said: CaseRun = {
      attempts: attempt.attempts,
      maxTokens,
      ...(response.modelUsed !== undefined ? { modelUsed: response.modelUsed } : {}),
      ...(response.latencyMs !== undefined ? { latencyMs: response.latencyMs } : {}),
      ...(response.stopReason !== undefined ? { stopReason: response.stopReason } : {}),
      ...(response.usage?.promptTokens !== undefined
        ? { promptTokens: response.usage.promptTokens }
        : {}),
      ...(response.usage?.completionTokens !== undefined
        ? { outputTokens: response.usage.completionTokens }
        : {}),
    };

    if (response.truncated === true) {
      // Excluded, not scored. What a truncated payload measures is the
      // ceiling this call was given; scoring it would put the caller's
      // budget into a number that reads as prompt quality.
      return {
        ...said,
        error: `the answer was cut off at the ${maxTokens}-token output ceiling`
          + ` (stop reason: ${response.stopReason ?? "unreported"}).`
          + ` Re-run with a larger --max-tokens.`,
        failed: true,
        failureKind: "truncated",
        truncated: true,
      };
    }

    try {
      return { ...said, score: scoreExtraction(response.content, loadedCase, suite.weights) };
    } catch (err) {
      // The model answered in full; the answer was unusable. A real zero.
      return {
        ...said,
        score: unscorable(loadedCase.evalCase.id),
        error: (err as Error).message,
      };
    }
  };

  const cases: CaseSummary[] = [];
  for (const loadedCase of suiteCases) {
    const runs: CaseRun[] = [];
    const caseIndex = suiteCases.indexOf(loadedCase) + 1;
    for (let i = 0; i < repeat; i++) {
      const run = await runOnce(loadedCase, i + 1);
      runs.push(run);
      const score = run.score?.score;
      report?.({
        kind: "sample",
        caseId: loadedCase.evalCase.id,
        caseIndex,
        caseCount: suiteCases.length,
        run: i + 1,
        repeat,
        attempts: run.attempts ?? 1,
        ...(score !== undefined ? { score } : {}),
        ...(run.failed === true ? { failed: true } : {}),
        ...(run.truncated === true ? { truncated: true } : {}),
        ...(score !== undefined && suite.collapseFloor !== undefined
            && score < suite.collapseFloor
          ? { collapsed: true }
          : {}),
        ...(run.latencyMs !== undefined ? { latencyMs: run.latencyMs } : {}),
        ...(run.outputTokens !== undefined ? { outputTokens: run.outputTokens } : {}),
        ...(run.maxTokens !== undefined ? { maxTokens: run.maxTokens } : {}),
        ...(run.error !== undefined ? { error: run.error } : {}),
      });
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
      truncations: runs.filter((r) => r.truncated === true).length,
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
    truncations: cases.reduce((sum, c) => sum + c.truncations, 0),
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
