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
  /**
   * Ask the provider to cache the system prompt and tool schema, so a
   * later call with a byte-identical prefix reuses the prefill.
   *
   * Worth it from the second call that reads the cache: a write costs
   * about 1.25x the input price and a read about 0.1x. A caller making
   * one request should leave this off.
   *
   * A hint, not a command. Providers that cache server-side with no
   * client control (OpenAI) or that have no cache at all (Ollama)
   * ignore it, which is why setting it is never wrong -- only
   * sometimes pointless.
   */
  readonly cacheSystemPrompt?: boolean;
  /**
   * Also cache the user message, extending the cached prefix past the
   * system prompt to cover the transcript.
   *
   * Separate from `cacheSystemPrompt` because the two break even under
   * different conditions. The system prompt repeats across every call
   * a process makes; a user message only repeats when the identical
   * one is sent again, which in practice means sampling the same case
   * more than once. Setting this for a single call pays the write
   * premium on the whole transcript and reads it back never.
   */
  readonly cacheUserMessage?: boolean;
}

export interface CompletionResponse {
  readonly content: string;
  /** The model identifier that handled this completion. */
  readonly modelUsed?: string;
  /** Token usage reported by the provider, if available. */
  readonly usage?: {
    /**
     * Input tokens processed at full price.
     *
     * Read this carefully once caching is in play: it is the **uncached
     * remainder**, not the size of the prompt. The prompt is
     * `promptTokens + cacheReadTokens + cacheWriteTokens`, and after a
     * cache hit the first term is the small one. Cost arithmetic that
     * uses this field alone under-reports by whatever was cached, which
     * on the extraction path is most of the input.
     */
    readonly promptTokens?: number;
    readonly completionTokens?: number;
    /**
     * Input tokens served from the prompt cache, billed at about 0.1x.
     *
     * Absent when the provider does not report caching at all (Ollama
     * has no prompt cache). Absent and zero mean different things: zero
     * is a provider that cached nothing, which on a repeated prefix is
     * a fault worth chasing; absent is a provider that was never asked.
     */
    readonly cacheReadTokens?: number;
    /** Input tokens written to the cache, billed at about 1.25x. */
    readonly cacheWriteTokens?: number;
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
