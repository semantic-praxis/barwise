/**
 * Tests for the suite runner with a mock LlmClient: per-case scoring in
 * manifest order, repeat sampling, zero-scored failed runs, and the
 * artifact guard. No real LLM calls.
 */
import type { CompletionRequest } from "@barwise/llm";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite, runSuite } from "../src/index.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/responses");
const suite = loadSuite(defaultSuitePath());

/**
 * Recorded payloads exist only for the train cases -- the three dev
 * cases have never run against a provider, which is what makes them a
 * held-out set. So every test that leans on the fixture client selects
 * `train`, which exercises the split selector at the same time.
 */
const TRAIN = { split: "train" } as const;
const trainCases = suite.cases.filter((c) => c.split === "train");

/** Answers each call with the recorded payload for the case whose
 *  transcript is embedded in the user message. */
function fixtureClient() {
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
      const payload = readFileSync(join(fixturesDir, `${match.evalCase.id}.json`), "utf8");
      return Promise.resolve({ content: payload, modelUsed: "fixture-model" });
    },
  };
}

describe("runSuite", () => {
  it("scores every case in manifest order and aggregates", async () => {
    const client = fixtureClient();
    const report = await runSuite(suite, client, TRAIN);
    expect(report.cases.map((c) => c.caseId)).toEqual(trainCases.map((c) => c.evalCase.id));
    expect(report.repeat).toBe(1);
    expect(report.artifactVersion).toBe("1.0.0");
    for (const c of report.cases) {
      expect(c.runs).toHaveLength(1);
      expect(c.runs[0]!.score?.rubricPassed).toBe(c.runs[0]!.score?.rubricTotal);
      expect(c.runs[0]!.modelUsed).toBe("fixture-model");
    }
    expect(report.mean).toBeCloseTo((0.98 + 0.96 + 0.96 + 0.94) / 4, 10);
    expect(report.worst).toBeCloseTo(0.94, 10);
  });

  it("repeat produces that many runs per case", async () => {
    const client = fixtureClient();
    const report = await runSuite(suite, client, { ...TRAIN, repeat: 2 });
    expect(client.requests).toHaveLength(trainCases.length * 2);
    for (const c of report.cases) expect(c.runs).toHaveLength(2);
  });

  it("reports no error bar at the default repeat, rather than a zero one", async () => {
    // repeat defaults to 1, so nothing about the spread is knowable.
    // Reporting 0 would claim the opposite of what the run can support.
    const report = await runSuite(suite, fixtureClient(), TRAIN);
    expect(report.dispersion.standardError).toBeUndefined();
    expect(report.dispersion.resolvableDifference).toBeUndefined();
    expect(report.dispersion.lowerBound).toBe(true);
    for (const c of report.cases) expect(c.sd).toBeUndefined();
  });

  it("reports a real zero when a deterministic client repeats", async () => {
    // The fixture client answers identically every time, so the spread
    // is genuinely zero -- distinct from "could not tell", which is the
    // case above.
    const report = await runSuite(suite, fixtureClient(), { ...TRAIN, repeat: 2 });
    expect(report.dispersion.standardError).toBe(0);
    expect(report.dispersion.resolvableDifference).toBe(0);
    expect(report.dispersion.lowerBound).toBe(false);
    for (const c of report.cases) expect(c.sd).toBe(0);
  });

  it("marks the interval a lower bound when a case lost runs to failure", async () => {
    // One case drops to a single sample, so its variance is unknown and
    // the suite's interval understates. Saying so is the point.
    let first = true;
    const inner = fixtureClient();
    const client = {
      provider: "test",
      model: undefined,
      complete: (request: CompletionRequest) => {
        if (first) {
          first = false;
          return Promise.reject(new Error("boom"));
        }
        return inner.complete(request);
      },
    };
    const report = await runSuite(suite, client, { ...TRAIN, repeat: 2 });
    expect(report.cases[0]!.samples).toBe(1);
    expect(report.cases[0]!.sd).toBeUndefined();
    expect(report.dispersion.lowerBound).toBe(true);
  });

  it("excludes a failed call from the mean instead of scoring it zero", async () => {
    // The behaviour this replaces produced three junk history rows on
    // the first keyed run: a call that never reached the model was
    // averaged in as if the model had scored zero (barwise-806).
    let first = true;
    const client = {
      provider: "test",
      model: undefined,
      complete: (request: CompletionRequest) => {
        if (first) {
          first = false;
          return Promise.reject(new Error("boom"));
        }
        return fixtureClient().complete(request);
      },
    };
    const report = await runSuite(suite, client, TRAIN);
    const failedCase = report.cases[0]!;
    expect(failedCase.runs[0]!.failed).toBe(true);
    expect(failedCase.runs[0]!.error).toBe("boom");
    expect(failedCase.samples).toBe(0);
    expect(failedCase.failures).toBe(1);
    // No sample, so no claim: the mean is not evidence of a zero score.
    expect(failedCase.mean).toBe(0);
    expect(report.failures).toBe(1);
    expect(report.complete).toBe(false);

    // The suite mean is the mean of the cases that produced samples,
    // and is strictly higher than folding the unsampled case in as a
    // zero would give -- which is the whole point of the change.
    const sampled = report.cases.filter((c) => c.samples > 0);
    expect(sampled).toHaveLength(trainCases.length - 1);
    const expected = sampled.reduce((s, c) => s + c.mean, 0) / sampled.length;
    expect(report.mean).toBeCloseTo(expected, 10);
    const withFabricatedZero = sampled.reduce((s, c) => s + c.mean, 0) / report.cases.length;
    expect(report.mean).toBeGreaterThan(withFabricatedZero);

    // worst comes from a real run, never from the absent one.
    expect(report.worst).toBeCloseTo(Math.min(...sampled.map((c) => c.worst)), 10);
    expect(report.worst).toBeGreaterThan(0);
    expect(report.cases[1]!.runs[0]!.score).toBeDefined();
  });

  it("keeps partial samples when only some runs of a case fail", async () => {
    let calls = 0;
    const inner = fixtureClient();
    const client = {
      provider: "test",
      model: undefined,
      complete: (request: CompletionRequest) => {
        calls++;
        if (calls === 1) return Promise.reject(new Error("boom"));
        return inner.complete(request);
      },
    };
    const report = await runSuite(suite, client, { ...TRAIN, repeat: 3 });
    const first = report.cases[0]!;
    expect(first.failures).toBe(1);
    expect(first.samples).toBe(2);
    // The mean is over the two runs that answered, not over three.
    expect(first.mean).toBeCloseTo(0.98, 10);
    expect(report.complete).toBe(false);
  });

  it("scores an unusable payload as a real zero, not a failure", async () => {
    // The model answered. The answer was garbage. That is a measurement.
    const client = {
      provider: "test",
      model: undefined,
      complete: () => Promise.resolve({ content: "not json at all" }),
    };
    const report = await runSuite(suite, client, TRAIN);
    const first = report.cases[0]!;
    expect(first.runs[0]!.failed).toBeUndefined();
    expect(first.runs[0]!.score?.score).toBe(0);
    expect(first.samples).toBe(1);
    expect(first.failures).toBe(0);
    expect(report.complete).toBe(true);
    expect(report.failures).toBe(0);
  });

  it("reports every requested run as a sample on a healthy sweep", async () => {
    const client = fixtureClient();
    const report = await runSuite(suite, client, { ...TRAIN, repeat: 2 });
    expect(report.complete).toBe(true);
    expect(report.failures).toBe(0);
    for (const c of report.cases) expect(c.samples).toBe(2);
  });

  it("retries a transient failure before giving up on the run", async () => {
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
    const report = await runSuite(suite, client, {
      ...TRAIN,
      retry: { baseDelayMs: 1, sleep: () => Promise.resolve() },
    });
    expect(report.cases[0]!.runs[0]!.attempts).toBe(2);
    expect(report.cases[0]!.runs[0]!.score).toBeDefined();
    expect(report.complete).toBe(true);
  });

  it("rejects a non-extraction artifact", async () => {
    const client = fixtureClient();
    await expect(
      runSuite(suite, client, {
        artifact: { surface: "review", version: "1", instructions: "x", demos: [] },
      }),
    ).rejects.toThrow(/surface "review"/);
  });

  it("rejects a non-positive repeat", async () => {
    const client = fixtureClient();
    await expect(runSuite(suite, client, { repeat: 0 })).rejects.toThrow(/positive integer/);
  });

  it("a declared collapse floor leaves mean, worst and the error bar untouched", async () => {
    // The load-bearing compatibility claim of the whole workstream. If a
    // floor moved the composite, every recorded history row would become
    // incomparable, and that longitudinal record is the only evidence
    // this project has about whether prompts are improving.
    const withoutFloor = await runSuite(suite, fixtureClient(), { ...TRAIN, repeat: 2 });
    const floored = await runSuite({ ...suite, collapseFloor: 0.5 }, fixtureClient(), {
      ...TRAIN,
      repeat: 2,
    });

    expect(floored.mean).toBe(withoutFloor.mean);
    expect(floored.worst).toBe(withoutFloor.worst);
    expect(floored.dispersion).toEqual(withoutFloor.dispersion);
    for (let i = 0; i < floored.cases.length; i++) {
      expect(floored.cases[i]!.sd).toBe(withoutFloor.cases[i]!.sd);
      expect(floored.cases[i]!.samples).toBe(withoutFloor.cases[i]!.samples);
    }
  });

  it("reports nothing about collapses when the manifest declares no floor", async () => {
    // The packaged manifest now declares 0.3, so the no-floor path is
    // reached by removing it -- the shape any suite authored before
    // eval-metric-readiness still has.
    const { collapseFloor: _omitted, ...noFloor } = suite;
    const report = await runSuite(noFloor, fixtureClient(), { ...TRAIN, repeat: 2 });
    for (const c of report.cases) {
      expect(c.collapses).toBeUndefined();
      expect(c.qualityMean).toBeUndefined();
      expect(c.qualitySd).toBeUndefined();
    }
  });

  it("splits each case at the floor when one is declared", async () => {
    // The fixture client answers with the recorded payloads, which all
    // score well above any sane floor, so nothing collapses and quality
    // equals the mean. That is the honest shape of a healthy run.
    const report = await runSuite({ ...suite, collapseFloor: 0.3 }, fixtureClient(), {
      ...TRAIN,
      repeat: 2,
    });
    for (const c of report.cases) {
      expect(c.collapses).toBe(0);
      expect(c.qualityMean).toBeCloseTo(c.mean, 12);
    }
  });

  it("reports no quality mean for a case that always collapsed", async () => {
    // A floor above every achievable score stands in for a case that
    // never produced a usable model: the count is reported, the quality
    // is absent rather than zero.
    const report = await runSuite({ ...suite, collapseFloor: 0.999 }, fixtureClient(), {
      ...TRAIN,
      repeat: 2,
    });
    const first = report.cases[0]!;
    expect(first.collapses).toBe(first.samples);
    expect(first.qualityMean).toBeUndefined();
    expect(first.qualitySd).toBeUndefined();
    // ...and the composite is still whatever it was.
    expect(first.mean).toBeGreaterThan(0);
  });
});
