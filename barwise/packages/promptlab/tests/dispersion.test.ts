/**
 * The dispersion arithmetic, tested against hand-computed inputs
 * (eval-run-resolution-and-provenance spec, workstream 1).
 *
 * Deliberately not tested through a mock client: a wrong denominator
 * produces a plausible number, and only a known input catches it. The
 * n=1 cases carry the most weight here -- reporting 0 for a single
 * sample claims perfect precision, which is the exact failure this
 * module exists to prevent.
 */
import { describe, expect, it } from "vitest";
import { dispersionOf, marginOfError, sampleSd } from "../src/stats/dispersion.js";

describe("sampleSd", () => {
  it("is undefined for fewer than two samples", () => {
    expect(sampleSd([])).toBeUndefined();
    expect(sampleSd([0.9])).toBeUndefined();
  });

  it("is zero when every sample agrees", () => {
    expect(sampleSd([1, 1, 1])).toBe(0);
  });

  it("uses the n-1 denominator", () => {
    // [0, 2]: mean 1, squares 1+1=2, /(2-1) = 2, sqrt = 1.414...
    // The population form would give 1. This pins which one we use.
    expect(sampleSd([0, 2])).toBeCloseTo(Math.SQRT2, 12);
  });

  it("matches a hand-computed spread", () => {
    // [1.0, 0.95, 0.95, 1.0, 1.0] -- mean 0.98, squares 0.002,
    // /(5-1) = 0.0005, sqrt ~= 0.0273861
    expect(sampleSd([1.0, 0.95, 0.95, 1.0, 1.0])).toBeCloseTo(0.0273861, 6);
  });
});

describe("dispersionOf", () => {
  it("reports nothing when no case was scored", () => {
    expect(dispersionOf([{ caseId: "a", samples: 0 }])).toEqual({ lowerBound: false });
  });

  it("reports no standard error when every case has one sample", () => {
    // The default repeat. Claiming a precision here would be the worst
    // possible answer, so the absence is the assertion.
    const d = dispersionOf([
      { caseId: "a", samples: 1 },
      { caseId: "b", samples: 1 },
    ]);
    expect(d.standardError).toBeUndefined();
    expect(d.resolvableDifference).toBeUndefined();
    expect(d.lowerBound).toBe(true);
  });

  it("computes the suite standard error from per-case spreads", () => {
    // Two cases, sd 0.2 over 4 samples each.
    // per-case variance = 0.04/4 = 0.01 each; total 0.02
    // SE = sqrt(0.02)/2 = 0.0707107
    const d = dispersionOf([
      { caseId: "a", sd: 0.2, samples: 4 },
      { caseId: "b", sd: 0.2, samples: 4 },
    ]);
    expect(d.standardError).toBeCloseTo(0.0707107, 6);
    expect(d.lowerBound).toBe(false);
  });

  it("reproduces the recorded Haiku run", () => {
    // The numbers behind the spec's argument, so a change to the fold
    // shows up as a contradiction of the report it was derived from.
    const d = dispersionOf([
      { caseId: "order-management", sd: 0.0273861, samples: 5 },
      { caseId: "university-enrollment", sd: 0.1516575, samples: 5 },
      { caseId: "clinic-appointments", sd: 0.0919239, samples: 5 },
      { caseId: "employee-hierarchy", sd: 0.0178885, samples: 5 },
      { caseId: "project-staffing", sd: 0.4382921, samples: 5 },
      { caseId: "conference-reviews", sd: 0, samples: 5 },
      { caseId: "freight-corrections", sd: 0.1532547, samples: 5 },
    ]);
    expect(d.standardError).toBeCloseTo(0.0318, 4);
    expect(d.resolvableDifference).toBeCloseTo(0.088, 3);
    expect(d.dominantCase?.caseId).toBe("project-staffing");
    expect(d.dominantCase?.share).toBeCloseTo(0.77, 2);
  });

  it("counts an unknown-variance case in the mean and flags the understatement", () => {
    // The one-sample case still divides the suite mean, so it stays in
    // k; its variance is unknown, so it adds nothing to the numerator.
    // SE = sqrt(0.04/4)/2 = 0.05, not the 0.0707 of a single-case suite.
    const d = dispersionOf([
      { caseId: "a", sd: 0.2, samples: 4 },
      { caseId: "b", samples: 1 },
    ]);
    expect(d.standardError).toBeCloseTo(0.05, 12);
    expect(d.lowerBound).toBe(true);
  });

  it("reports a real zero when every sample scored identically", () => {
    // Distinct from "we could not tell": the run did resolve, and the
    // answer was that nothing varied.
    const d = dispersionOf([
      { caseId: "a", sd: 0, samples: 3 },
      { caseId: "b", sd: 0, samples: 3 },
    ]);
    expect(d.standardError).toBe(0);
    expect(d.resolvableDifference).toBe(0);
    expect(d.lowerBound).toBe(false);
  });

  it("names the dominant case even when it is the only one that varies", () => {
    const d = dispersionOf([
      { caseId: "steady", sd: 0, samples: 3 },
      { caseId: "volatile", sd: 0.4, samples: 3 },
    ]);
    expect(d.dominantCase).toEqual({ caseId: "volatile", share: 1 });
  });
});

describe("marginOfError", () => {
  it("is undefined without a standard error", () => {
    expect(marginOfError(undefined)).toBeUndefined();
  });

  it("is the 95% half-width", () => {
    expect(marginOfError(0.0318)).toBeCloseTo(0.0623, 4);
  });
});
