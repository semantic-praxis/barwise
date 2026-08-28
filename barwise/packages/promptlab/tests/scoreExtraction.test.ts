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
  // Every train answer key scores exactly 1.000 as of barwise-839. It
  // did not before: the seven ran 0.94-0.98, and all fourteen of the
  // corrections between them were `orphaned_reference_mode` -- a check
  // that mirrored no validator rule and charged 0.02 for what ORM
  // reference-mode notation is for. Removing it left these payloads
  // scoring what a hand-curated reference payload should score.
  //
  // A 1.000 row is a stronger pin than a 0.94 one, because there is now
  // exactly one way to be right and any regression moves the number.
  //
  // The 1.000 rows cannot detect a wrong denominator, and it is worth
  // saying so where a reader will look for the guarantee. Suite 2.0.0
  // rates every penalty by element count, but a payload that produces
  // no occurrences scores 1.000 under any denominator -- including a
  // multiplied one. The arithmetic is asserted in "size-rated
  // penalties" below, on hand-built payloads that do produce
  // occurrences (docs/specs/eval-split-stratification.spec.md); the
  // two sub-1.000 dev rows below now also exercise the real division.
  //
  // `elements` is pinned here anyway, because it is what those
  // divisions would have been measured against and a payload edited
  // without noticing should show up as a diff.
  //
  // The three dev keys (suite 2.5.0, barwise-845) pin below 1.000 on
  // purpose: each is the best payload of the recorded 2026-08-27
  // haiku45-2 sweep, and two carry conformance corrections that are
  // defects of the recorded extraction, not of any rubric. Editing a
  // recorded payload to make it clean would forge the record;
  // re-running until a clean one appears would be payload-shopping.
  // The full-rubric pass is the invariant; the exact sub-1.000 score
  // is the pin.
  const expected = [
    { caseId: "order-management", score: 1, corrections: 0, elements: 10 },
    { caseId: "university-enrollment", score: 1, corrections: 0, elements: 21 },
    { caseId: "clinic-appointments", score: 1, corrections: 0, elements: 19 },
    { caseId: "employee-hierarchy", score: 1, corrections: 0, elements: 8 },
    { caseId: "project-staffing", score: 1, corrections: 0, elements: 6 },
    { caseId: "conference-reviews", score: 1, corrections: 0, elements: 6 },
    { caseId: "freight-corrections", score: 1, corrections: 0, elements: 6 },
    { caseId: "vendor-onboarding", score: 1, corrections: 0, elements: 33 },
    // 1 - 0.2 * (1/36): one arity_mismatch correction.
    { caseId: "subscription-billing", score: 179 / 180, corrections: 1, elements: 36 },
    // 1 - 0.2 * (1/30) - 0.4 * (2/30): one arity_mismatch -- the
    // payload's cross-fact-type encoding of the alert-or-ticket
    // disjunctive mandatory, which the schema's one-fact_type
    // constraint shape cannot carry -- and two completeness warnings
    // on the origin fact types it left unconstrained as a result.
    { caseId: "incident-response", score: 29 / 30, corrections: 1, elements: 30 },
  ];

  it.each(expected)(
    "$caseId: the recorded payload passes its full rubric",
    ({ caseId, score, corrections, elements }) => {
      const result = scoreExtraction(payloadFor(caseId), caseFor(caseId), suite.weights);
      expect(result.rubricPassed).toBe(result.rubricTotal);
      expect(result.conformanceCorrections).toBe(corrections);
      expect(result.validationErrors).toBe(0);
      expect(result.elementCount).toBe(elements);
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
    // The weight needed to reach the floor moved with the rating, which
    // is the whole point: one correction on a ten-element model is a
    // 10% defect rate, so it costs a tenth of its weight rather than
    // all of it. Under 1.3.0 a weight of 2 flattened this payload; it
    // now takes 20.
    const heavy = {
      conformanceCorrection: 20,
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
    expect(result.elementCount).toBe(10);
    // 1.0 - 20 * (1 / 10) = -1.0, floored to 0.
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
    expect(result.elementCount).toBe(0);
    // No division happened, so the score is the bare rubric fraction.
    expect(result.score).toBeCloseTo(result.rubricPassed / result.rubricTotal, 10);
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

/**
 * The rate arithmetic, asserted rather than assumed.
 *
 * Suite 2.0.0 divides each rule's occurrence count by the scored
 * model's element count before applying the weight
 * (docs/specs/eval-split-stratification.spec.md). The 1.000 answer
 * keys cannot check that: they produce no occurrences, so they score
 * 1.000 under any denominator, and a scorer that multiplied by element
 * count instead of dividing would pass every one of them. These
 * payloads are hand-built to produce a known number of occurrences at
 * a known element count, so the division is pinned against arithmetic
 * the reader can redo (the two sub-1.000 dev keys pin it again on
 * recorded payloads).
 *
 * Mutation check for anyone touching the fold: change `rated` to
 * multiply instead of divide and every assertion in this block must
 * fail. If they still pass, the block is decorative.
 */
describe("scoreExtraction: size-rated penalties", () => {
  /**
   * `n` copies of a two-object-type binary fact type, each carrying
   * exactly two warnings: one reading on a binary
   * (`structural/binary-missing-inverse-reading`) and no constraints
   * (`completeness/fact-type-without-constraints`). So the model holds
   * `3n` elements and `2n` warnings -- a defect rate that does not move
   * with `n`, which is the property rating exists to preserve.
   */
  function repeatedDefect(n: number): string {
    const objectTypes = [];
    const factTypes = [];
    for (let i = 0; i < n; i++) {
      objectTypes.push(
        {
          name: `Customer${i}`,
          kind: "entity",
          reference_mode: "customer_id",
          source_references: [],
        },
        {
          name: `Order${i}`,
          kind: "entity",
          reference_mode: "order_number",
          source_references: [],
        },
      );
      factTypes.push({
        name: `Customer${i} places Order${i}`,
        roles: [
          { player: `Customer${i}`, role_name: "places" },
          { player: `Order${i}`, role_name: "is placed by" },
        ],
        readings: ["{0} places {1}"],
        source_references: [],
      });
    }
    return JSON.stringify({
      object_types: objectTypes,
      fact_types: factTypes,
      subtypes: [],
      inferred_constraints: [],
      objectified_fact_types: [],
      populations: [],
      ambiguities: [],
    });
  }

  /**
   * A rubric of one `must_validate` check, which these payloads pass.
   * The rubric fraction is then a fixed 1.0 and every movement in the
   * score is the penalty, which is what this block is measuring.
   */
  function validateOnly(): LoadedEvalCase {
    const base = caseFor("order-management");
    return {
      ...base,
      evalCase: { ...base.evalCase, checks: [{ kind: "must_validate" }] },
    };
  }

  const weights = {
    conformanceCorrection: 0.2,
    validationError: 0.8,
    validationWarning: 0.4,
    ambiguityExcess: 0.02,
  };

  it("charges a rule at its rate over element count, not at its count", () => {
    const result = scoreExtraction(repeatedDefect(1), validateOnly(), weights);

    // Two object types plus one fact type.
    expect(result.elementCount).toBe(3);
    expect(result.validationWarnings).toBe(2);
    expect(result.warningsByRule).toEqual({
      "structural/binary-missing-inverse-reading": 1,
      "completeness/fact-type-without-constraints": 1,
    });
    // 1.0 - 0.4 * (2 / 3) = 0.7333...  Counted rather than rated it
    // would be 1.0 - 0.4 * 2 = 0.2, and multiplied it would floor at 0.
    expect(result.score).toBeCloseTo(1 - 0.4 * (2 / 3), 10);
  });

  it("scores the same defect rate the same, whatever the model's size", () => {
    const small = scoreExtraction(repeatedDefect(1), validateOnly(), weights);
    const medium = scoreExtraction(repeatedDefect(2), validateOnly(), weights);
    const large = scoreExtraction(repeatedDefect(4), validateOnly(), weights);

    expect([small.elementCount, medium.elementCount, large.elementCount])
      .toEqual([3, 6, 12]);
    expect([small.validationWarnings, medium.validationWarnings, large.validationWarnings])
      .toEqual([2, 4, 8]);

    // This is the defect the spec was written against. Under 1.3.0's
    // counted penalties these three scored 0.90, 0.80 and 0.60 -- the
    // same modelling mistake charged four times over for describing
    // four times as much domain, which is how the long dev transcripts
    // came to floor at 0.000 and compare equal to each other.
    // Above the clamp, and asserted rather than assumed: three floored
    // scores are also equal to each other, and equality bought that way
    // is the exact pathology being removed rather than evidence against
    // it. Anything below 1.0 here also refutes a scorer that dropped
    // the penalty term altogether.
    expect(small.score).toBeGreaterThan(0);
    expect(small.score).toBeLessThan(1);
    expect(medium.score).toBeCloseTo(small.score, 10);
    expect(large.score).toBeCloseTo(small.score, 10);
  });

  it("charges nothing on a model with no elements rather than dividing by zero", () => {
    // An extraction with no object or fact types can still produce a
    // conformance correction: this constraint names a fact type that is
    // not there. Rating it would divide by zero, so the scorer charges
    // nothing and lets the rubric fraction carry the verdict -- which
    // it does, since no empty model satisfies a rubric.
    const emptyWithCorrection = JSON.stringify({
      object_types: [],
      fact_types: [],
      subtypes: [],
      inferred_constraints: [{
        type: "exclusion",
        fact_type: "Customer places Order",
        roles: ["Customer"],
        description: "malformed: names a fact type the model does not hold",
        confidence: "high",
        source_references: [{ lines: [1, 2], excerpt: "test" }],
      }],
      objectified_fact_types: [],
      populations: [],
      ambiguities: [],
    });
    const ruinous = {
      conformanceCorrection: 1000,
      validationError: 1000,
      validationWarning: 1000,
      ambiguityExcess: 1000,
    };
    const result = scoreExtraction(emptyWithCorrection, validateOnly(), ruinous);

    expect(result.elementCount).toBe(0);
    expect(result.conformanceCorrections).toBe(1);
    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBe(1);
  });
});
