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
