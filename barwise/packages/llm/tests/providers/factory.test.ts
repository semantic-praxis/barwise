/**
 * Tests for the provider factory and auto-detection logic.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnthropicLlmClient } from "../../src/providers/anthropic.js";
import { createLlmClient, detectProvider, PROVIDER_NAMES } from "../../src/providers/factory.js";
import { OllamaLlmClient } from "../../src/providers/ollama.js";
import { OpenAILlmClient } from "../../src/providers/openai.js";

/**
 * The key each SDK constructor received, by SDK. Both providers load their
 * SDK lazily, on the first completion, so the mocks record the constructor
 * argument and then refuse the request: construction is the observation, and
 * no network call is ever made. The other tests here only construct clients,
 * which never reaches either SDK, so the mocks change nothing for them.
 */
const sdkKeys = vi.hoisted(() => new Map<string, string | undefined>());
const SDK_REACHED = "sdk constructed; request refused by the test";

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = {
      stream: () => ({ finalMessage: () => Promise.reject(new Error(SDK_REACHED)) }),
      create: () => Promise.reject(new Error(SDK_REACHED)),
    };
    constructor(options?: { apiKey?: string; }) {
      sdkKeys.set("anthropic", options?.apiKey);
    }
  },
}));

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: () => Promise.reject(new Error(SDK_REACHED)) } };
    constructor(options?: { apiKey?: string; }) {
      sdkKeys.set("openai", options?.apiKey);
    }
  },
}));

describe("the library takes its key from the caller", () => {
  it("names exactly anthropic, openai and ollama as providers [adr:keyless-model-access#library-takes-key]", () => {
    // A new provider fails here until the key-handing check below covers it
    // (or it is shown to take no key, as ollama does).
    expect([...PROVIDER_NAMES]).toEqual(["anthropic", "openai", "ollama"]);
  });

  for (const provider of ["anthropic", "openai"] as const) {
    it(`hands apiKey to the ${provider} SDK constructor [adr:keyless-model-access#library-takes-key]`, async () => {
      sdkKeys.clear();
      const client = createLlmClient({ provider, apiKey: "test-key-123" });
      await expect(client.complete({ systemPrompt: "S", userMessage: "U" }))
        .rejects.toThrow(SDK_REACHED);
      expect(sdkKeys.has(provider)).toBe(true);
      expect(sdkKeys.get(provider)).toBe("test-key-123");
    });
  }
});

describe("createLlmClient", () => {
  it("creates AnthropicLlmClient when provider is 'anthropic'", () => {
    const client = createLlmClient({ provider: "anthropic" });
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  it("creates OpenAILlmClient when provider is 'openai'", () => {
    // The OpenAI SDK requires an API key at construction time.
    const client = createLlmClient({ provider: "openai", apiKey: "sk-test" });
    expect(client).toBeInstanceOf(OpenAILlmClient);
  });

  it("creates OllamaLlmClient when provider is 'ollama'", () => {
    const client = createLlmClient({ provider: "ollama" });
    expect(client).toBeInstanceOf(OllamaLlmClient);
  });

  it("forwards apiKey and model to anthropic provider", () => {
    const client = createLlmClient({
      provider: "anthropic",
      apiKey: "test-key",
      model: "claude-3-haiku-20240307",
    });
    expect(client).toBeInstanceOf(AnthropicLlmClient);
  });

  it("forwards apiKey and model to openai provider", () => {
    const client = createLlmClient({
      provider: "openai",
      apiKey: "sk-test",
      model: "gpt-4o-mini",
    });
    expect(client).toBeInstanceOf(OpenAILlmClient);
  });

  it("forwards baseUrl and model to ollama provider", () => {
    const client = createLlmClient({
      provider: "ollama",
      baseUrl: "http://myserver:8080",
      model: "mistral",
    });
    expect(client).toBeInstanceOf(OllamaLlmClient);
  });

  it("creates a client with no options (uses auto-detection)", () => {
    // With no env vars set, should fall back to ollama.
    const original = { ...process.env };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const client = createLlmClient();
      expect(client).toBeInstanceOf(OllamaLlmClient);
    } finally {
      process.env = original;
    }
  });
});

describe("detectProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns 'anthropic' when ANTHROPIC_API_KEY is set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    expect(detectProvider()).toBe("anthropic");
  });

  it("returns 'openai' when OPENAI_API_KEY is set and no ANTHROPIC_API_KEY", () => {
    process.env.OPENAI_API_KEY = "sk-test";
    expect(detectProvider()).toBe("openai");
  });

  it("returns 'ollama' when neither key is set", () => {
    expect(detectProvider()).toBe("ollama");
  });

  it("prefers anthropic when both keys are set", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-test";
    process.env.OPENAI_API_KEY = "sk-test";
    expect(detectProvider()).toBe("anthropic");
  });
});

describe("createLlmClient with a thinking budget", () => {
  it("passes the budget through to the anthropic provider", () => {
    const client = createLlmClient({ provider: "anthropic", thinkingBudget: 4096 });
    expect(client.provider).toBe("anthropic");
  });

  it("refuses the budget on a provider that has no such parameter", () => {
    // Refused at construction rather than silently ignored: a recorded
    // run whose flag did nothing is a measurement that lies.
    expect(() => createLlmClient({ provider: "ollama", thinkingBudget: 4096 }))
      .toThrow(/anthropic/i);
    expect(() => createLlmClient({ provider: "openai", thinkingBudget: 4096 }))
      .toThrow(/anthropic/i);
  });
});
