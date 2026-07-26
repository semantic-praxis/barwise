/**
 * Tests for miss-card emission (learning-design C6): failed checks map
 * deterministically to deck-format card rows; passed checks emit
 * nothing; the file honors the deck's `#separator:tab` convention.
 */
import { describe, expect, it } from "vitest";
import { buildMissCards, renderMissCardFile } from "../src/deck/missCards.js";
import type { GymReport } from "../src/evaluate/GymReport.js";
import type { GymExercise } from "../src/exercise/types.js";

const exercise: GymExercise = {
  id: "customer-order",
  title: "One customer per order",
  transition: { from: "novice", to: "initiate" },
  exitPerformance: "Model and constrain the fact type unaided.",
  brief: "Model that a customer places orders.",
  reading: "Skim ch. 3-4.",
  checks: [
    { kind: "must_validate" },
    {
      kind: "forbids_population",
      factType: "Customer places Order",
      constraint: "internal_uniqueness",
      hint: "Put a uniqueness constraint on the Order role.",
      diagnosis: "Constraints are the rule itself, not decoration.",
      reading: "ch. 4, sections 4.1-4.3.",
    },
  ],
};

function report(passed: [boolean, boolean]): GymReport {
  return {
    exerciseId: "customer-order",
    passed: passed.every(Boolean),
    results: [
      { kind: "must_validate", passed: passed[0], message: "The model has 1 validation error(s)." },
      {
        kind: "forbids_population",
        passed: passed[1],
        message: "The model accepts a population it should forbid.",
        hint: "Put a uniqueness constraint on the Order role.",
      },
    ],
  };
}

describe("buildMissCards", () => {
  it("emits one card per failed check, none for passes", () => {
    expect(buildMissCards(exercise, report([true, true]))).toHaveLength(0);
    expect(buildMissCards(exercise, report([true, false]))).toHaveLength(1);
    expect(buildMissCards(exercise, report([false, false]))).toHaveLength(2);
  });

  it("puts the check and hint on the front, diagnosis and reading on the back", () => {
    const [card] = buildMissCards(exercise, report([true, false]));
    expect(card!.front).toContain("One customer per order");
    expect(card!.front).toContain("internal uniqueness");
    expect(card!.front).toContain("Hint: Put a uniqueness constraint");
    expect(card!.back).toContain("Constraints are the rule itself");
    expect(card!.back).toContain("Read: ch. 4, sections 4.1-4.3.");
  });

  it("falls back to the exercise-level reading when the check has none", () => {
    const [card] = buildMissCards(exercise, report([false, true]));
    expect(card!.back).toContain("Read: Skim ch. 3-4.");
  });

  it("is deterministic: same submission, byte-identical cards", () => {
    const a = renderMissCardFile(exercise, buildMissCards(exercise, report([false, false])));
    const b = renderMissCardFile(exercise, buildMissCards(exercise, report([false, false])));
    expect(a).toBe(b);
  });

  it("keeps card fields free of tabs and newlines", () => {
    const cards = buildMissCards(exercise, report([false, false]));
    for (const c of cards) {
      expect(c.front).not.toMatch(/[\t\n]/);
      expect(c.back).not.toMatch(/[\t\n]/);
    }
  });
});

describe("renderMissCardFile", () => {
  it("renders the deck import headers and the misses subdeck", () => {
    const out = renderMissCardFile(exercise, buildMissCards(exercise, report([true, false])));
    const lines = out.trimEnd().split("\n");
    expect(lines.slice(0, 5)).toEqual([
      "#separator:tab",
      "#html:true",
      "#notetype:Basic",
      "#deck:ORM 2::Misses",
      "#tags:orm misses gym-customer-order",
    ]);
    expect(lines[5]).toContain("\t");
  });
});
