/**
 * Tests for exercise-catalog discovery over the packaged seed catalog.
 */
import { describe, expect, it } from "vitest";
import { defaultCatalogDir, findExercise, listExercises } from "../src/exercise/catalog.js";

describe("catalog", () => {
  it("lists the packaged seed catalog", () => {
    const entries = listExercises();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries.map((e) => e.loaded.exercise.id)).toContain("customer-order");
  });

  it("finds an exercise by id and resolves its reference", () => {
    const entry = findExercise("customer-order");
    expect(entry).toBeDefined();
    expect(entry!.loaded.reference).toBeDefined();
    expect(entry!.loaded.exercise.transition).toEqual({ from: "novice", to: "initiate" });
  });

  it("returns undefined for an unknown id", () => {
    expect(findExercise("no-such-exercise")).toBeUndefined();
  });

  it("resolves the default catalog dir to the packaged exercises", () => {
    expect(defaultCatalogDir().endsWith("exercises")).toBe(true);
  });
});
