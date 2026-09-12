/**
 * Borrowing the MCP client's model instead of holding a key.
 *
 * The VS Code surface has needed no API key since it shipped, because
 * `CopilotLlmClient` implements `LlmClient` over the host's model access.
 * This is the same move for MCP, over the protocol's `sampling` feature
 * (docs/specs/keyless-model-access.spec.md, barwise-1030).
 *
 * The test that matters most is the `sampling` WITHOUT `sampling.tools` case.
 * Both of barwise's LLM paths ask for structured output, the protocol says a
 * client MUST error when `tools` is sent without that capability, and keying
 * the decision on `sampling` alone would therefore have replaced a working
 * keyed path with a failing sampling one.
 */
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import { describe, expect, it } from "vitest";
import { appendRouteNote, resolveLlmClient, routeNote } from "../../src/llm/resolveClient.js";
import { SamplingLlmClient } from "../../src/llm/SamplingLlmClient.js";

interface CreateMessageCall {
  readonly systemPrompt?: string;
  readonly maxTokens: number;
  readonly tools?: Array<{ name: string; inputSchema: unknown; }>;
  readonly toolChoice?: { mode?: string; };
  readonly messages: Array<{ role: string; content: unknown; }>;
}

/**
 * A stand-in for the low-level `Server`, recording what was asked of it.
 *
 * `as never` at the construction site rather than a full protocol double:
 * this client touches exactly two methods, and a fake implementing the whole
 * `Server` surface would be a maintenance burden that tests nothing more.
 */
function fakeServer(reply: unknown, model = "some-host-model") {
  const calls: CreateMessageCall[] = [];
  return {
    calls,
    handle: {
      createMessage: (params: CreateMessageCall) => {
        calls.push(params);
        return Promise.resolve({ role: "assistant", content: reply, model });
      },
    },
  };
}

const SCHEMA = { type: "object" as const, properties: { ok: { type: "boolean" } } };

describe("SamplingLlmClient", () => {
  it("reports no model, because the host picks it", () => {
    const { handle } = fakeServer({ type: "text", text: "hi" });
    const client = new SamplingLlmClient(handle as never);
    // Not a gap: a guess here would make prompt-variant resolution choose a
    // prompt for a model that never ran. `modelUsed` carries the answer
    // afterwards instead.
    expect(client.model).toBeUndefined();
    expect(client.provider).toBe("mcp-sampling");
  });

  it("asks for a tool and returns its input as JSON for a structured request", async () => {
    const { handle, calls } = fakeServer([
      { type: "tool_use", id: "1", name: "emit_structured_result", input: { ok: true } },
    ]);
    const client = new SamplingLlmClient(handle as never);

    const r = await client.complete({
      systemPrompt: "SYS",
      userMessage: "USER",
      responseSchema: SCHEMA,
    });

    expect(JSON.parse(r.content)).toEqual({ ok: true });
    expect(r.modelUsed).toBe("some-host-model");
    expect(calls[0]!.tools?.[0]?.inputSchema).toEqual(SCHEMA);
    // "required", matching CopilotLlmClient: the caller asked for structured
    // output, so prose is a failure rather than an alternative.
    expect(calls[0]!.toolChoice?.mode).toBe("required");
    expect(calls[0]!.systemPrompt).toBe("SYS");
  });

  it("sends no tools at all when nothing structured was asked for", async () => {
    // The protocol says a client MUST error on `tools` it did not advertise
    // support for, so an unconditional tools field would break plain sampling.
    const { handle, calls } = fakeServer([{ type: "text", text: "prose" }]);
    const r = await new SamplingLlmClient(handle as never).complete({
      systemPrompt: "SYS",
      userMessage: "USER",
    });

    expect(r.content).toBe("prose");
    expect(calls[0]!.tools).toBeUndefined();
    expect(calls[0]!.toolChoice).toBeUndefined();
  });

  it("reads a single content block as well as an array", async () => {
    // `CreateMessageResult` extends `SamplingMessage`, whose content is a
    // block OR an array -- so assuming either shape works against some
    // clients and not others.
    const { handle } = fakeServer({ type: "text", text: "single" });
    const r = await new SamplingLlmClient(handle as never).complete({
      systemPrompt: "",
      userMessage: "U",
    });
    expect(r.content).toBe("single");
  });

  it("joins several text blocks", async () => {
    const { handle } = fakeServer([
      { type: "text", text: "a" },
      { type: "text", text: "b" },
    ]);
    const r = await new SamplingLlmClient(handle as never).complete({
      systemPrompt: "",
      userMessage: "U",
    });
    expect(r.content).toBe("ab");
  });

  it("fails loudly when a structured request comes back as prose", async () => {
    // Returning the text would hand the parser something it cannot read and
    // produce a confusing error further away from the cause.
    const { handle } = fakeServer([{ type: "text", text: "sorry, no tools" }]);
    const client = new SamplingLlmClient(handle as never);

    await expect(
      client.complete({ systemPrompt: "", userMessage: "U", responseSchema: SCHEMA }),
    ).rejects.toThrow(/no tool_use block/);
  });

  it("omits an empty system prompt rather than sending one", async () => {
    const { handle, calls } = fakeServer([{ type: "text", text: "x" }]);
    await new SamplingLlmClient(handle as never).complete({
      systemPrompt: "",
      userMessage: "U",
    });
    expect(calls[0]!.systemPrompt).toBeUndefined();
  });

  it("defaults maxTokens to the Anthropic client's own default, and honours an override", async () => {
    // Matching it means switching a surface from a key to sampling does not
    // silently change the answer budget.
    const a = fakeServer([{ type: "text", text: "x" }]);
    await new SamplingLlmClient(a.handle as never).complete({
      systemPrompt: "",
      userMessage: "U",
    });
    expect(a.calls[0]!.maxTokens).toBe(8192);

    const b = fakeServer([{ type: "text", text: "x" }]);
    await new SamplingLlmClient(b.handle as never).complete({
      systemPrompt: "",
      userMessage: "U",
      maxTokens: 512,
    });
    expect(b.calls[0]!.maxTokens).toBe(512);
  });
});

/** An `McpServer`-shaped double exposing only what the resolver reads. */
function serverWithCapabilities(caps: ClientCapabilities | undefined) {
  return {
    server: {
      getClientCapabilities: () => caps,
      createMessage: () => Promise.reject(new Error("not used in these tests")),
    },
  } as never;
}

describe("resolveLlmClient", () => {
  it("prefers sampling when the client advertises sampling.tools", () => {
    const { client, route } = resolveLlmClient(
      serverWithCapabilities({ sampling: { tools: {} } }),
    );
    expect(route).toBe("sampling");
    expect(client).toBeInstanceOf(SamplingLlmClient);
  });

  it("does NOT use sampling when the client advertises sampling without tools", () => {
    // The correction grounding produced. Both barwise LLM paths request
    // structured output, and the protocol says the client MUST error when
    // `tools` is sent without `sampling.tools` -- so keying on `sampling`
    // alone would swap a working keyed path for a failing one.
    const { client, route } = resolveLlmClient(
      serverWithCapabilities({ sampling: {} }),
    );
    expect(route).toBe("api-key");
    expect(client).not.toBeInstanceOf(SamplingLlmClient);
  });

  it("falls back when the client advertises no capabilities at all", () => {
    expect(resolveLlmClient(serverWithCapabilities(undefined)).route).toBe("api-key");
    expect(resolveLlmClient(serverWithCapabilities({})).route).toBe("api-key");
  });

  it("honours an explicit provider over sampling", () => {
    // An operator who passed `--provider ollama` is answering this question
    // themselves; ignoring it would make the flag mean something else.
    const { route } = resolveLlmClient(
      serverWithCapabilities({ sampling: { tools: {} } }),
      { provider: "ollama" },
    );
    expect(route).toBe("api-key");
  });
});

describe("the route is reported, never silent", () => {
  it("says no key was used on the sampling route", () => {
    expect(routeNote("sampling")).toMatch(/no API key used/);
    expect(routeNote("sampling", "claude-x")).toMatch(/claude-x/);
  });

  it("says a key WAS used on the fallback route", () => {
    // A silent fallback is the reading this change exists to prevent: the
    // operator would believe the server needs no credential while it used one.
    expect(routeNote("api-key")).toMatch(/own API key/);
  });

  it("appends to the last text block, leaving earlier ones alone", () => {
    const out = appendRouteNote(
      {
        content: [{ type: "text" as const, text: "first" }, {
          type: "text" as const,
          text: "last",
        }],
      },
      "sampling",
    );
    expect(out.content[0]!.text).toBe("first");
    expect(out.content[1]!.text).toMatch(/^last\n\n_Model access/);
  });

  it("still reports the route when a result carries no blocks", () => {
    const out = appendRouteNote(
      { content: [] as Array<{ type: "text"; text: string; }> },
      "api-key",
    );
    expect(out.content).toHaveLength(1);
    expect(out.content[0]!.text).toMatch(/own API key/);
  });
});
