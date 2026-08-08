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

/** Answers each call with the recorded payload for the case whose
 *  transcript is embedded in the user message. */
function fixtureClient() {
  const requests: CompletionRequest[] = [];
  return {
    requests,
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
    const report = await runSuite(suite, client);
    expect(report.cases.map((c) => c.caseId)).toEqual(suite.cases.map((c) => c.evalCase.id));
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
    const report = await runSuite(suite, client, { repeat: 2 });
    expect(client.requests).toHaveLength(suite.cases.length * 2);
    for (const c of report.cases) expect(c.runs).toHaveLength(2);
  });

  it("a failed LLM call scores zero instead of aborting the sweep", async () => {
    let first = true;
    const client = {
      complete: (request: CompletionRequest) => {
        if (first) {
          first = false;
          return Promise.reject(new Error("boom"));
        }
        return fixtureClient().complete(request);
      },
    };
    const report = await runSuite(suite, client);
    expect(report.cases[0]!.runs[0]!.error).toBe("boom");
    expect(report.cases[0]!.mean).toBe(0);
    expect(report.worst).toBe(0);
    // The remaining cases still scored.
    expect(report.cases[1]!.runs[0]!.score).toBeDefined();
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
});
