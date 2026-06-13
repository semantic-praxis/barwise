/**
 * Anthropic Claude provider for the LlmClient interface.
 *
 * Uses Claude's tool_use capability to get structured JSON output
 * conforming to the extraction response schema.
 *
 * The SDK is loaded lazily (dynamic import on first use) so that
 * importing this module -- or the provider factory -- does not pull
 * `@anthropic-ai/sdk` into memory for callers that never select the
 * Anthropic provider.
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CompletionRequest, CompletionResponse, LlmClient } from "../LlmClient.js";

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
  private client?: Anthropic;
  private readonly apiKey?: string;
  private readonly model: string;
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

  private async completeText(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    const client = await this.getClient();
    const start = Date.now();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userMessage }],
    });
    const latencyMs = Date.now() - start;

    const textBlock = response.content.find((b) => b.type === "text");
    return {
      content: textBlock?.text ?? "",
      modelUsed: this.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      },
      latencyMs,
    };
  }

  private async completeWithTool(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    const client = await this.getClient();
    const toolName = "extract_orm_model";

    const start = Date.now();
    const response = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userMessage }],
      tools: [
        {
          name: toolName,
          description: "Extract a structured ORM model from the transcript analysis.",
          input_schema: request.responseSchema as Anthropic.Tool.InputSchema,
        },
      ],
      tool_choice: { type: "tool", name: toolName },
    });
    const latencyMs = Date.now() - start;

    const toolBlock = response.content.find((b) => b.type === "tool_use");
    if (!toolBlock || toolBlock.type !== "tool_use") {
      throw new Error(
        "Anthropic API did not return a tool_use response block.",
      );
    }

    return {
      content: JSON.stringify(toolBlock.input),
      modelUsed: this.model,
      usage: {
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
      },
      latencyMs,
    };
  }
}
