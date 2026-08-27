/**
 * Provider factory for LlmClient instances.
 *
 * Creates the appropriate LlmClient from a provider name or
 * auto-detects the provider from environment variables.
 */

import type { LlmClient } from "../LlmClient.js";
import { AnthropicLlmClient } from "./anthropic.js";
import { OllamaLlmClient } from "./ollama.js";
import { OpenAILlmClient } from "./openai.js";

export type ProviderName = "anthropic" | "openai" | "ollama";

// Record-typed so the runtime list cannot lag the union; every surface
// that names the providers (CLI help, MCP enums) derives from this
// instead of re-listing (barwise-867: seven independent restatements).
const PROVIDER_MEMBERS: Record<ProviderName, true> = {
  anthropic: true,
  openai: true,
  ollama: true,
};

/** Every ProviderName member, in declaration order. */
export const PROVIDER_NAMES = Object.keys(PROVIDER_MEMBERS) as readonly ProviderName[];

export interface ProviderOptions {
  /** Explicit provider name. If omitted, auto-detects from env vars. */
  readonly provider?: ProviderName;
  /** API key (for anthropic/openai). Falls back to env vars. */
  readonly apiKey?: string;
  /** Model override. Each provider has its own default. */
  readonly model?: string;
  /** Ollama server URL. Only used when provider is "ollama". */
  readonly baseUrl?: string;
  /**
   * Context window in tokens. Only used when provider is "ollama" --
   * hosted providers size their own context from the model, and only
   * Ollama needs telling.
   *
   * Omitted, the provider derives one per call from the prompt length
   * and the output budget. Set it when the machine cannot afford that.
   */
  readonly contextWindow?: number;
}

/**
 * Create an LlmClient from options. Auto-detects provider from
 * environment variables when no explicit provider is given:
 *
 * - ANTHROPIC_API_KEY set -> anthropic
 * - OPENAI_API_KEY set -> openai
 * - Neither set -> ollama (local, no key required)
 */
export function createLlmClient(options?: ProviderOptions): LlmClient {
  const provider = options?.provider ?? detectProvider();

  switch (provider) {
    case "anthropic":
      return new AnthropicLlmClient({
        apiKey: options?.apiKey,
        model: options?.model,
      });
    case "openai":
      return new OpenAILlmClient({
        apiKey: options?.apiKey,
        model: options?.model,
      });
    case "ollama":
      return new OllamaLlmClient({
        baseUrl: options?.baseUrl,
        model: options?.model,
        ...(options?.contextWindow !== undefined
          ? { contextWindow: options.contextWindow }
          : {}),
      });
  }
}

/**
 * Detect the LLM provider from environment variables.
 *
 * Priority: ANTHROPIC_API_KEY > OPENAI_API_KEY > ollama (fallback).
 */
export function detectProvider(): ProviderName {
  if (process.env.ANTHROPIC_API_KEY) return "anthropic";
  if (process.env.OPENAI_API_KEY) return "openai";
  return "ollama";
}
