/**
 * OpenAI provider for the LlmClient interface.
 *
 * Uses OpenAI's structured output (response_format with json_schema)
 * to get structured JSON output conforming to the extraction response
 * schema.
 *
 * The SDK is loaded lazily (dynamic import on first use) so that
 * importing this module -- or the provider factory -- does not pull
 * `openai` into memory for callers that never select the OpenAI
 * provider.
 */

import type OpenAI from "openai";
import type { CompletionRequest, CompletionResponse, LlmClient } from "../LlmClient.js";

export interface OpenAIClientOptions {
  /** OpenAI API key. Falls back to OPENAI_API_KEY env var. */
  readonly apiKey?: string;
  /** Model to use. Defaults to "gpt-4o". */
  readonly model?: string;
  /** Maximum tokens for the response. Defaults to 8192. */
  readonly maxTokens?: number;
}

/**
 * LlmClient implementation using the OpenAI API.
 *
 * When a responseSchema is provided, it uses the structured output
 * response_format to constrain the output to the specified JSON shape.
 */
export class OpenAILlmClient implements LlmClient {
  private client?: OpenAI;
  private readonly apiKey?: string;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options?: OpenAIClientOptions) {
    this.apiKey = options?.apiKey;
    this.model = options?.model ?? "gpt-4o";
    this.maxTokens = options?.maxTokens ?? 8192;
  }

  /** Load the SDK and construct the underlying client on first use. */
  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const { default: OpenAICtor } = await import("openai");
      this.client = new OpenAICtor({ apiKey: this.apiKey });
    }
    return this.client;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    if (request.responseSchema) {
      return this.completeStructured(request);
    }
    return this.completeText(request);
  }

  private async completeText(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    const client = await this.getClient();
    const start = Date.now();
    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
    });
    const latencyMs = Date.now() - start;

    return {
      content: response.choices[0]?.message?.content ?? "",
      modelUsed: this.model,
      usage: response.usage
        ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
        : undefined,
      latencyMs,
    };
  }

  private async completeStructured(
    request: CompletionRequest,
  ): Promise<CompletionResponse> {
    const client = await this.getClient();
    const start = Date.now();
    const response = await client.chat.completions.create({
      model: this.model,
      max_tokens: this.maxTokens,
      messages: [
        { role: "system", content: request.systemPrompt },
        { role: "user", content: request.userMessage },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "extract_orm_model",
          schema: request.responseSchema as Record<string, unknown>,
          strict: true,
        },
      },
    });
    const latencyMs = Date.now() - start;

    return {
      content: response.choices[0]?.message?.content ?? "",
      modelUsed: this.model,
      usage: response.usage
        ? {
          promptTokens: response.usage.prompt_tokens,
          completionTokens: response.usage.completion_tokens,
        }
        : undefined,
      latencyMs,
    };
  }
}
