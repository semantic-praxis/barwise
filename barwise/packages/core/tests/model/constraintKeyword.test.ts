/**
 * The shared constraint-keyword matcher (barwise-866). Query and
 * describe previously owned separate matchers that disagreed
 * silently; these cases pin the shared semantics both now get,
 * including the two divergences the audit found: "disjunctive"
 * matched only in query, and describe's "exclusive-or" over-matched
 * `exclusion`.
 */
import { describe, expect, it } from "vitest";
import {
  matchesConstraintType,
  normalizeConstraintKeyword,
} from "../../src/model/constraintKeyword.js";

describe("normalizeConstraintKeyword", () => {
  it("lowercases and folds hyphens and spaces to underscores", () => {
    expect(normalizeConstraintKeyword("Exclusive-Or")).toBe("exclusive_or");
    expect(normalizeConstraintKeyword("internal uniqueness")).toBe("internal_uniqueness");
  });
});

describe("matchesConstraintType", () => {
  it("matches exactly", () => {
    expect(matchesConstraintType("ring", "ring")).toBe(true);
    expect(matchesConstraintType("mandatory", "Mandatory")).toBe(true);
  });

  it("matches by substring, so a family keyword covers its members", () => {
    expect(matchesConstraintType("internal_uniqueness", "uniqueness")).toBe(true);
    expect(matchesConstraintType("external_uniqueness", "uniqueness")).toBe(true);
    expect(matchesConstraintType("disjunctive_mandatory", "disjunctive")).toBe(true);
    expect(matchesConstraintType("value_constraint", "value")).toBe(true);
  });

  it("normalizes hyphenated keywords to the snake_case discriminators", () => {
    expect(matchesConstraintType("exclusive_or", "exclusive-or")).toBe(true);
  });

  it("does not let exclusive-or bleed into exclusion", () => {
    // describe's old matcher answered true here (includes("exclusive"));
    // query's answered false. The shared answer is false: "exclusion"
    // does not contain "exclusive_or".
    expect(matchesConstraintType("exclusion", "exclusive-or")).toBe(false);
  });

  it("rejects a keyword outside the type", () => {
    expect(matchesConstraintType("frequency", "uniqueness")).toBe(false);
  });
});
