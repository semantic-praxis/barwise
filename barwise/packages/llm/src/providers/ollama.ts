/**
 * Ollama provider for the LlmClient interface.
 *
 * Uses Ollama's OpenAI-compatible REST API via the openai package
 * with a custom baseURL. This avoids adding a separate dependency.
 *
 * Ollama runs models locally with no API key required, making it
 * the default fallback when no cloud provider keys are configured.
 *
 * The SDK is loaded lazily (dynamic import on first use) so that
 * importing this module -- or the provider factory -- does not pull
 * `openai` into memory for callers that never select the Ollama
 * provider.
 */

import type OpenAI from "openai";
import type { CompletionRequest, CompletionResponse, LlmClient } from "../LlmClient.js";

export interface OllamaClientOptions {
  /** Ollama server URL. Defaults to "http://localhost:11434". */
  readonly baseUrl?: string;
  /** Model to use. Defaults to "llama3.1". */
  readonly model?: string;
  /** Maximum tokens for the response. Defaults to 8192. */
  readonly maxTokens?: number;
}

/**
 * LlmClient implementation using a local Ollama server.
 *
 * Ollama exposes an OpenAI-compatible API at /v1, so we reuse the
 * openai package with a custom baseURL. Structured output uses the
 * same response_format mechanism.
 */
export class OllamaLlmClient implements LlmClient {
  private client?: OpenAI;
  private readonly baseURL: string;
  private readonly model: string;
  private readonly maxTokens: number;

  constructor(options?: OllamaClientOptions) {
    this.baseURL = (options?.baseUrl ?? "http://localhost:11434") + "/v1";
    this.model = options?.model ?? "llama3.1";
    this.maxTokens = options?.maxTokens ?? 8192;
  }

  /** Load the SDK and construct the underlying client on first use. */
  private async getClient(): Promise<OpenAI> {
    if (!this.client) {
      const { default: OpenAICtor } = await import("openai");
      this.client = new OpenAICtor({ baseURL: this.baseURL, apiKey: "ollama" });
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

    const content = response.choices[0]?.message?.content ?? "";

    // Ollama may wrap structured output in markdown code fences.
    // Strip them if present.
    return {
      content: extractJson(content),
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

/**
 * Extract JSON from a response that may be wrapped in markdown
 * code fences (```json ... ```). Returns the input unchanged if
 * no fences are found.
 */
export function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  return fenceMatch ? fenceMatch[1]!.trim() : text;
}
