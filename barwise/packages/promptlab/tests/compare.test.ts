/**
 * `compareRows` (barwise-893,
 * docs/specs/recorded-evidence-commands.spec.md).
 *
 * The verdict has to match what `runSuite` would say, which is why the
 * margin comes from `marginOfError` rather than a constant repeated
 * here. What these tests pin is the boundary behaviour: the refusal, and
 * the ways a margin can be unavailable.
 */
import { describe, expect, it } from "vitest";
import type { HistoryEntry } from "../src/history/history.js";
import { compareRows } from "../src/record/compare.js";

function row(over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    date: "2026-01-01T00:00:00.000Z",
    suiteVersion: "2.8.0",
    artifactVersion: "1.0.0",
    repeat: 5,
    mean: 0.8,
    worst: 0.5,
    standardError: 0.02,
    cases: [{ caseId: "alpha", mean: 0.8, worst: 0.5, samples: 5, sd: 0.05 }],
    ...over,
  } as HistoryEntry;
}

describe("compareRows", () => {
  it("REFUSES rows from different suite versions", () => {
    // The whole reason the field is recorded: a bump changes what a
    // score means, so the subtraction has no referent.
    expect(() => compareRows(row(), row({ suiteVersion: "2.7.0" })))
      .toThrow(/not comparable: suite 2\.8\.0 vs 2\.7\.0/);
  });

  it("reads deltas as b minus a", () => {
    expect(compareRows(row({ mean: 0.8 }), row({ mean: 0.9 })).suite.delta)
      .toBeCloseTo(0.1, 10);
  });

  it("resolves only when the gap exceeds the combined margin", () => {
    // Two SEs of 0.02 give margins of 1.96*0.02 each; combined that is
    // sqrt(2) * 0.0392 = 0.0554.
    const wide = compareRows(row({ mean: 0.8 }), row({ mean: 0.9 }));
    expect(wide.suite.margin).toBeCloseTo(0.0554, 3);
    expect(wide.suite.resolved).toBe(true);

    const narrow = compareRows(row({ mean: 0.8 }), row({ mean: 0.81 }));
    expect(narrow.suite.resolved).toBe(false);
  });

  it("reports no margin, and never resolves, when a row lacks a standard error", () => {
    // An old row genuinely does not know its precision. Treating that
    // as zero would turn "unknown" into "infinitely precise".
    const v = compareRows(row({ standardError: undefined }), row({ mean: 0.99 })).suite;
    expect(v.margin).toBeUndefined();
    expect(v.resolved).toBe(false);
  });

  it("gives a case no margin below two samples", () => {
    const one = { caseId: "alpha", mean: 0.8, worst: 0.5, samples: 1, sd: 0 };
    const v = compareRows(row({ cases: [one] }), row({ cases: [{ ...one, mean: 0.99 }] }));
    expect(v.cases[0]!.margin).toBeUndefined();
    expect(v.cases[0]!.resolved).toBe(false);
  });

  it("names cases present in only one row rather than dropping them", () => {
    const a = row({ cases: [{ caseId: "alpha", mean: 0.8, worst: 0.5 }] });
    const b = row({ cases: [{ caseId: "beta", mean: 0.8, worst: 0.5 }] });
    const c = compareRows(a, b);
    expect(c.cases).toHaveLength(0);
    expect(c.onlyInA).toEqual(["alpha"]);
    expect(c.onlyInB).toEqual(["beta"]);
  });
});
