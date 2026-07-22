import {
  type Constraint,
  isFrequency,
  isInternalUniqueness,
  isMandatoryRole,
  isRing,
  isValueConstraint,
  type OrmModel,
  type PopulationConfig,
  ValidationEngine,
} from "@barwise/core";
import { generateCounterexampleForConstraint } from "@barwise/core/counterexample";
import type { ConstraintKind } from "../../exercise/types.js";
import type { CheckResult } from "../GymReport.js";
import { mapForbiddenPopulation } from "../populationMapping.js";

const GUARDS: Record<ConstraintKind, (c: Constraint) => boolean> = {
  internal_uniqueness: isInternalUniqueness,
  mandatory: isMandatoryRole,
  value: isValueConstraint,
  frequency: isFrequency,
  ring: isRing,
};

const fail = (message: string, hint?: string): CheckResult => ({
  kind: "forbids_population",
  passed: false,
  message,
  hint,
});

/**
 * Add the given populations to the candidate, check whether the
 * candidate's own constraints reject any of them, then remove them again
 * (the candidate is left unchanged). "Reject" means population validation
 * emits an error-severity `population/*` diagnostic. When the candidate
 * carries no populations of its own -- the normal case for an exercise
 * model -- any such diagnostic must come from an injected population.
 */
function candidateRejects(candidate: OrmModel, configs: PopulationConfig[]): boolean {
  const hadOwnPopulations = candidate.populations.length > 0;
  const addedIds: string[] = [];
  try {
    for (const cfg of configs) addedIds.push(candidate.addPopulation(cfg).id);
    const popErrors = new ValidationEngine().validate(candidate)
      .filter((d) => d.severity === "error" && d.ruleId.startsWith("population/"));
    if (!hadOwnPopulations) return popErrors.length > 0;
    return popErrors.some((d) => addedIds.includes(d.elementId));
  } finally {
    for (const id of addedIds) candidate.removePopulation(id);
  }
}

/**
 * Pass iff the candidate rejects the population the named reference
 * constraint forbids. The population is derived from the reference model
 * (via `generateCounterexampleForConstraint`) and mapped onto the
 * candidate, so a candidate that has not encoded the constraint -- or has
 * not modeled the relationship at all -- fails, with a concrete message.
 */
export function forbidsPopulation(
  candidate: OrmModel,
  reference: OrmModel | undefined,
  factTypeName: string,
  constraintKind: ConstraintKind,
  hint?: string,
): CheckResult {
  if (!reference) {
    return fail(`This check needs a reference model, but the exercise declares none.`);
  }

  const refFt = reference.getFactTypeByName(factTypeName);
  if (!refFt) {
    return fail(`The reference model has no fact type named "${factTypeName}" (exercise error).`);
  }

  const constraint = refFt.constraints.find(GUARDS[constraintKind]);
  if (!constraint) {
    return fail(
      `The reference fact type "${factTypeName}" has no ${constraintKind} constraint (exercise error).`,
    );
  }

  const counterexample = generateCounterexampleForConstraint(constraint, refFt, reference);
  if (!counterexample || counterexample.forbidden.length === 0) {
    return fail(
      `Could not generate a forbidden population for the ${constraintKind} constraint on `
        + `"${factTypeName}" (unsupported constraint shape).`,
    );
  }

  const configs: PopulationConfig[] = [];
  for (const pop of counterexample.forbidden) {
    const mapped = mapForbiddenPopulation(pop, reference, candidate);
    if (!mapped) {
      return fail(
        `Your model does not yet carry the relationship this rule guards `
          + `(no fact type matching "${factTypeName}"), so it cannot rule out: ${counterexample.text}`,
        hint,
      );
    }
    configs.push(mapped);
  }

  if (candidateRejects(candidate, configs)) {
    return {
      kind: "forbids_population",
      passed: true,
      message: `Your model correctly rules out: ${counterexample.text}`,
    };
  }

  return fail(`Your model still allows what it should forbid: ${counterexample.text}`, hint);
}
