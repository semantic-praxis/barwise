/**
 * Abstract interface for LLM API calls.
 *
 * The LLM provider can be swapped without affecting the core extraction
 * logic. Each provider (Anthropic, OpenAI, etc.) implements this interface.
 */

export interface CompletionRequest {
  readonly systemPrompt: string;
  readonly userMessage: string;
  /** JSON Schema for structured output. The provider maps this to its
   *  native structured output mechanism (tool use, response format, etc.). */
  readonly responseSchema?: Record<string, unknown>;
  /**
   * Output-token ceiling for this call, overriding the client's own
   * default.
   *
   * The budget belongs on the call rather than the client because one
   * client runs inputs of wildly different sizes: a 1 KB transcript and
   * a 17 KB one do not need the same ceiling, and a client-lifetime
   * constant has to be set for the largest to be safe for any of them.
   * See `suggestMaxTokens`.
   */
  readonly maxTokens?: number;
}

export interface CompletionResponse {
  readonly content: string;
  /** The model identifier that handled this completion. */
  readonly modelUsed?: string;
  /** Token usage reported by the provider, if available. */
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
  };
  /** Wall-clock time of the LLM call in milliseconds, if measured. */
  readonly latencyMs?: number;
  /**
   * Why the provider stopped generating, in the provider's own word --
   * Anthropic's `stop_reason`, OpenAI's `finish_reason`. Passed through
   * unmapped: a normalized enum would have to guess at reasons this
   * code has never seen, and the raw string is what provider docs and
   * support tickets are written against.
   */
  readonly stopReason?: string;
  /**
   * True when generation stopped because it hit the output-token
   * ceiling, so `content` is cut off mid-structure.
   *
   * Derived from `stopReason`, and separate from it because every
   * caller needs this one question answered and none of them should
   * have to know each provider's spelling of it. A truncated response
   * is not a bad answer, it is half an answer -- callers that measure
   * quality must exclude it rather than score it.
   */
  readonly truncated?: boolean;
}

export interface LlmClient {
  /**
   * Provider identity, e.g. "anthropic". With `model`, this is what
   * selects a per-model prompt variant (see `resolveArtifact`).
   */
  readonly provider: string;
  /**
   * The model this client will use, where it is known before the call.
   *
   * Deliberately not optional: a provider that cannot say must say so,
   * because a silently absent identity resolves to the default prompt
   * and looks exactly like a provider that has no variant. VS Code's
   * Copilot client is the honest `undefined` -- the host picks the
   * model inside `complete`.
   *
   * Distinct from `CompletionResponse.modelUsed`, which reports what
   * actually answered. That arrives after the call, too late to choose
   * a system prompt.
   */
  readonly model: string | undefined;
  complete(request: CompletionRequest): Promise<CompletionResponse>;
}
