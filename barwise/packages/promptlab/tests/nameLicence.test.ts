/**
 * The licence end to end (docs/specs/eval-name-licensing.spec.md,
 * workstream 2): university-enrollment declares `CourseOffering` and
 * `Offering` one concept, and an extraction naming the entity with the
 * transcript's dominant word scores its full rubric.
 *
 * The synonym payload is the recorded answer key with the entity
 * renamed -- exactly the difference between the two payloads retained
 * from the 2.0.0 baseline run, where the renamed one scored 0.154 on a
 * rubric it structurally satisfied
 * (docs/prompt-eval-2.0.0-haiku45-2026-08-26.md).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { LoadedEvalCase } from "../src/index.js";
import { defaultSuitePath, loadSuite, scoreExtraction } from "../src/index.js";

const fixturesDir = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/responses");
const suite = loadSuite(defaultSuitePath());

const loadedCase = suite.cases.find((c) => c.evalCase.id === "university-enrollment")!;

/**
 * The answer key with the entity renamed to the transcript's dominant
 * word -- everywhere. The token appears as the object type's name, as a
 * role player, in fact-type names, and in constraint role hints, and a
 * real extraction that picked "Offering" is consistent across all of
 * them; renaming only some orphans the constraint hints and turns a
 * vocabulary difference into a structural one.
 */
function synonymPayload(): string {
  return readFileSync(join(fixturesDir, "university-enrollment.json"), "utf8")
    .replaceAll("CourseOffering", "Offering");
}

/** The same case with the licence stripped, for the mutation direction. */
function unlicensed(): LoadedEvalCase {
  const { vocabulary: _dropped, ...evalCase } = loadedCase.evalCase;
  return { ...loadedCase, evalCase };
}

describe("the university-enrollment licence", () => {
  it("is declared on the shipped case", () => {
    expect(loadedCase.evalCase.vocabulary).toEqual([["CourseOffering", "Offering"]]);
  });

  it("scores the synonym payload's full rubric", () => {
    const score = scoreExtraction(synonymPayload(), loadedCase, suite.weights);
    expect(score.rubricPassed).toBe(score.rubricTotal);
    // A rename changes no penalty input, so the score matches the
    // answer key's pinned 1.000 exactly.
    expect(score.score).toBe(1);
  });

  it("mutation check: without the licence the rename collapses the score", () => {
    // Guards the passing direction against a loosened resolver: if the
    // licence were ignored and matching had become fuzzy, this payload
    // would score 1.000 here too. Only must_validate survives -- the
    // recorded 0.154 collapse's shape, over the rubric as it stands
    // (eight checks since suite 2.2.0).
    const score = scoreExtraction(synonymPayload(), unlicensed(), suite.weights);
    expect(score.rubricPassed).toBe(1);
    expect(score.score).toBeCloseTo(1 / score.rubricTotal, 10);
  });

  it("leaves the answer key's score untouched", () => {
    const score = scoreExtraction(
      readFileSync(join(fixturesDir, "university-enrollment.json"), "utf8"),
      loadedCase,
      suite.weights,
    );
    expect(score.score).toBe(1);
  });
});
