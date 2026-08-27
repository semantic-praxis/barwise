/**
 * Evaluate a candidate model against an exercise's rubric.
 *
 * Pure and deterministic: the same candidate, exercise, and reference
 * produce an identical report. (The `forbids_population` runner adds a
 * population to the candidate to test it and removes it again, leaving the
 * candidate observably unchanged.)
 */
import type { OrmModel } from "@barwise/core";
import type { GymExercise } from "../exercise/types.js";
import { forbidsPopulation } from "./checks/forbidsPopulation.js";
import { mustValidate } from "./checks/mustValidate.js";
import { requiresElement } from "./checks/requiresElement.js";
import { requiresVerbalization } from "./checks/requiresVerbalization.js";
import type { CheckResult, GymReport } from "./GymReport.js";

export function evaluateCandidate(
  candidate: OrmModel,
  exercise: GymExercise,
  reference?: OrmModel,
): GymReport {
  const results: CheckResult[] = exercise.checks.map((check): CheckResult => {
    switch (check.kind) {
      case "must_validate":
        return mustValidate(candidate);
      case "requires_verbalization":
        return requiresVerbalization(candidate, check.sentence, check.hint);
      case "requires_element":
        return requiresElement(candidate, check.element, check.hint, exercise.vocabulary);
      case "forbids_population":
        return forbidsPopulation(
          candidate,
          reference,
          check.factType,
          check.constraint,
          check.hint,
          exercise.vocabulary,
        );
    }
  });

  return {
    exerciseId: exercise.id,
    passed: results.every((r) => r.passed),
    results,
  };
}
