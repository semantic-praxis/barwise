/**
 * A truncated answer is excluded, not scored.
 *
 * The third kind of bad run, and the one that hid the longest. A call
 * the provider never answered raises an error; a payload the parser
 * rejects raises an error. A truncated tool_use block does neither --
 * it arrives as well-formed JSON holding whatever fields completed, and
 * scores like a bad prompt. Three consecutive near-zeroes on the dev
 * split were this, and nothing in the report said so
 * (docs/specs/output-budget.spec.md).
 *
 * What is being defended here is the metric: a score that moves with
 * the caller's token budget is not measuring the prompt.
 */
import type { CompletionRequest, CompletionResponse } from "@barwise/llm";
import { MIN_DERIVED_OUTPUT_TOKENS } from "@barwise/llm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite, runSuite, toHistoryEntry } from "../src/index.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/responses");
const suite = loadSuite(defaultSuitePath());
const TRAIN = { split: "train" } as const;

/** A client that answers every case from its recorded payload. */
function fixtureClient(decorate: (r: CompletionResponse) => CompletionResponse = (r) => r) {
  const requests: CompletionRequest[] = [];
  return {
    requests,
    provider: "test",
    model: undefined,
    complete: (request: CompletionRequest) => {
      requests.push(request);
      const match = suite.cases.find((c) =>
        request.userMessage.includes(c.transcript.split("\n")[0]!)
      );
      if (!match) return Promise.reject(new Error("no fixture for request"));
      return Promise.resolve(decorate({
        content: readFileSync(join(fixturesDir, `${match.evalCase.id}.json`), "utf8"),
        latencyMs: 1234,
        usage: { promptTokens: 2000, completionTokens: 8192 },
      }));
    },
  };
}

describe("a truncated run", () => {
  it("is excluded from the mean rather than scored", async () => {
    // The payload is a perfect answer key -- it would score 0.98. If
    // truncation were scored instead of excluded, this suite would come
    // back with a mean near 1 and no indication anything was wrong.
    const report = await runSuite(
      suite,
      fixtureClient((r) => ({ ...r, truncated: true, stopReason: "max_tokens" })),
      TRAIN,
    );

    expect(report.cases.every((c) => c.samples === 0)).toBe(true);
    expect(report.mean).toBe(0);
    expect(report.failures).toBe(7);
  });

  it("counts as a failure, so the run cannot be recorded as a baseline", async () => {
    // `complete: false` is what makes appendRunHistory refuse the row.
    // A truncated sweep quietly joining the longitudinal record is the
    // outcome this whole change exists to prevent.
    const report = await runSuite(
      suite,
      fixtureClient((r) => ({ ...r, truncated: true, stopReason: "max_tokens" })),
      TRAIN,
    );

    expect(report.complete).toBe(false);
  });

  it("is named as truncation, not as a provider failure", async () => {
    // Both are excluded, and they call for opposite responses: one
    // means look at the provider, the other means raise the budget.
    const report = await runSuite(
      suite,
      fixtureClient((r) => ({ ...r, truncated: true, stopReason: "max_tokens" })),
      { ...TRAIN, repeat: 1 },
    );

    expect(report.truncations).toBe(7);
    const run = report.cases[0]!.runs[0]!;
    expect(run.truncated).toBe(true);
    expect(run.failureKind).toBe("truncated");
    expect(run.error).toMatch(/cut off/);
    expect(run.error).toMatch(/max-tokens/);
  });

  it("keeps the ceiling it hit, so the operator knows what to raise", async () => {
    const report = await runSuite(
      suite,
      fixtureClient((r) => ({ ...r, truncated: true, stopReason: "max_tokens" })),
      TRAIN,
    );
    const run = report.cases[0]!.runs[0]!;

    expect(run.maxTokens).toBe(MIN_DERIVED_OUTPUT_TOKENS);
    expect(run.outputTokens).toBe(8192);
    expect(run.stopReason).toBe("max_tokens");
  });

  it("shows up live, so a sweep can be stopped before it finishes", async () => {
    const events: unknown[] = [];
    await runSuite(
      suite,
      fixtureClient((r) => ({ ...r, truncated: true, stopReason: "max_tokens" })),
      { ...TRAIN, onProgress: (e) => events.push(e) },
    );

    expect(events.every((e) => (e as { truncated?: boolean; }).truncated === true)).toBe(true);
  });
});

describe("an untruncated run", () => {
  it("scores exactly as it did before any of this", async () => {
    // The regression that would matter most: a false positive on the
    // truncation flag excludes every healthy sample, and a suite that
    // excludes everything reports 0 with no visible cause.
    const report = await runSuite(suite, fixtureClient(), TRAIN);

    expect(report.truncations).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.cases[0]!.mean).toBeCloseTo(0.98, 10);
  });

  it("still carries the provider's diagnostics", async () => {
    // Kept on healthy runs on purpose: the sample before the first
    // truncation is the one that could have warned, and it can only do
    // that if the token pair is recorded when nothing is wrong.
    const report = await runSuite(
      suite,
      fixtureClient((r) => ({ ...r, stopReason: "tool_use" })),
      TRAIN,
    );
    const run = report.cases[0]!.runs[0]!;

    expect(run.stopReason).toBe("tool_use");
    expect(run.promptTokens).toBe(2000);
    expect(run.outputTokens).toBe(8192);
    expect(run.maxTokens).toBe(MIN_DERIVED_OUTPUT_TOKENS);
  });
});

describe("the derived budget", () => {
  it("sends one with every call", async () => {
    const client = fixtureClient();
    await runSuite(suite, client, TRAIN);

    expect(client.requests.every((r) => r.maxTokens !== undefined)).toBe(true);
  });

  it("gives the seed cases the derived floor", async () => {
    // Was pinned to the provider's 8,192 on a comparability argument
    // that did not survive contact: no history had been recorded under
    // it, and a live sweep truncated a seed case at exactly that
    // ceiling.
    const client = fixtureClient();
    await runSuite(suite, client, TRAIN);

    expect(client.requests.every((r) => r.maxTokens === MIN_DERIVED_OUTPUT_TOKENS)).toBe(true);
  });

  it("yields to an explicit budget, for every case in the run", async () => {
    const client = fixtureClient();
    await runSuite(suite, client, { ...TRAIN, maxTokens: 50_000 });

    expect(client.requests.every((r) => r.maxTokens === 50_000)).toBe(true);
  });

  it("does not change between samples of one case", async () => {
    // Two samples of a case are averaged together, so they have to have
    // been run under the same conditions.
    const client = fixtureClient();
    await runSuite(suite, client, { ...TRAIN, repeat: 3 });
    const first = client.requests.slice(0, 3).map((r) => r.maxTokens);

    expect(new Set(first).size).toBe(1);
  });
});

describe("a provider failure", () => {
  it("keeps the identifiers the provider sent with it", async () => {
    // The message is the field SDKs reword between releases, and it
    // never carries the request id -- which is the only handle anyone
    // has on a call that has already happened.
    const client = {
      provider: "test",
      model: undefined,
      complete: () =>
        Promise.reject(Object.assign(new Error("overloaded"), {
          status: 529,
          type: "overloaded_error",
          request_id: "req_abc123",
        })),
    };
    const report = await runSuite(suite, client, {
      ...TRAIN,
      retry: { attempts: 1 },
    });
    const run = report.cases[0]!.runs[0]!;

    expect(run.status).toBe(529);
    expect(run.errorType).toBe("overloaded_error");
    expect(run.requestId).toBe("req_abc123");
    expect(run.truncated).toBeUndefined();
    expect(report.truncations).toBe(0);
  });
});

/**
 * Caching is requested where it pays and not where it does not
 * (docs/specs/prompt-caching.spec.md). Both conditions are break-even
 * calculations: a write costs ~1.25x and a read ~0.1x, so a breakpoint
 * only earns its keep from the second request that reads it.
 */
describe("prompt caching in a sweep", () => {
  it("asks for system caching, which every call in the run reads", async () => {
    const client = fixtureClient();
    await runSuite(suite, client, TRAIN);

    expect(client.requests.every((r) => r.cacheSystemPrompt === true)).toBe(true);
  });

  it("does not ask for user-message caching at repeat 1", async () => {
    // A transcript sent once is read back never, so caching it pays the
    // write premium on the whole transcript for nothing.
    const client = fixtureClient();
    await runSuite(suite, client, TRAIN);

    expect(client.requests.every((r) => r.cacheUserMessage !== true)).toBe(true);
  });

  it("asks for user-message caching once a case is sampled more than once", async () => {
    // The runner iterates case-outer, repeat-inner, so the samples of
    // one case send a byte-identical transcript back to back -- which
    // is exactly the prefix a second breakpoint captures.
    const client = fixtureClient();
    await runSuite(suite, client, { ...TRAIN, repeat: 3 });

    expect(client.requests.every((r) => r.cacheUserMessage === true)).toBe(true);
  });

  it("asks for nothing when the whole run is a single call", async () => {
    // One call reads no cache back, so both breakpoints are pure cost.
    const oneCase = { ...suite, cases: suite.cases.slice(0, 1) };
    const client = fixtureClient();
    await runSuite(oneCase, client, { repeat: 1 });

    expect(client.requests).toHaveLength(1);
    expect(client.requests[0]!.cacheSystemPrompt).toBe(false);
    expect(client.requests[0]!.cacheUserMessage).toBe(false);
  });
});

/**
 * Caching is confirmed, not assumed (docs/specs/cache-reporting.spec.md).
 *
 * The failure this reporting exists to catch is silent by construction:
 * below a model's minimum cacheable length nothing errors, the run
 * succeeds, and every call pays the 1.25x write premium for a read that
 * never comes -- costing more than not caching at all.
 */
describe("cache reporting", () => {
  const cached = (read: number, write: number) => (r: CompletionResponse) => ({
    ...r,
    usage: { ...r.usage, cacheReadTokens: read, cacheWriteTokens: write },
  });

  it("totals what the provider reported across the run", async () => {
    const report = await runSuite(suite, fixtureClient(cached(500, 20)), TRAIN);

    expect(report.cache).toEqual({ requested: true, readTokens: 3500, writeTokens: 140 });
  });

  it("says nothing at all when no provider reported on caching", async () => {
    // Ollama has no prompt cache. Absent and zero are different facts,
    // and only zero is a fault worth naming -- reporting 0 here would
    // claim a measurement nobody made.
    const report = await runSuite(suite, fixtureClient(), TRAIN);

    expect(report.cache).toBeUndefined();
  });

  it("reports zero reads rather than hiding them", async () => {
    // The whole point: a provider that cached nothing must say so.
    const report = await runSuite(suite, fixtureClient(cached(0, 5780)), TRAIN);

    expect(report.cache?.readTokens).toBe(0);
    expect(report.cache?.requested).toBe(true);
  });

  it("records that caching was never requested, for a single-call run", async () => {
    // A one-call run deliberately asks for nothing (barwise-822), so a
    // zero-read warning against it would be a false alarm.
    const oneCase = { ...suite, cases: suite.cases.slice(0, 1) };
    const report = await runSuite(oneCase, fixtureClient(cached(0, 0)), { repeat: 1 });

    expect(report.cache?.requested).toBe(false);
  });

  it("carries reads into the live progress event", async () => {
    const events: unknown[] = [];
    await runSuite(suite, fixtureClient(cached(500, 20)), {
      ...TRAIN,
      onProgress: (e) => events.push(e),
    });

    expect(
      events.every((e) => (e as { cacheReadTokens?: number; }).cacheReadTokens === 500),
    ).toBe(true);
  });
});

/**
 * A score that explains itself (docs/specs/eval-diagnosis.spec.md).
 *
 * The first repeat=5 baseline produced a mean it could defend
 * statistically and not explain mechanically: six warnings costing 0.30
 * on every university-enrollment run, with nothing saying which six,
 * and a one-in-five collapse owning 76% of the suite's noise whose
 * payload had already been discarded.
 */
describe("naming the warnings", () => {
  it("tallies them by rule across the run", async () => {
    const report = await runSuite(suite, fixtureClient(), TRAIN);

    // The answer keys are clean, which is what makes the live warnings
    // addressable rather than a floor -- so an empty tally here is the
    // assertion, not an absent one.
    expect(report.warningsByRule).toEqual({});
  });

  it("reaches the history row, because warnings are score-constitutive", async () => {
    // Distinct from `tokens`, which needed a cost argument because
    // caching is score-neutral. These are ~80% of what a run loses, so
    // a row without them cannot say why a mean moved.
    const report = await runSuite(suite, fixtureClient(), TRAIN);
    const entry = toHistoryEntry(report, "2026-08-22T00:00:00Z");

    // One conformance correction, which is exactly the 0.02 between
    // this answer key's pinned 0.98 and a clean 1.0. That figure has
    // been asserted since the scorer existed without anything saying
    // where it came from; the field is what says it.
    expect(entry.cases[0]!.penalties).toEqual({
      corrections: 1,
      errors: 0,
      warnings: 0,
    });
  });
});

describe("keeping what cannot be explained", () => {
  it("keeps the payload of a run below the collapse floor", async () => {
    // A floor above every achievable score stands in for a collapse.
    const report = await runSuite(
      { ...suite, collapseFloor: 0.999 },
      fixtureClient(),
      TRAIN,
    );

    expect(report.cases.every((c) => typeof c.runs[0]!.payload === "string")).toBe(true);
  });

  it("does not keep the payload of a healthy run", async () => {
    // Thirty-five payloads to explain the one that needs explaining is
    // how a diagnostic becomes clutter.
    const report = await runSuite(suite, fixtureClient(), TRAIN);

    expect(report.cases.every((c) => c.runs[0]!.payload === undefined)).toBe(true);
  });

  it("keeps the payload of an unscorable run, which is the only clue to why", async () => {
    const client = {
      provider: "test",
      model: undefined,
      complete: () => Promise.resolve({ content: "{not json" }),
    };
    const report = await runSuite(suite, client, TRAIN);
    const run = report.cases[0]!.runs[0]!;

    expect(run.payload).toBe("{not json");
    expect(run.error).toBeDefined();
  });
});
