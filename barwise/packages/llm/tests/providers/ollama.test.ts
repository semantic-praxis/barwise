/**
 * Tests for the Ollama provider.
 *
 * The provider talks to Ollama's native `/api/chat` over `fetch`, so
 * these mock `fetch` itself rather than an SDK. That makes the request
 * body directly assertable, which matters: the two fields this
 * transport exists to send -- `num_ctx` and the native `format` -- are
 * exactly the ones the OpenAI-compatible endpoint could not express.
 *
 * Responses are newline-delimited JSON, one object per line, the last
 * carrying `done: true` with the stop reason and token counts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractJson, OllamaLlmClient } from "../../src/providers/ollama.js";

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

/** Build an NDJSON body from chunks, as Ollama streams it. */
function ndjson(lines: readonly Record<string, unknown>[]): Response {
  const text = lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
  return new Response(new TextEncoder().encode(text), { status: 200 });
}

/** A normal completion: some content, then a terminating chunk. */
function chatResponse(content: string, done: Record<string, unknown> = {}): Response {
  return ndjson([
    { message: { content }, done: false },
    {
      message: { content: "" },
      done: true,
      done_reason: "stop",
      prompt_eval_count: 120,
      eval_count: 45,
      ...done,
    },
  ]);
}

function lastRequestBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[0]!;
  return JSON.parse((call[1] as { body: string; }).body) as Record<string, unknown>;
}

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("OllamaLlmClient", () => {
  it("posts to the native chat endpoint, not the OpenAI-compatible one", async () => {
    // `/v1/chat/completions` cannot carry num_ctx; that is the whole
    // reason this provider does not use it.
    fetchMock.mockResolvedValueOnce(chatResponse("hi"));
    const client = new OllamaLlmClient();

    await client.complete({ systemPrompt: "sys", userMessage: "user" });

    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:11434/api/chat");
  });

  it("honours a custom base url without doubling its slash", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("hi"));
    const client = new OllamaLlmClient({ baseUrl: "http://box:9999/" });

    await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(fetchMock.mock.calls[0]![0]).toBe("http://box:9999/api/chat");
  });

  it("returns the concatenated content and the reported counts", async () => {
    fetchMock.mockResolvedValueOnce(
      ndjson([
        { message: { content: "hel" }, done: false },
        { message: { content: "lo" }, done: false },
        { message: { content: "" }, done: true, done_reason: "stop", eval_count: 7 },
      ]),
    );
    const client = new OllamaLlmClient();

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.content).toBe("hello");
    expect(result.usage?.completionTokens).toBe(7);
    expect(result.modelUsed).toBe("llama3.1");
  });

  it("reassembles a JSON line split across network chunks", async () => {
    // The failure this prevents only appears under load, which is
    // exactly when a long extraction runs: assuming every chunk
    // boundary lands on a newline works until it does not.
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const enc = new TextEncoder();
        controller.enqueue(enc.encode('{"message":{"content":"par'));
        controller.enqueue(enc.encode('tial"},"done":false}\n{"message":{"content":"!"},'));
        controller.enqueue(enc.encode('"done":true,"done_reason":"stop"}\n'));
        controller.close();
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    const client = new OllamaLlmClient();

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.content).toBe("partial!");
  });
});

describe("the context window", () => {
  it("is always sent, because Ollama's own default cannot hold the prompt", async () => {
    // 4,096 by default, against a ~4,540-token system prompt. Left
    // unset, the instructions are silently truncated and the model is
    // scored on a prompt it never saw.
    fetchMock.mockResolvedValueOnce(chatResponse("hi"));
    const client = new OllamaLlmClient();

    await client.complete({ systemPrompt: "s", userMessage: "u" });

    const options = lastRequestBody()["options"] as Record<string, unknown>;
    expect(options["num_ctx"]).toBeGreaterThanOrEqual(8192);
  });

  it("grows to cover a long prompt and its answer together", async () => {
    // num_ctx spans prompt *and* response, so a big output budget has
    // to widen the window too, not just num_predict.
    fetchMock.mockResolvedValueOnce(chatResponse("hi"));
    const client = new OllamaLlmClient();

    await client.complete({
      systemPrompt: "x".repeat(20_000),
      userMessage: "y".repeat(17_000),
      maxTokens: 41_600,
    });

    const options = lastRequestBody()["options"] as Record<string, unknown>;
    // ~11,100 input tokens with margin, plus 41,600 output.
    expect(options["num_ctx"]).toBeGreaterThan(52_000);
    expect(options["num_predict"]).toBe(41_600);
  });

  it("yields to an explicit window, for the machine that cannot afford the derived one", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("hi"));
    const client = new OllamaLlmClient({ contextWindow: 16_384 });

    await client.complete({ systemPrompt: "x".repeat(50_000), userMessage: "u" });

    const options = lastRequestBody()["options"] as Record<string, unknown>;
    expect(options["num_ctx"]).toBe(16_384);
  });
});

describe("structured output", () => {
  it("sends the schema in the native format field", async () => {
    // The native field takes the schema itself -- no json_schema
    // wrapper, no strict flag.
    fetchMock.mockResolvedValueOnce(chatResponse('{"a":1}'));
    const client = new OllamaLlmClient();
    const schema = { type: "object", properties: { a: { type: "number" } } };

    await client.complete({ systemPrompt: "s", userMessage: "u", responseSchema: schema });

    expect(lastRequestBody()["format"]).toEqual(schema);
  });

  it("omits format entirely for a plain text completion", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("hi"));
    const client = new OllamaLlmClient();

    await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(lastRequestBody()).not.toHaveProperty("format");
  });

  it("still strips a code fence, which some models add anyway", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse('```json\n{"a":1}\n```'));
    const client = new OllamaLlmClient();

    const result = await client.complete({
      systemPrompt: "s",
      userMessage: "u",
      responseSchema: { type: "object" },
    });

    expect(result.content).toBe('{"a":1}');
  });
});

describe("stop reason", () => {
  it("reports a generation cut off at the token limit", async () => {
    // Ollama uses the same word as OpenAI: "length" when it hits
    // num_predict or exhausts the context.
    fetchMock.mockResolvedValueOnce(chatResponse("{", { done_reason: "length" }));
    const client = new OllamaLlmClient();

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.truncated).toBe(true);
    expect(result.stopReason).toBe("length");
  });

  it("does not mark a normal completion as truncated", async () => {
    fetchMock.mockResolvedValueOnce(chatResponse("done"));
    const client = new OllamaLlmClient();

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.truncated).toBe(false);
    expect(result.stopReason).toBe("stop");
  });

  it("treats an empty reason as no reason at all", async () => {
    // Ollama writes done_reason: "" on some paths. Reporting "" as a
    // stop reason is worse than reporting none: it looks like an answer.
    fetchMock.mockResolvedValueOnce(
      ndjson([{ message: { content: "x" }, done: true, done_reason: "" }]),
    );
    const client = new OllamaLlmClient();

    const result = await client.complete({ systemPrompt: "s", userMessage: "u" });

    expect(result.stopReason).toBeUndefined();
    expect(result.truncated).toBeUndefined();
  });
});

describe("failures", () => {
  it("carries the HTTP status, so the retry classifier can judge it", async () => {
    // The eval lane reads `status` off the thrown error to separate a
    // model still loading from one that does not exist.
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"model not found"}', { status: 404, statusText: "Not Found" }),
    );
    const client = new OllamaLlmClient();

    await expect(client.complete({ systemPrompt: "s", userMessage: "u" }))
      .rejects.toMatchObject({ status: 404 });
  });

  it("includes the server's own message in the error", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response('{"error":"model \\"llama9\\" not found"}', { status: 404 }),
    );
    const client = new OllamaLlmClient();

    await expect(client.complete({ systemPrompt: "s", userMessage: "u" }))
      .rejects.toThrow(/not found/);
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
