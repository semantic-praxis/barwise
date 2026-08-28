/**
 * Tests for the eval lane's retry policy (barwise-806). No real delays:
 * the sleep is injected, so a backoff schedule is asserted by recording
 * the waits rather than by serving them.
 */
import { describe, expect, it } from "vitest";
import { classifyFailure, withRetry } from "../src/index.js";

function httpError(status: number, message = "provider said no"): Error {
  return Object.assign(new Error(message), { status });
}

/** Records what the schedule asked for instead of waiting. */
function recordingSleep() {
  const waits: number[] = [];
  return {
    waits,
    sleep: (ms: number) => {
      waits.push(ms);
      return Promise.resolve();
    },
  };
}

describe("classifyFailure", () => {
  it("treats rate limits and server errors as transient", () => {
    for (const status of [408, 429, 500, 502, 503, 504, 529]) {
      expect(classifyFailure(httpError(status))).toBe("transient");
    }
  });

  it("treats auth and bad-request failures as terminal", () => {
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyFailure(httpError(status))).toBe("terminal");
    }
  });

  it("reads the status off a nested response object", () => {
    const err = Object.assign(new Error("wrapped"), { response: { status: 429 } });
    expect(classifyFailure(err)).toBe("transient");
  });

  it("falls back to the message when there is no status", () => {
    expect(classifyFailure(new Error("socket hang up"))).toBe("transient");
    expect(classifyFailure(new Error("Request timed out"))).toBe("transient");
    expect(classifyFailure(new Error("connect ECONNRESET"))).toBe("transient");
  });

  it("retries undici's bare mid-stream drop, which carries no status at all", () => {
    // The 2026-08-28 dev arm lost 6 of 15 calls to exactly this
    // message, unretried, one case keeping 1 of its 5 samples.
    expect(classifyFailure(new TypeError("terminated"))).toBe("transient");
    expect(classifyFailure(new Error("other side closed"))).toBe("transient");
    expect(classifyFailure(new TypeError("fetch failed"))).toBe("transient");
  });

  it("keeps auth wording terminal even when it says terminated", () => {
    expect(classifyFailure(new Error("api key terminated"))).toBe("terminal");
  });

  it("recognizes the auth failure that produced the junk history rows", () => {
    const err = new Error(
      "Could not resolve authentication method. Expected either apiKey or authToken to be set.",
    );
    expect(classifyFailure(err)).toBe("terminal");
  });

  it("keeps an auth failure terminal even when it mentions a timeout", () => {
    expect(classifyFailure(new Error("authentication timed out"))).toBe("terminal");
  });

  it("keeps a rate limit retryable even when it names the credential", () => {
    // Providers routinely say both. Before the precedence fix this
    // classified as terminal, so the one failure class retry exists for
    // was the one it refused to retry.
    expect(classifyFailure(new Error("Rate limit exceeded for your api key")))
      .toBe("transient");
    expect(classifyFailure(new Error("Too many requests for this API key")))
      .toBe("transient");
    expect(classifyFailure(new Error("quota exceeded for api key sk-xxx")))
      .toBe("transient");
  });

  it("treats an unrecognized failure as terminal, not transient", () => {
    // Retrying an unknown error three times leaves it just as unknown.
    expect(classifyFailure(new Error("something nobody has seen"))).toBe("terminal");
  });
});

describe("withRetry", () => {
  it("returns the value on the first attempt when nothing fails", async () => {
    const result = await withRetry(() => Promise.resolve("ok"));
    expect(result).toEqual({ ok: true, value: "ok", attempts: 1 });
  });

  it("retries a transient failure and succeeds", async () => {
    let calls = 0;
    const { waits, sleep } = recordingSleep();
    const result = await withRetry(
      () => {
        calls++;
        if (calls < 3) return Promise.reject(httpError(429));
        return Promise.resolve("recovered");
      },
      { baseDelayMs: 100, sleep },
    );
    expect(result.ok).toBe(true);
    expect(result.ok && result.value).toBe("recovered");
    expect(result.attempts).toBe(3);
    expect(waits).toEqual([100, 200]);
  });

  it("gives up after the attempt budget and reports the last failure", async () => {
    const { waits, sleep } = recordingSleep();
    const result = await withRetry(
      () => Promise.reject(httpError(503, "overloaded")),
      { attempts: 4, baseDelayMs: 50, sleep },
    );
    expect(result.ok).toBe(false);
    expect(result.attempts).toBe(4);
    expect(!result.ok && result.kind).toBe("transient");
    expect(!result.ok && result.error.message).toBe("overloaded");
    expect(waits).toEqual([50, 100, 200]);
  });

  it("does not retry a terminal failure", async () => {
    let calls = 0;
    const { waits, sleep } = recordingSleep();
    const result = await withRetry(
      () => {
        calls++;
        return Promise.reject(httpError(401, "bad key"));
      },
      { attempts: 5, sleep },
    );
    expect(calls).toBe(1);
    expect(result.attempts).toBe(1);
    expect(!result.ok && result.kind).toBe("terminal");
    expect(waits).toEqual([]);
  });

  it("never throws, so the caller decides what a stuck failure means", async () => {
    await expect(
      withRetry(() => Promise.reject(new Error("boom")), { attempts: 1 }),
    ).resolves.toMatchObject({ ok: false });
  });

  it("wraps a non-Error rejection", async () => {
    const result = await withRetry(() => Promise.reject("just a string"), { attempts: 1 });
    expect(!result.ok && result.error).toBeInstanceOf(Error);
    expect(!result.ok && result.error.message).toBe("just a string");
  });
});
