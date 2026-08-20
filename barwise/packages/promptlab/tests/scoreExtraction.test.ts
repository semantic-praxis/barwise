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
import type { LoadedEvalCase, PromptCheck } from "../src/index.js";

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
    { caseId: "project-staffing", score: 0.98, corrections: 1 },
    { caseId: "conference-reviews", score: 0.96, corrections: 2 },
    { caseId: "freight-corrections", score: 0.94, corrections: 3 },
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
      ambiguityExcess: 0.5,
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

/**
 * The two check families in one rubric. `order-management`'s recorded
 * payload reports a single ambiguity -- a terminology collision between
 * the CRM's "customer" and billing's "client" -- so it is the seed case
 * that can exercise the payload half against real data.
 */
describe("scoreExtraction with both check families", () => {
  const ambiguityCheck: PromptCheck = {
    kind: "requires_ambiguity",
    matches: ["customer"],
  };

  function withChecks(
    caseId: string,
    extra: PromptCheck[],
    ambiguityBudget?: number,
  ): LoadedEvalCase {
    const base = caseFor(caseId);
    return {
      ...base,
      evalCase: {
        ...base.evalCase,
        ...(ambiguityBudget !== undefined ? { ambiguityBudget } : {}),
        checks: [...base.evalCase.checks, ...extra],
      },
    };
  }

  it("folds a passing payload check into the same rubric fraction", () => {
    const base = scoreExtraction(
      payloadFor("order-management"),
      caseFor("order-management"),
      suite.weights,
    );
    const mixed = scoreExtraction(
      payloadFor("order-management"),
      withChecks("order-management", [ambiguityCheck]),
      suite.weights,
    );
    expect(mixed.rubricTotal).toBe(base.rubricTotal + 1);
    expect(mixed.rubricPassed).toBe(base.rubricPassed + 1);
    // A perfect rubric stays perfect, so only the penalties differ.
    expect(mixed.score).toBe(base.score);
  });

  it("fails the payload check without disturbing the model checks", () => {
    const mixed = scoreExtraction(
      payloadFor("order-management"),
      withChecks("order-management", [{
        kind: "requires_ambiguity",
        matches: ["nothing in this payload"],
      }]),
      suite.weights,
    );
    const base = scoreExtraction(
      payloadFor("order-management"),
      caseFor("order-management"),
      suite.weights,
    );
    expect(mixed.rubricTotal).toBe(base.rubricTotal + 1);
    expect(mixed.rubricPassed).toBe(base.rubricPassed);
  });

  it("returns results in authored order across both families", () => {
    const mixed = scoreExtraction(
      payloadFor("order-management"),
      withChecks("order-management", [ambiguityCheck]),
      suite.weights,
    );
    const declared = withChecks("order-management", [ambiguityCheck])
      .evalCase.checks.map((c) => c.kind);
    expect(mixed.results.map((r) => r.kind)).toEqual(declared);
  });

  it("reports the ambiguity count and charges nothing without a budget", () => {
    const mixed = scoreExtraction(
      payloadFor("order-management"),
      withChecks("order-management", [ambiguityCheck]),
      suite.weights,
    );
    expect(mixed.ambiguitiesReported).toBe(1);
    expect(mixed.ambiguityExcess).toBe(0);
  });

  it("charges the excess penalty once a budget is exceeded", () => {
    const weights = { ...suite.weights, ambiguityExcess: 0.25 };
    const scored = scoreExtraction(
      payloadFor("order-management"),
      withChecks("order-management", [ambiguityCheck], 0),
      weights,
    );
    const unbudgeted = scoreExtraction(
      payloadFor("order-management"),
      withChecks("order-management", [ambiguityCheck]),
      weights,
    );
    expect(scored.ambiguityExcess).toBe(1);
    expect(unbudgeted.score - scored.score).toBeCloseTo(0.25, 10);
  });

  it("scores a rubric of payload checks alone, with no model checks", () => {
    const base = caseFor("order-management");
    const payloadOnly: LoadedEvalCase = {
      ...base,
      evalCase: { ...base.evalCase, checks: [ambiguityCheck] },
    };
    const result = scoreExtraction(
      payloadFor("order-management"),
      payloadOnly,
      suite.weights,
    );
    expect(result.rubricTotal).toBe(1);
    expect(result.rubricPassed).toBe(1);
  });
});
