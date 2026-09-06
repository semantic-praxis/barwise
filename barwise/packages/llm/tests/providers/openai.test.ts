/**
 * Tests for the OpenAI LLM provider.
 *
 * Uses vi.mock to replace the OpenAI SDK with a mock that records
 * calls and returns canned responses. No real API calls are made.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest } from "../../src/LlmClient.js";

// Mock the OpenAI SDK before importing the provider.
const mockCreate = vi.fn();

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      apiKey: string | undefined;
      chat = { completions: { create: mockCreate } };
      constructor(options?: { apiKey?: string; }) {
        this.apiKey = options?.apiKey;
      }
    },
  };
});

// Import after mock is set up.
const { OpenAILlmClient } = await import("../../src/providers/openai.js");

describe("OpenAILlmClient", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  describe("constructor", () => {
    it("uses default model and maxTokens", async () => {
      const client = new OpenAILlmClient();
      // Verify defaults are used when complete() is called.
      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "hello" } }],
      });

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
      });

      // Check that the create call uses defaults.
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o",
          max_tokens: 8192,
        }),
      );
    });

    it("accepts custom model and maxTokens", async () => {
      const client = new OpenAILlmClient({
        model: "gpt-4o-mini",
        maxTokens: 4096,
      });

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "hello" } }],
      });

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "gpt-4o-mini",
          max_tokens: 4096,
        }),
      );
    });
  });

  describe("text completion", () => {
    it("passes system prompt and user message correctly", async () => {
      const client = new OpenAILlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "response text" } }],
      });

      const request: CompletionRequest = {
        systemPrompt: "You are a helpful assistant.",
        userMessage: "What is ORM?",
      };

      const result = await client.complete(request);

      expect(result.content).toBe("response text");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: "You are a helpful assistant." },
            { role: "user", content: "What is ORM?" },
          ],
        }),
      );
    });

    it("returns empty string when content is null", async () => {
      const client = new OpenAILlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const result = await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
      });

      expect(result.content).toBe("");
    });

    it("returns empty string when choices array is empty", async () => {
      const client = new OpenAILlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [],
      });

      const result = await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
      });

      expect(result.content).toBe("");
    });
  });

  describe("structured completion", () => {
    it("uses response_format with json_schema when responseSchema is provided", async () => {
      const client = new OpenAILlmClient();
      const schema = { type: "object", properties: { name: { type: "string" } } };

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"name": "Test"}' } }],
      });

      const request: CompletionRequest = {
        systemPrompt: "Extract data.",
        userMessage: "Some transcript.",
        responseSchema: schema,
      };

      const result = await client.complete(request);

      expect(result.content).toBe('{"name": "Test"}');
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "extract_orm_model",
              schema,
              strict: true,
            },
          },
        }),
      );
    });

    it("does not set response_format when no responseSchema", async () => {
      const client = new OpenAILlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "plain text" } }],
      });

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
      });

      const callArgs = mockCreate.mock.calls[0]![0];
      expect(callArgs).not.toHaveProperty("response_format");
    });
  });
});

describe("OpenAI output budget and stop reason", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("uses a request's budget in place of the client's default", async () => {
    const client = new OpenAILlmClient();
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "hi" } }] });

    await client.complete({ systemPrompt: "s", userMessage: "u", maxTokens: 30_000 });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 30_000 }),
    );
  });

  it("applies the request budget on the structured path too", async () => {
    const client = new OpenAILlmClient();
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "{}" } }] });

    await client.complete({
      systemPrompt: "s",
      userMessage: "u",
      responseSchema: { type: "object" },
      maxTokens: 30_000,
    });

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ max_tokens: 30_000 }),
    );
  });

  it("reports a response cut off at the ceiling", async () => {
    const client = new OpenAILlmClient();
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: '{"object_types":[' }, finish_reason: "length" }],
    });

    const result = await client.complete({
      systemPrompt: "s",
      userMessage: "u",
      responseSchema: { type: "object" },
    });

    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe("length");
  });

  it("does not mark a normal completion as truncated", async () => {
    const client = new OpenAILlmClient();
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "done" }, finish_reason: "stop" }],
    });

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.truncated).toBe(false);
    expect(result.stopReason).toBe("stop");
  });

  it("says nothing when the response carried no finish reason", async () => {
    const client = new OpenAILlmClient();
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "done" } }] });

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.truncated).toBeUndefined();
    expect(result.stopReason).toBeUndefined();
  });
});

// --- barwise-917: report what answered, not what was asked for ---
describe("OpenAILlmClient model attribution", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("reports the identifier the API answered with, not the alias requested", async () => {
    // `gpt-5` is a floating alias; the completion names the snapshot
    // that served it. A row recorded under the alias cannot.
    const client = new OpenAILlmClient({ model: "gpt-5" });
    mockCreate.mockResolvedValueOnce({
      choices: [{ message: { content: "hello" } }],
      model: "gpt-5-2026-04-01",
    });

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.modelUsed).toBe("gpt-5-2026-04-01");
  });

  it("falls back to the requested identifier when the response carries none", async () => {
    const client = new OpenAILlmClient({ model: "gpt-5" });
    mockCreate.mockResolvedValueOnce({ choices: [{ message: { content: "hello" } }] });

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.modelUsed).toBe("gpt-5");
  });
});
