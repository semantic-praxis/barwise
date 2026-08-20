/**
 * Tests for the promptlab-native check family
 * (docs/specs/eval-transcript-realism.spec.md). These grade the
 * extraction payload's ambiguity list rather than the parsed model, so
 * they need no model, no reference, and no LLM.
 */
import type { Ambiguity } from "@barwise/llm";
import { describe, expect, it } from "vitest";
import { ambiguityExcess, runPromptChecks } from "../src/index.js";
import type { PromptCheck } from "../src/index.js";

function ambiguity(description: string): Ambiguity {
  return { description, source_references: [] };
}

const check = (matches: string[], hint?: string): PromptCheck => ({
  kind: "requires_ambiguity",
  matches,
  ...(hint !== undefined ? { hint } : {}),
});

describe("requires_ambiguity matching", () => {
  it("passes when a reported ambiguity contains the match term", () => {
    const [result] = runPromptChecks(
      [check(["tier"])],
      [ambiguity("Ops and Finance use Tier for different things.")],
    );
    expect(result?.passed).toBe(true);
    expect(result?.kind).toBe("requires_ambiguity");
  });

  it("matches case-insensitively", () => {
    const [result] = runPromptChecks(
      [check(["OPERATING REGION"])],
      [ambiguity("Whether operating region is mandatory was not settled.")],
    );
    expect(result?.passed).toBe(true);
  });

  it("requires every term, so multiple terms narrow rather than widen", () => {
    const reported = [ambiguity("The tier value is unclear.")];
    expect(runPromptChecks([check(["tier"])], reported)[0]?.passed).toBe(true);
    expect(runPromptChecks([check(["tier", "finance"])], reported)[0]?.passed).toBe(false);
  });

  it("fails with a distinct message when nothing was reported at all", () => {
    const [result] = runPromptChecks([check(["tier"])], []);
    expect(result?.passed).toBe(false);
    expect(result?.message).toContain("No ambiguities were reported");
  });

  it("reports how many candidates it looked at when none matched", () => {
    const [result] = runPromptChecks(
      [check(["tier"])],
      [ambiguity("Something else"), ambiguity("Another thing")],
    );
    expect(result?.passed).toBe(false);
    expect(result?.message).toContain("2 reported ambiguities");
  });

  it("surfaces the author's hint only on failure", () => {
    const failed = runPromptChecks([check(["tier"], "Ops vs Finance.")], []);
    expect(failed[0]?.hint).toBe("Ops vs Finance.");
    const passed = runPromptChecks(
      [check(["tier"], "Ops vs Finance.")],
      [ambiguity("tier")],
    );
    expect(passed[0]?.hint).toBeUndefined();
  });

  it("evaluates checks in authored order", () => {
    const results = runPromptChecks(
      [check(["alpha"]), check(["beta"])],
      [ambiguity("beta only")],
    );
    expect(results.map((r) => r.passed)).toEqual([false, true]);
  });

  it("is pure: the same inputs give a byte-identical result", () => {
    const args = [[check(["tier"])], [ambiguity("tier")]] as const;
    expect(JSON.stringify(runPromptChecks(...args)))
      .toBe(JSON.stringify(runPromptChecks(...args)));
  });
});

describe("ambiguityExcess", () => {
  it("is zero when no budget is declared, however many are reported", () => {
    expect(ambiguityExcess(50, undefined)).toBe(0);
  });

  it("is zero at or under budget", () => {
    expect(ambiguityExcess(3, 4)).toBe(0);
    expect(ambiguityExcess(4, 4)).toBe(0);
  });

  it("counts only the overflow", () => {
    expect(ambiguityExcess(7, 4)).toBe(3);
  });

  it("treats a zero budget as forbidding ambiguities outright", () => {
    expect(ambiguityExcess(2, 0)).toBe(2);
  });
});
