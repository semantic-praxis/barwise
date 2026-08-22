/**
 * Anthropic Claude provider for the LlmClient interface.
 *
 * Uses Claude's tool_use capability to get structured JSON output
 * conforming to the extraction response schema.
 *
 * Every call streams, and takes the assembled message. Not for
 * incremental display -- nothing here renders tokens as they arrive --
 * but because the SDK refuses a non-streaming request whose
 * `max_tokens` implies more than ten minutes of generation, and throws
 * before a byte reaches the wire. In this SDK version the threshold
 * works out at 21,333 tokens and no timeout argument escapes it.
 *
 * That is squarely in the range the extraction budget now derives for a
 * long transcript (docs/specs/output-budget.spec.md), so a non-streaming
 * path would fail every large extraction with an error about streaming.
 * Streaming unconditionally defines the failure out of existence rather
 * than branching on a threshold constant that lives in someone else's
 * package and can move without warning.
 *
 * The SDK is loaded lazily (dynamic import on first use) so that
 * importing this module -- or the provider factory -- does not pull
 * `@anthropic-ai/sdk` into memory for callers that never select the
 * Anthropic provider.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResponse, LlmClient } from "../LlmClient.js";
import { describeAnthropicStop } from "./stopReason.js";

export interface AnthropicClientOptions {
  /** Anthropic API key. Falls back to ANTHROPIC_API_KEY env var. */
  readonly apiKey?: string;
  /** Model to use. Defaults to claude-sonnet-4-5-20250929. */
  readonly model?: string;
  /** Maximum tokens for the response. Defaults to 8192. */
  readonly maxTokens?: number;
}

/**
 * LlmClient implementation using the Anthropic Claude API.
 *
 * When a responseSchema is provided, it uses tool_use to constrain
 * the output to the specified JSON shape.
 */
export class AnthropicLlmClient implements LlmClient {
  readonly provider = "anthropic";
  /** Resolved at construction, so a prompt variant can be chosen before the call. */
  readonly model: string;
  private client?: Anthropic;
  private readonly apiKey?: string;
  private readonly maxTokens: number;

  constructor(options?: AnthropicClientOptions) {
    this.apiKey = options?.apiKey;
    this.model = options?.model ?? "claude-sonnet-4-5-20250929";
    this.maxTokens = options?.maxTokens ?? 8192;
  }

  /** Load the SDK and construct the underlying client on first use. */
  private async getClient(): Promise<Anthropic> {
    if (!this.client) {
      const { default: AnthropicCtor } = await import("@anthropic-ai/sdk");
      this.client = new AnthropicCtor({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (request.responseSchema) {
      return this.completeWithTool(request);
    }
    return this.completeText(request);
  }

  /**
   * The system prompt, as a bare string unless caching was asked for.
   *
   * Kept byte-identical to the previous shape when it was not: a
   * request that asks for nothing must serialize exactly as it did
   * before this option existed, or every existing cache entry and
   * every recorded run stops corresponding to what runs now.
   */
  private systemFor(request: CompletionRequest): Anthropic.MessageCreateParams["system"] {
    if (request.cacheSystemPrompt !== true) return request.systemPrompt;
    // A breakpoint on the last system block covers the tool schema too:
    // the API renders tools before system, and a breakpoint caches
    // everything preceding it.
    return [{
      type: "text",
      text: request.systemPrompt,
      cache_control: { type: "ephemeral" },
    }];
  }

  private messagesFor(request: CompletionRequest): Anthropic.MessageParam[] {
    if (request.cacheUserMessage !== true) {
      return [{ role: "user", content: request.userMessage }];
    }
    return [{
      role: "user",
      content: [{
        type: "text",
        text: request.userMessage,
        cache_control: { type: "ephemeral" },
      }],
    }];
  }

  private async completeText(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    const client = await this.getClient();
    const start = Date.now();
    const response = await client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      system: this.systemFor(request),
      messages: this.messagesFor(request),
    }).finalMessage();
    const latencyMs = Date.now() - start;

    const textBlock = response.content.find((b) => b.type === "text");
    return {
      content: textBlock?.text ?? "",
      modelUsed: this.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        ...describeCacheUsage(response.usage),
      },
      latencyMs,
      ...describeAnthropicStop(response.stop_reason),
    };
  }

  private async completeWithTool(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    const client = await this.getClient();
    const toolName = "extract_orm_model";

    const start = Date.now();
    // `finalMessage()` assembles the streamed input_json_deltas back
    // into a complete tool_use block, so the rest of this method sees
    // exactly what the non-streaming call used to return -- including
    // a partial `input` when the stream was cut off, which is the case
    // `describeAnthropicStop` exists to label.
    const response = await client.messages.stream({
      model: this.model,
      max_tokens: request.maxTokens ?? this.maxTokens,
      system: this.systemFor(request),
      messages: this.messagesFor(request),
      tools: [
        {
          name: toolName,
          description: "Extract a structured ORM model from the transcript analysis.",
          input_schema: request.responseSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: toolName },
    }).finalMessage();
    const latencyMs = Date.now() - start;

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      // Naming the stop reason turns "the API misbehaved" into a
      // diagnosis: `max_tokens` here means the response ran out of room
      // before the tool call started, which is a budget to raise rather
      // than a bug to file.
      throw new Error(
        "Anthropic API did not return a tool_use response block"
          + ` (stop_reason: ${response.stop_reason ?? "none reported"}).`,
      );
    }

    return {
      content: JSON.stringify(toolBlock.input),
      modelUsed: this.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        ...describeCacheUsage(response.usage),
      },
      latencyMs,
      ...describeAnthropicStop(response.stop_reason),
    };
  }
}

/**
 * The two cache counters, when the SDK reports them.
 *
 * Kept out of the response entirely when null rather than reported as
 * zero: a provider that cached nothing and a provider with no cache are
 * different facts, and only the first is a fault worth chasing.
 */
function describeCacheUsage(
  usage: { cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null; },
): { cacheReadTokens?: number; cacheWriteTokens?: number; } {
  return {
    ...(typeof usage.cache_read_input_tokens === "number"
      ? { cacheReadTokens: usage.cache_read_input_tokens }
      : {}),
    ...(typeof usage.cache_creation_input_tokens === "number"
      ? { cacheWriteTokens: usage.cache_creation_input_tokens }
      : {}),
  };
}
