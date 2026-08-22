/**
 * How many output tokens an extraction of a given transcript needs.
 *
 * The provider default of 8,192 was set when every transcript in sight
 * was one to two kilobytes. It silently stopped being enough the moment
 * a 17 KB transcript entered the eval suite: the model produced a
 * faithful extraction, the API cut it off mid-structure, and the
 * harness scored the fragment as a near-zero prompt failure three times
 * running before anyone looked (docs/specs/output-budget.spec.md).
 *
 * A heuristic is the honest answer here -- the output size cannot be
 * known before the call -- so it lives in one named place with its
 * calibration written down, rather than as a constant somewhere in the
 * runner.
 */

/**
 * Extraction payload bytes per transcript byte, from the seven recorded
 * payloads in `promptlab/tests/fixtures/responses/`. The observed range
 * is 4.0 to 9.7 with a mean of 5.95; the ceiling is used rather than
 * the mean because the two errors are not symmetric. Budgeting under
 * the need corrupts a measurement and looks like a result; budgeting
 * over it costs nothing at all, since providers bill generated tokens,
 * not permitted ones.
 */
export const OBSERVED_PAYLOAD_RATIO = 9.7;

/** Rule-of-thumb bytes per token for JSON in the Latin alphabet. */
export const CHARS_PER_TOKEN = 4;

/**
 * Every provider here defaults to this, and the derivation never goes
 * below it: a case that fit before must behave exactly as it did.
 */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192;

/**
 * Upper bound on a derived budget, so a pathological input cannot ask
 * for an absurd ceiling. Deliberately one constant rather than a
 * per-model table: the SDKs do not expose each model's output limit,
 * and a hand-maintained table would go stale without anything noticing.
 *
 * Sized to the job rather than to the smallest model in existence. The
 * largest transcript in the eval suite derives about 41,600 tokens, so
 * a cap below that would leave the very case that motivated this
 * silently truncated -- a cap that re-creates the bug is not a safe
 * default, it is a quiet one.
 *
 * The consequence is deliberate and worth stating: a model whose own
 * ceiling is lower (gpt-4o allows 16,384) rejects the request outright.
 * That is a 400 carrying a status, an error type, and a request id,
 * every one of which the runner now records, and the remedy is one
 * explicit `maxTokens` away. Being told the budget is impossible beats
 * being handed a fragment that scores like a bad prompt.
 */
export const MAX_OUTPUT_TOKEN_CAP = 64_000;

export interface BudgetOptions {
  /**
   * Never return less than this. Defaults to the shared provider
   * default; pass the client's own when it was constructed with a
   * different `maxTokens`.
   */
  readonly floor?: number;
  /** Never return more than this. Defaults to `MAX_OUTPUT_TOKEN_CAP`. */
  readonly cap?: number;
}

/**
 * Suggest an output-token ceiling for extracting `transcript`.
 *
 * Returns a number in `[floor, cap]`, so a caller can pass the result
 * straight to `CompletionRequest.maxTokens` without a guard of its own.
 * When the cap is below the floor the floor wins -- a caller that
 * configured a large client default meant it.
 */
export function suggestMaxTokens(
  transcript: string,
  options?: BudgetOptions,
): number {
  const floor = options?.floor ?? DEFAULT_MAX_OUTPUT_TOKENS;
  const cap = options?.cap ?? MAX_OUTPUT_TOKEN_CAP;
  const needed = Math.ceil(
    (transcript.length * OBSERVED_PAYLOAD_RATIO) / CHARS_PER_TOKEN,
  );
  return Math.max(floor, Math.min(cap, needed));
}

/**
 * Smallest context window that can hold a prompt and its answer.
 *
 * Only local runtimes need this. A hosted API sizes its own context
 * from the model; Ollama does not -- it applies a server default of
 * 4,096 tokens and silently drops whatever does not fit, oldest first.
 * The extraction system prompt alone is about 4,540 tokens, so that
 * default truncates the instructions before the transcript is even
 * read, and the model is then scored on a prompt it never saw.
 *
 * A 20% margin covers the gap between the chars/4 estimate and a real
 * tokenizer. Erring high costs memory; erring low costs the run and
 * says nothing about why.
 */
export function suggestContextWindow(
  promptChars: number,
  maxOutputTokens: number,
): number {
  const inputTokens = Math.ceil((promptChars / CHARS_PER_TOKEN) * 1.2);
  // Rounded to a multiple of 2,048 because that is how context windows
  // are actually sized, and an odd number here reads as a computed
  // quantity when it is really a floor.
  const block = 2048;
  return Math.max(
    DEFAULT_MAX_OUTPUT_TOKENS,
    Math.ceil((inputTokens + maxOutputTokens) / block) * block,
  );
}
