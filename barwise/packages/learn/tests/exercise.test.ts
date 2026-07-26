import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { evaluateCandidate } from "../src/evaluate/evaluateCandidate.js";
import { loadExercise } from "../src/exercise/loadExercise.js";
import { ExerciseParseError, parseExercise } from "../src/exercise/parseExercise.js";

const exercisePath = fileURLToPath(
  new URL("../exercises/customer-order.gym.yaml", import.meta.url),
);

describe("parseExercise", () => {
  const valid = {
    id: "x",
    title: "X",
    transition: { from: "novice", to: "initiate" },
    exitPerformance: "Model the thing unaided.",
    brief: "do the thing",
    checks: [
      { kind: "must_validate" },
      { kind: "requires_verbalization", sentence: "Each A bs C." },
      { kind: "requires_element", element: { entity: "A" } },
      { kind: "requires_element", element: { factTypeBetween: ["A", "B"] } },
      { kind: "forbids_population", factType: "A bs B", constraint: "internal_uniqueness" },
    ],
  };

  it("parses a valid document", () => {
    const ex = parseExercise(valid);
    expect(ex.id).toBe("x");
    expect(ex.checks).toHaveLength(5);
  });

  it("rejects a non-object document", () => {
    expect(() => parseExercise("nope")).toThrow(ExerciseParseError);
  });

  it("rejects the retired difficulty field with a migration message", () => {
    expect(() => parseExercise({ ...valid, difficulty: "intro" })).toThrow(/transition/);
  });

  it("rejects a transition with an unknown level", () => {
    expect(() => parseExercise({ ...valid, transition: { from: "novice", to: "wizard" } }))
      .toThrow(/transition.to/);
  });

  it("rejects a transition that does not move forward on the scale", () => {
    expect(() => parseExercise({ ...valid, transition: { from: "initiate", to: "novice" } }))
      .toThrow(/forward/);
    expect(() => parseExercise({ ...valid, transition: { from: "novice", to: "novice" } }))
      .toThrow(/forward/);
  });

  it("parses the optional C6 guidance fields on a check", () => {
    const ex = parseExercise({
      ...valid,
      reading: "Skim ch. 3.",
      checks: [{
        kind: "must_validate",
        hint: "check reference schemes",
        diagnosis: "a missing reference scheme",
        reading: "ch. 3, section 3.5",
      }],
    });
    expect(ex.reading).toBe("Skim ch. 3.");
    expect(ex.checks[0]).toMatchObject({
      hint: "check reference schemes",
      diagnosis: "a missing reference scheme",
      reading: "ch. 3, section 3.5",
    });
  });

  it("rejects empty checks", () => {
    expect(() => parseExercise({ ...valid, checks: [] })).toThrow(/checks/);
  });

  it("rejects an unknown check kind", () => {
    expect(() => parseExercise({ ...valid, checks: [{ kind: "nope" }] })).toThrow(/kind/);
  });

  it("rejects a forbids_population with a bad constraint kind", () => {
    expect(() =>
      parseExercise({
        ...valid,
        checks: [{ kind: "forbids_population", factType: "A bs B", constraint: "subset" }],
      })
    ).toThrow(/constraint/);
  });

  it("rejects a malformed element query", () => {
    expect(() =>
      parseExercise({ ...valid, checks: [{ kind: "requires_element", element: { foo: "A" } }] })
    ).toThrow(/element/);
  });

  it("rejects a missing required string field", () => {
    const { id: _omit, ...noId } = valid;
    expect(() => parseExercise(noId)).toThrow(/id/);
  });
});

describe("loadExercise", () => {
  it("loads the seed exercise and resolves its reference model", () => {
    const loaded = loadExercise(exercisePath);
    expect(loaded.exercise.id).toBe("customer-order");
    expect(loaded.reference).toBeDefined();
    expect(loaded.reference!.getObjectTypeByName("Order")).toBeDefined();
  });

  it("the reference model satisfies the exercise's own rubric", () => {
    const loaded = loadExercise(exercisePath);
    const report = evaluateCandidate(loaded.reference!, loaded.exercise, loaded.reference);
    expect(report.passed).toBe(true);
    expect(report.results.every((r) => r.passed)).toBe(true);
  });
});
