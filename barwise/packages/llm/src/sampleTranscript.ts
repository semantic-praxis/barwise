/**
 * Multi-sample transcript extraction
 * (docs/specs/multi-sample-import.spec.md, workstream 2).
 *
 * Draws n independent samples through the unchanged single-shot
 * pipeline and emits the medoid sample's result verbatim, with the
 * agreement fold's disagreements appended to its ambiguities. The
 * calls run sequentially on purpose: the first call writes the
 * prompt-cache entry the rest read, and retry behavior stays whatever
 * the client already does. Each call shares the caller's observer and
 * correlation id, so `llm-usage` shows one import as n correlated
 * calls.
 *
 * A failed sample (the provider errored, or the payload did not parse)
 * is excluded and reported, never retried here. One survivor degrades
 * to single-sample behavior with a warning; zero survivors rethrow the
 * last failure, which is what a single-sample import does today.
 */
import type { DraftModelResult } from "./ExtractionTypes.js";
import type { LlmClient } from "./LlmClient.js";
import { computeSampleAgreement, type SampleAgreement } from "./sampleAgreement.js";
import { type ProcessorOptions, processTranscript } from "./TranscriptProcessor.js";

/** The spec's bounds: below 2 is single-shot, above 5 buys little for linear cost. */
export const MIN_SAMPLES = 2;
export const MAX_SAMPLES = 5;

/** What happened to one draw. */
export interface SampleOutcome {
  readonly index: number;
  readonly status: "ok" | "failed";
  readonly error?: string;
}

export interface SampledDraftResult extends DraftModelResult {
  /** The fold over the surviving samples. */
  readonly agreement: SampleAgreement;
  /** Per-draw outcomes, in draw order. */
  readonly samples: readonly SampleOutcome[];
}

/**
 * Run the extraction `samples` times and fold. The returned result IS
 * the medoid sample's `DraftModelResult` -- a model some run actually
 * produced -- with the agreement ambiguities appended and, when draws
 * failed, a warning naming them.
 */
export async function sampleTranscript(
  transcript: string,
  client: LlmClient,
  options: ProcessorOptions & { readonly samples: number; },
): Promise<SampledDraftResult> {
  const { samples, ...processorOptions } = options;
  if (!Number.isInteger(samples) || samples < MIN_SAMPLES || samples > MAX_SAMPLES) {
    throw new Error(
      `samples must be an integer in [${MIN_SAMPLES}, ${MAX_SAMPLES}]; got ${samples}. `
        + `(A single sample is the plain import -- omit the option.)`,
    );
  }

  const outcomes: SampleOutcome[] = [];
  const results: DraftModelResult[] = [];
  let lastFailure: unknown;
  for (let i = 0; i < samples; i++) {
    try {
      results.push(await processTranscript(transcript, client, processorOptions));
      outcomes.push({ index: i, status: "ok" });
    } catch (err) {
      lastFailure = err;
      outcomes.push({ index: i, status: "failed", error: (err as Error).message });
    }
  }

  if (results.length === 0) throw lastFailure;

  const agreement = computeSampleAgreement(results.map((r) => r.model));
  const medoid = results[agreement.medoidIndex]!;
  const failed = outcomes.filter((o) => o.status === "failed");
  const warnings = failed.length > 0
    ? [
      ...medoid.warnings,
      `${failed.length} of ${samples} sample(s) failed and were excluded `
      + `(${failed.map((o) => `#${o.index + 1}: ${o.error}`).join("; ")}).`,
    ]
    : medoid.warnings;

  return {
    ...medoid,
    warnings,
    ambiguities: [...medoid.ambiguities, ...agreement.ambiguities],
    agreement,
    samples: outcomes,
  };
}
