/**
 * Why the provider stopped, normalized only as far as it safely can be.
 *
 * Two things are reported, and they answer different questions. The raw
 * `stopReason` is the provider's own word, passed through unmapped
 * because a normalized enum would have to invent names for reasons this
 * code has never seen, and the raw string is what provider docs and
 * support tickets are written against. `truncated` is the one derived
 * question every caller has -- did the answer get cut off -- so no
 * caller has to learn each provider's spelling of it.
 *
 * Both providers already reported this and the code discarded it. The
 * cost was measurable: a run against the dev split scored three
 * consecutive near-zeroes that were not bad extractions at all, but
 * complete extractions cut off at the 8,192-token default, and nothing
 * in the response said so (docs/specs/output-budget.spec.md).
 */

export interface StopDescription {
  readonly stopReason?: string;
  readonly truncated?: boolean;
}

/** Anthropic's `stop_reason`; `max_tokens` is the output ceiling. */
export function describeAnthropicStop(
  stopReason: string | null | undefined,
): StopDescription {
  return describe(stopReason, "max_tokens");
}

/** OpenAI's `finish_reason`, also used by Ollama's compatible API. */
export function describeOpenAiStop(
  finishReason: string | null | undefined,
): StopDescription {
  return describe(finishReason, "length");
}

/**
 * Absent stays absent rather than becoming `truncated: false`. A
 * provider that reported nothing has not told us the response is whole,
 * and a caller that excludes truncated samples must be able to tell
 * "not truncated" from "never said".
 */
function describe(reason: string | null | undefined, ceiling: string): StopDescription {
  if (reason === null || reason === undefined) return {};
  return { stopReason: reason, truncated: reason === ceiling };
}
