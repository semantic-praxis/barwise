/**
 * Tests for the Anthropic LLM provider.
 *
 * Uses vi.mock to replace the @anthropic-ai/sdk client with a mock that
 * records calls and returns canned responses. No real API calls are
 * made. Also verifies the SDK is loaded lazily (only on first
 * completion), which is the point of the dynamic import.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompletionRequest } from "../../src/LlmClient.js";

// Mock the Anthropic SDK before importing the provider.
const mockCreate = vi.fn();
let capturedApiKey: string | undefined;
let constructed = false;

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
      constructor(options?: { apiKey?: string; }) {
        capturedApiKey = options?.apiKey;
        constructed = true;
      }
    },
  };
});

// Import after mock is set up.
const { AnthropicLlmClient } = await import("../../src/providers/anthropic.js");

function textResponse(text: string) {
  return {
    content: [{ type: "text", text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  };
}

describe("AnthropicLlmClient", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    capturedApiKey = undefined;
    constructed = false;
  });

  describe("constructor", () => {
    it("does not load the SDK until the first completion", () => {
      new AnthropicLlmClient({ apiKey: "sk-ant" });

      expect(constructed).toBe(false);
    });

    it("constructs the SDK with the api key on first completion", async () => {
      const client = new AnthropicLlmClient({ apiKey: "sk-ant" });
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(constructed).toBe(true);
      expect(capturedApiKey).toBe("sk-ant");
    });

    it("uses default model and maxTokens", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: "claude-sonnet-4-5-20250929",
          max_tokens: 8192,
        }),
      );
    });
  });

  describe("text completion", () => {
    it("passes the system prompt and user message and returns the text block", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("response text"));

      const request: CompletionRequest = {
        systemPrompt: "You are helpful.",
        userMessage: "What is ORM?",
      };
      const result = await client.complete(request);

      expect(result.content).toBe("response text");
      expect(result.usage).toEqual({ promptTokens: 10, completionTokens: 5 });
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "You are helpful.",
          messages: [{ role: "user", content: "What is ORM?" }],
        }),
      );
    });

    it("returns empty string when there is no text block", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      const result = await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(result.content).toBe("");
    });
  });

  describe("structured completion", () => {
    it("uses tool_use and returns the serialized tool input", async () => {
      const client = new AnthropicLlmClient();
      const schema = { type: "object", properties: { name: { type: "string" } } };
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", input: { name: "Test" } }],
        usage: { input_tokens: 12, output_tokens: 8 },
      });

      const request: CompletionRequest = {
        systemPrompt: "Extract.",
        userMessage: "Transcript.",
        responseSchema: schema,
      };
      const result = await client.complete(request);

      expect(result.content).toBe(JSON.stringify({ name: "Test" }));
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: [
            expect.objectContaining({ name: "extract_orm_model", input_schema: schema }),
          ],
          tool_choice: { type: "tool", name: "extract_orm_model" },
        }),
      );
    });

    it("throws when the response has no tool_use block", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "text", text: "no tool here" }],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "max_tokens",
      });

      await expect(
        client.complete({
          systemPrompt: "Extract.",
          userMessage: "Transcript.",
          responseSchema: { type: "object" },
        }),
      ).rejects.toThrow(/did not return a tool_use/);
    });

    it("names the stop reason when no tool block came back", async () => {
      // "The API misbehaved" and "the budget ran out before the tool
      // call began" call for completely different responses, and only
      // the stop reason separates them.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [],
        usage: { input_tokens: 1, output_tokens: 1 },
        stop_reason: "max_tokens",
      });

      await expect(
        client.complete({
          systemPrompt: "Extract.",
          userMessage: "Transcript.",
          responseSchema: { type: "object" },
        }),
      ).rejects.toThrow(/max_tokens/);
    });
  });

  describe("output-token budget", () => {
    it("uses a request's budget in place of the client's default", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({ systemPrompt: "s", userMessage: "u", maxTokens: 40_000 });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 40_000 }),
      );
    });

    it("applies the request budget on the structured path too", async () => {
      // The path every extraction actually takes; a budget honoured
      // only on the text path would fix nothing that matters.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", input: { name: "T" } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      await client.complete({
        systemPrompt: "s",
        userMessage: "u",
        responseSchema: { type: "object" },
        maxTokens: 40_000,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 40_000 }),
      );
    });

    it("falls back to the client default when the request names none", async () => {
      const client = new AnthropicLlmClient({ maxTokens: 1234 });
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({ systemPrompt: "s", userMessage: "u" });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 1234 }),
      );
    });
  });

  describe("stop reason", () => {
    it("reports a response cut off at the ceiling", async () => {
      // The case that motivated all of this: a truncated tool_use block
      // arrives as well-formed JSON holding whatever fields completed,
      // so nothing but this flag can tell it from a sparse extraction.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", input: { object_types: [] } }],
        usage: { input_tokens: 4000, output_tokens: 8192 },
        stop_reason: "max_tokens",
      });

      const result = await client.complete({
        systemPrompt: "s",
        userMessage: "u",
        responseSchema: { type: "object" },
      });

      expect(result.truncated).toBe(true);
      expect(result.stopReason).toBe("max_tokens");
      expect(result.content).toBe(JSON.stringify({ object_types: [] }));
    });

    it("does not mark a normal completion as truncated", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        ...textResponse("all done"),
        stop_reason: "end_turn",
      });

      const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

      expect(result.truncated).toBe(false);
      expect(result.stopReason).toBe("end_turn");
    });
  });
});
