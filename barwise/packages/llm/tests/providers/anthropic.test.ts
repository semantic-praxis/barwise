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
let streamCalls = 0;

// The provider streams every call and takes `finalMessage()`, so the
// mock mirrors that shape: `stream` returns a handle whose
// finalMessage() resolves to whatever the test queued on mockCreate.
// Keeping one queue means the existing assertions on request bodies
// carry over unchanged.
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        create: mockCreate,
        stream: (body: unknown) => {
          streamCalls++;
          return { finalMessage: () => mockCreate(body) };
        },
      };
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
    streamCalls = 0;
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

  describe("streaming", () => {
    it("streams every call, including a small one", async () => {
      // Not for incremental display -- nothing renders these tokens.
      // The SDK simply refuses a non-streaming request whose max_tokens
      // implies over ten minutes of generation, and throws before a
      // byte reaches the wire. One path avoids branching on a threshold
      // constant that lives in someone else's package.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({ systemPrompt: "s", userMessage: "u" });

      expect(streamCalls).toBe(1);
    });

    it("accepts a budget past the SDK's non-streaming limit", async () => {
      // The regression that sent three dev-split runs to FAILED: at
      // this SDK version any max_tokens over 21,333 throws on the
      // non-streaming path, and no timeout argument escapes it. The
      // derived budget for a 17 KB transcript is roughly twice that.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", input: { object_types: [] } }],
        usage: { input_tokens: 5000, output_tokens: 30000 },
        stop_reason: "tool_use",
      });

      const result = await client.complete({
        systemPrompt: "s",
        userMessage: "u",
        responseSchema: { type: "object" },
        maxTokens: 41_600,
      });

      expect(streamCalls).toBe(1);
      expect(result.truncated).toBe(false);
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ max_tokens: 41_600 }),
      );
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
  describe("prompt caching", () => {
    it("sends the system prompt unchanged when caching was not asked for", async () => {
      // The default must serialize exactly as it did before this option
      // existed. A bare string and a one-element block array are
      // different bytes, and caching is a byte-exact prefix match.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({ systemPrompt: "sys", userMessage: "user" });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: "sys",
          messages: [{ role: "user", content: "user" }],
        }),
      );
    });

    it("marks the system block when caching was asked for", async () => {
      // The breakpoint goes on the system block and covers the tool
      // schema too: the API renders tools before system, and a
      // breakpoint caches everything preceding it.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
        cacheSystemPrompt: true,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          system: [{
            type: "text",
            text: "sys",
            cache_control: { type: "ephemeral" },
          }],
        }),
      );
    });

    it("leaves the user message alone when only the system prompt is cached", async () => {
      // The two are decided separately on purpose: caching a transcript
      // that is never sent twice pays the write premium for no read.
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
        cacheSystemPrompt: true,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{ role: "user", content: "user" }],
        }),
      );
    });

    it("marks the user message when that was asked for too", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce(textResponse("hi"));

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
        cacheSystemPrompt: true,
        cacheUserMessage: true,
      });

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [{
            role: "user",
            content: [{
              type: "text",
              text: "user",
              cache_control: { type: "ephemeral" },
            }],
          }],
        }),
      );
    });

    it("applies both on the structured path, which is the one extraction takes", async () => {
      const client = new AnthropicLlmClient();
      mockCreate.mockResolvedValueOnce({
        content: [{ type: "tool_use", input: { a: 1 } }],
        usage: { input_tokens: 1, output_tokens: 1 },
      });

      await client.complete({
        systemPrompt: "sys",
        userMessage: "user",
        responseSchema: { type: "object" },
        cacheSystemPrompt: true,
        cacheUserMessage: true,
      });

      const body = mockCreate.mock.calls[0]![0] as Record<string, unknown>;
      expect(body["system"]).toEqual([
        { type: "text", text: "sys", cache_control: { type: "ephemeral" } },
      ]);
      expect(body["tools"]).toBeDefined();
    });
  });
});
