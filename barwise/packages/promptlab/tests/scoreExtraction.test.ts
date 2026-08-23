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
  // Every answer key scores exactly 1.000 as of barwise-839. It did not
  // before: the seven ran 0.94-0.98, and all fourteen of the
  // corrections between them were `orphaned_reference_mode` -- a check
  // that mirrored no validator rule and charged 0.02 for what ORM
  // reference-mode notation is for. Removing it left these payloads
  // scoring what a hand-curated reference payload should score.
  //
  // A 1.000 row is a stronger pin than a 0.94 one, because there is now
  // exactly one way to be right and any regression moves the number.
  const expected = [
    { caseId: "order-management", score: 1, corrections: 0 },
    { caseId: "university-enrollment", score: 1, corrections: 0 },
    { caseId: "clinic-appointments", score: 1, corrections: 0 },
    { caseId: "employee-hierarchy", score: 1, corrections: 0 },
    { caseId: "project-staffing", score: 1, corrections: 0 },
    { caseId: "conference-reviews", score: 1, corrections: 0 },
    { caseId: "freight-corrections", score: 1, corrections: 0 },
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
    // The penalty has to be manufactured now that every answer key is
    // clean. That is the honest form of this test anyway: it was always
    // about the weights and the floor, and leaning on a reference
    // payload happening to be imperfect made it hostage to an unrelated
    // decision -- which is exactly how barwise-839 came to be load
    // bearing without anyone choosing it.
    const payload = JSON.parse(payloadFor("order-management")) as {
      inferred_constraints: unknown[];
    };
    payload.inferred_constraints.push({
      type: "exclusion",
      fact_type: "Customer places Order",
      roles: ["Customer"],
      description: "malformed: exclusion over a single role",
      confidence: "high",
      source_references: [{ lines: [1, 2], excerpt: "test" }],
    });
    const heavy = {
      conformanceCorrection: 2,
      validationError: 0.5,
      validationWarning: 0.5,
      ambiguityExcess: 0.5,
    };
    const result = scoreExtraction(
      JSON.stringify(payload),
      caseFor("order-management"),
      heavy,
    );

    expect(result.conformanceCorrections).toBe(1);
    // One correction at 2.0 overwhelms a perfect rubric: 1.0 - 2.0 -> 0.
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
