/**
 * Tests for the deterministic scorer over the packaged seed suite. The
 * recorded extraction payloads are the suite's answer keys: each must
 * pass its full rubric, and the exact scores are pinned so a change to
 * the scorer, the rubrics, or the references is a visible diff.
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { defaultSuitePath, loadSuite, scoreExtraction } from "../src/index.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/responses");
const suite = loadSuite(defaultSuitePath());

function payloadFor(caseId: string): string {
  return readFileSync(join(fixturesDir, `${caseId}.json`), "utf8");
}

function caseFor(caseId: string) {
  const loaded = suite.cases.find((c) => c.evalCase.id === caseId);
  if (!loaded) throw new Error(`missing case ${caseId}`);
  return loaded;
}

describe("scoreExtraction over the seed suite", () => {
  const expected = [
    { caseId: "order-management", score: 0.98, corrections: 1 },
    { caseId: "university-enrollment", score: 0.96, corrections: 2 },
    { caseId: "clinic-appointments", score: 0.96, corrections: 2 },
    { caseId: "employee-hierarchy", score: 0.94, corrections: 3 },
  ];

  it.each(expected)(
    "$caseId: the recorded payload passes its full rubric",
    ({ caseId, score, corrections }) => {
      const result = scoreExtraction(payloadFor(caseId), caseFor(caseId), suite.weights);
      expect(result.rubricPassed).toBe(result.rubricTotal);
      expect(result.conformanceCorrections).toBe(corrections);
      expect(result.validationErrors).toBe(0);
      expect(result.score).toBeCloseTo(score, 10);
    },
  );

  it("is deterministic: identical inputs give an identical CaseScore", () => {
    const a = scoreExtraction(
      payloadFor("order-management"),
      caseFor("order-management"),
      suite.weights,
    );
    const b = scoreExtraction(
      payloadFor("order-management"),
      caseFor("order-management"),
      suite.weights,
    );
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("applies the declared weights and floors at zero", () => {
    const heavy = {
      conformanceCorrection: 0.5,
      validationError: 0.5,
      validationWarning: 0.5,
    };
    const result = scoreExtraction(
      payloadFor("employee-hierarchy"),
      caseFor("employee-hierarchy"),
      heavy,
    );
    // 3 corrections at 0.5 overwhelm a perfect rubric: 1.0 - 1.5 -> 0.
    expect(result.score).toBe(0);
  });

  it("throws on a payload that is not JSON", () => {
    expect(() => scoreExtraction("not json", caseFor("order-management"), suite.weights))
      .toThrow();
  });

  it("scores an empty extraction low but does not throw", () => {
    const empty = JSON.stringify({
      object_types: [],
      fact_types: [],
      subtypes: [],
      inferred_constraints: [],
      objectified_fact_types: [],
      populations: [],
      ambiguities: [],
    });
    const result = scoreExtraction(empty, caseFor("order-management"), suite.weights);
    expect(result.rubricPassed).toBeLessThan(result.rubricTotal);
    expect(result.score).toBeLessThan(0.5);
  });
});
