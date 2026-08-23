/**
 * Progress reporting during a run.
 *
 * A sweep is dozens of sequential provider calls that used to print
 * nothing until all of them finished. The retry event is the one worth
 * testing hardest: it cannot be exercised through a real provider stub,
 * because the provider SDKs retry transient statuses internally before
 * `withRetry` ever sees them, so a mock client that rejects is the only
 * way to reach it.
 */
import type { CompletionRequest } from "@barwise/llm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { RunProgress } from "../src/index.js";
import { defaultSuitePath, loadSuite, runSuite, withRetry } from "../src/index.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/responses");
const suite = loadSuite(defaultSuitePath());
const TRAIN = { split: "train" } as const;

function fixtureClient() {
  return {
    provider: "test",
    model: undefined,
    complete: (request: CompletionRequest) => {
      const match = suite.cases.find((c) =>
        request.userMessage.includes(c.transcript.split("\n")[0]!)
      );
      if (!match) return Promise.reject(new Error("no fixture for request"));
      return Promise.resolve({
        content: readFileSync(join(fixturesDir, `${match.evalCase.id}.json`), "utf8"),
        latencyMs: 1234,
      });
    },
  };
}

describe("runSuite progress", () => {
  it("is silent when no callback is given", async () => {
    // The default for every caller that existed before this: a run that
    // says nothing is the old behaviour, not a regression.
    const report = await runSuite(suite, fixtureClient(), { ...TRAIN, repeat: 2 });
    expect(report.cases).toHaveLength(7);
  });

  it("emits one sample event per call, in order, with its position", async () => {
    const events: RunProgress[] = [];
    await runSuite(suite, fixtureClient(), {
      ...TRAIN,
      repeat: 2,
      onProgress: (e) => events.push(e),
    });

    const samples = events.filter((e) => e.kind === "sample");
    expect(samples).toHaveLength(14);
    const first = samples[0]!;
    expect(first).toMatchObject({
      caseId: "order-management",
      caseIndex: 1,
      caseCount: 7,
      run: 1,
      repeat: 2,
      attempts: 1,
    });
    // caseCount is the number actually being run, not the suite's ten:
    // a progress counter that promised ten and stopped at seven would
    // read as a crash.
    expect(samples.every((s) => s.kind === "sample" && s.caseCount === 7)).toBe(true);
  });

  it("carries the score and the provider's own latency", async () => {
    const events: RunProgress[] = [];
    await runSuite(suite, fixtureClient(), { ...TRAIN, onProgress: (e) => events.push(e) });
    const first = events[0]!;
    expect(first.kind).toBe("sample");
    if (first.kind !== "sample") return;
    expect(first.score).toBeCloseTo(1, 10);
    expect(first.latencyMs).toBe(1234);
    expect(first.failed).toBeUndefined();
  });

  it("marks a sample that fell below the suite's collapse floor", async () => {
    // A floor above every achievable score stands in for a collapse.
    // Seeing it live is the point: three calls in, an operator can stop
    // a run whose rubric nothing can pass.
    //
    // Above 1.0, not 0.999: the answer keys score exactly 1.000 since
    // barwise-839, so a floor inside the unit interval no longer sits
    // above every achievable score.
    const events: RunProgress[] = [];
    await runSuite({ ...suite, collapseFloor: 1.001 }, fixtureClient(), {
      ...TRAIN,
      onProgress: (e) => events.push(e),
    });
    expect(events.every((e) => e.kind === "sample" && e.collapsed === true)).toBe(true);
  });

  it("does not mark collapses when the manifest declares no floor", async () => {
    const { collapseFloor: _omitted, ...noFloor } = suite;
    const events: RunProgress[] = [];
    await runSuite(noFloor, fixtureClient(), { ...TRAIN, onProgress: (e) => events.push(e) });
    expect(events.every((e) => e.kind === "sample" && e.collapsed === undefined)).toBe(true);
  });

  it("reports a failed call as failed rather than as a zero", async () => {
    // The distinction the runner already draws, carried into the live
    // output: an excluded run must not read as a score of 0.000.
    const client = {
      provider: "test",
      model: undefined,
      complete: () => Promise.reject(new Error("no API key configured")),
    };
    const events: RunProgress[] = [];
    await runSuite(suite, client, { ...TRAIN, onProgress: (e) => events.push(e) });
    const first = events[0]!;
    expect(first.kind).toBe("sample");
    if (first.kind !== "sample") return;
    expect(first.failed).toBe(true);
    expect(first.score).toBeUndefined();
    expect(first.error).toContain("no API key");
  });

  it("announces a retry before the backoff, not after the run", async () => {
    // The event that matters most, and the one a provider stub cannot
    // reach: while this fires, the process is sleeping. Without it the
    // wait is indistinguishable from a hang.
    let calls = 0;
    const inner = fixtureClient();
    const client = {
      provider: "test",
      model: undefined,
      complete: (request: CompletionRequest) => {
        calls++;
        if (calls === 1) {
          return Promise.reject(Object.assign(new Error("slow down"), { status: 429 }));
        }
        return inner.complete(request);
      },
    };
    const events: RunProgress[] = [];
    await runSuite(suite, client, {
      ...TRAIN,
      retry: { baseDelayMs: 1, sleep: () => Promise.resolve() },
      onProgress: (e) => events.push(e),
    });

    const retries = events.filter((e) => e.kind === "retry");
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      kind: "retry",
      caseId: "order-management",
      run: 1,
      attempt: 1,
      delayMs: 1,
    });
    // The retry is reported before the sample it belongs to resolves.
    expect(events.indexOf(retries[0]!)).toBeLessThan(
      events.findIndex((e) => e.kind === "sample"),
    );
  });

  it("keeps a caller's own onRetry working alongside the progress one", async () => {
    // runSuite wraps the retry options to add its own listener; a caller
    // that supplied one must not lose it.
    const seen: number[] = [];
    const result = await withRetry(
      () => Promise.reject(Object.assign(new Error("slow down"), { status: 429 })),
      {
        attempts: 2,
        baseDelayMs: 5,
        sleep: () => Promise.resolve(),
        onRetry: (info) => seen.push(info.delayMs),
      },
    );
    expect(result.ok).toBe(false);
    expect(seen).toEqual([5]);
  });
});
