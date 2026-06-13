/**
 * Tests for the Ollama LLM provider.
 *
 * Uses vi.mock to replace the OpenAI SDK (which Ollama reuses via
 * its OpenAI-compatible API) with a mock. Also tests the extractJson
 * helper for stripping markdown code fences.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest } from "../../src/LlmClient.js";

// Mock the OpenAI SDK before importing the provider.
const mockCreate = vi.fn();
let capturedConstructorArgs: { baseURL?: string; apiKey?: string; } | undefined;

vi.mock("openai", () => {
  return {
    default: class MockOpenAI {
      chat = { completions: { create: mockCreate } };
      constructor(options?: { baseURL?: string; apiKey?: string; }) {
        capturedConstructorArgs = options;
      }
    },
  };
});

// Import after mock is set up.
const { OllamaLlmClient, extractJson } = await import("../../src/providers/ollama.js");

describe("OllamaLlmClient", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    capturedConstructorArgs = undefined;
  });

  describe("constructor", () => {
    // The SDK client is constructed lazily on first complete(), so these
    // tests trigger a completion before asserting how it was configured.
    it("does not load the SDK until the first completion", () => {
      new OllamaLlmClient();

      // The OpenAI SDK constructor must not have run yet.
      expect(capturedConstructorArgs).toBeUndefined();
    });

    it("uses default baseUrl, model, and maxTokens", async () => {
      const client = new OllamaLlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "hello" } }],
      });

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(capturedConstructorArgs).toEqual({
        baseURL: "http://localhost:11434/v1",
        apiKey: "ollama",
      });
    });

    it("accepts custom baseUrl", async () => {
      const client = new OllamaLlmClient({ baseUrl: "http://myserver:8080" });

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "hello" } }],
      });

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(capturedConstructorArgs?.baseURL).toBe("http://myserver:8080/v1");
    });

    it("uses default model when not specified", async () => {
      const client = new OllamaLlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "hello" } }],
      });

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "llama3.1" }),
      );
    });

    it("accepts custom model", async () => {
      const client = new OllamaLlmClient({ model: "mistral" });

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "hello" } }],
      });

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ model: "mistral" }),
      );
    });
  });

  describe("text completion", () => {
    it("passes messages correctly", async () => {
      const client = new OllamaLlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: "response text" } }],
      });

      const request: CompletionRequest = {
        systemPrompt: "You are helpful.",
        userMessage: "What is ORM?",
      };

      const result = await client.complete(request);

      expect(result.content).toBe("response text");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "system", content: "You are helpful." },
            { role: "user", content: "What is ORM?" },
          ],
        }),
      );
    });

    it("returns empty string when content is null", async () => {
      const client = new OllamaLlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: null } }],
      });

      const result = await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
      });

      expect(result.content).toBe("");
    });
  });

  describe("structured completion", () => {
    it("uses response_format when responseSchema is provided", async () => {
      const client = new OllamaLlmClient();
      const schema = { type: "object", properties: { name: { type: "string" } } };

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '{"name": "Test"}' } }],
      });

      const request: CompletionRequest = {
        systemPrompt: "Extract.",
        userMessage: "Transcript.",
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

    it("strips markdown code fences from structured output", async () => {
      const client = new OllamaLlmClient();

      mockCreate.mockResolvedValueOnce({
        choices: [{ message: { content: '```json\n{"name": "Test"}\n```' } }],
      });

      const result = await client.complete({
        systemPrompt: "Extract.",
        userMessage: "Transcript.",
        responseSchema: { type: "object" },
      });

      expect(result.content).toBe('{"name": "Test"}');
    });
  });
});

describe("extractJson", () => {
  it("strips json code fences", () => {
    expect(extractJson('```json\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it("strips plain code fences", () => {
    expect(extractJson('```\n{"a": 1}\n```')).toBe('{"a": 1}');
  });

  it("returns input unchanged when no fences", () => {
    expect(extractJson('{"a": 1}')).toBe('{"a": 1}');
  });

  it("handles whitespace inside fences", () => {
    expect(extractJson('```json\n  {"a": 1}  \n```')).toBe('{"a": 1}');
  });

  it("handles empty content inside fences", () => {
    expect(extractJson("```\n\n```")).toBe("");
  });
});
