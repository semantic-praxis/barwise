/**
 * Per-mode payload retention (barwise-891, riding the 2.6.0 bump with
 * docs/specs/wider-shape-correspondence.spec.md). Best-and-worst
 * retention lost the middle of every trimodal case; one payload per
 * distinct score mode -- equal after rounding to the three decimals
 * every report prints -- keeps each failure mode diagnosable without
 * keeping every repeat of it.
 */
import { describe, expect, it } from "vitest";
import type { CaseRun } from "../src/run/runSuite.js";
import { keepDiagnosticPayloads } from "../src/run/runSuite.js";

/** A scored run whose only fields under test are score and payload. */
function scored(score: number, payload: string): CaseRun {
  return { score: { score } as CaseRun["score"], payload } as CaseRun;
}

describe("keepDiagnosticPayloads", () => {
  it("keeps one payload per score mode, middle modes included", () => {
    // The recorded conference shape: 0.592 / 0.833 / 1.000. Best-and-
    // worst kept two of these; the 0.833 middle mode is the diff that
    // separates the two failure modes and must survive.
    const runs = [
      scored(1.0, "clean-1"),
      scored(0.833, "middle"),
      scored(1.0, "clean-2"),
      scored(0.592, "collapse"),
    ];
    const kept = keepDiagnosticPayloads(runs).map((r) => r.payload);
    expect(kept).toEqual(["clean-1", "middle", undefined, "collapse"]);
  });

  it("treats scores equal at three decimals as one mode", () => {
    // 0.9500 and 0.95004 print identically, so a second payload for
    // the same printed score names nothing new; 0.9490 is a real mode.
    const runs = [scored(0.95, "a"), scored(0.95004, "b"), scored(0.949, "c")];
    const kept = keepDiagnosticPayloads(runs).map((r) => r.payload);
    expect(kept).toEqual(["a", undefined, "c"]);
  });

  it("always keeps the payload of an unscorable run", () => {
    const failed = {
      score: { score: 0 } as CaseRun["score"],
      error: "parse rejected",
      payload: "broken",
    } as CaseRun;
    const runs = [scored(1.0, "clean"), failed, scored(1.0, "clean-repeat")];
    const kept = keepDiagnosticPayloads(runs).map((r) => r.payload);
    expect(kept).toEqual(["clean", "broken", undefined]);
  });
});
