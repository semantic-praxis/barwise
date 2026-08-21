/**
 * The call-log decorator
 * (llm-call-observability spec, workstream 1).
 *
 * Three properties carry the design and each has its own test: the
 * wrapped client is indistinguishable to its caller, a failure is a row
 * rather than a gap, and no prompt or response text reaches a record.
 */
import { describe, expect, it } from "vitest";
import type { CompletionRequest, LlmClient } from "../../src/LlmClient.js";
import type { LlmCallRecord } from "../../src/observe/callLog.js";
import { withCallLog } from "../../src/observe/callLog.js";

const FIXED = "2026-08-21T00:00:00.000Z";

function sink() {
  const entries: LlmCallRecord[] = [];
  return { entries, record: (e: LlmCallRecord) => entries.push(e) };
}

function client(overrides?: Partial<LlmClient>): LlmClient {
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5",
    complete: () =>
      Promise.resolve({
        content: "{}",
        modelUsed: "claude-haiku-4-5",
        usage: { promptTokens: 1200, completionTokens: 340 },
        latencyMs: 812,
      }),
    ...overrides,
  };
}

const request: CompletionRequest = {
  systemPrompt: "SECRET-SYSTEM-PROMPT",
  userMessage: "SECRET-TRANSCRIPT-CONTENT",
};

describe("withCallLog", () => {
  it("records what the call cost", async () => {
    const s = sink();
    await withCallLog(client(), s, { now: () => FIXED }).complete(request);
    expect(s.entries).toHaveLength(1);
    expect(s.entries[0]).toEqual({
      startedAt: FIXED,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      modelUsed: "claude-haiku-4-5",
      promptTokens: 1200,
      completionTokens: 340,
      latencyMs: 812,
      ok: true,
    });
  });

  it("returns the provider's response unchanged", async () => {
    const bare = client();
    const direct = await bare.complete(request);
    const wrapped = await withCallLog(bare, sink(), { now: () => FIXED }).complete(request);
    expect(wrapped).toEqual(direct);
  });

  it("carries the client's identity through", async () => {
    const wrapped = withCallLog(client(), sink());
    expect(wrapped.provider).toBe("anthropic");
    expect(wrapped.model).toBe("claude-haiku-4-5");
  });

  it("records no prompt or response text", async () => {
    // The exclusion this design turns on. Transcripts are client
    // material; a telemetry log is not the place they end up.
    const s = sink();
    await withCallLog(client(), s, { now: () => FIXED }).complete(request);
    const serialized = JSON.stringify(s.entries);
    expect(serialized).not.toContain("SECRET-SYSTEM-PROMPT");
    expect(serialized).not.toContain("SECRET-TRANSCRIPT-CONTENT");
    expect(serialized).not.toContain("{}");
  });

  it("records a failure as a row, and rethrows it", async () => {
    // A log holding only successes makes a rate-limit storm look like a
    // quiet day.
    const s = sink();
    const failing = client({
      complete: () => Promise.reject(new Error("429 Too Many Requests")),
    });
    await expect(
      withCallLog(failing, s, { now: () => FIXED }).complete(request),
    ).rejects.toThrow("429");
    expect(s.entries[0]!.ok).toBe(false);
    expect(s.entries[0]!.errorKind).toBe("rate_limit");
  });

  it("classifies rather than quoting the provider's message", async () => {
    const s = sink();
    const failing = client({
      complete: () =>
        Promise.reject(new Error("could not resolve authentication for request abc123")),
    });
    await expect(withCallLog(failing, s).complete(request)).rejects.toThrow();
    expect(s.entries[0]!.errorKind).toBe("auth");
    expect(JSON.stringify(s.entries)).not.toContain("abc123");
  });

  it("cannot fail the call it is observing", async () => {
    // Observability that breaks the operation is worse than none.
    const throwing = {
      record: () => {
        throw new Error("disk full");
      },
    };
    const response = await withCallLog(client(), throwing).complete(request);
    expect(response.content).toBe("{}");
  });

  it("stamps a correlation id on every call when given one", async () => {
    const s = sink();
    const wrapped = withCallLog(client(), s, { correlationId: "run-7", now: () => FIXED });
    await wrapped.complete(request);
    await wrapped.complete(request);
    expect(s.entries.map((e) => e.correlationId)).toEqual(["run-7", "run-7"]);
  });

  it("omits the correlation id rather than writing undefined", async () => {
    const s = sink();
    await withCallLog(client(), s, { now: () => FIXED }).complete(request);
    expect("correlationId" in s.entries[0]!).toBe(false);
  });

  it("records what it can when the provider reports no usage", async () => {
    // Copilot reports no token counts. A record without them is still
    // a record of a call having happened.
    const s = sink();
    const quiet = client({ complete: () => Promise.resolve({ content: "{}" }) });
    await withCallLog(quiet, s, { now: () => FIXED }).complete(request);
    expect(s.entries[0]).toEqual({
      startedAt: FIXED,
      provider: "anthropic",
      model: "claude-haiku-4-5",
      ok: true,
    });
  });
});
