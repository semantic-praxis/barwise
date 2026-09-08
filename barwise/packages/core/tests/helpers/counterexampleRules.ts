/**
 * The counterexample round trip, in one place.
 *
 * A counterexample is the deterministic inverse of population
 * validation: attaching its forbidden populations to the model must make
 * the matching rule fire. Three tests asserted that
 * (`CounterexampleGenerator.test.ts`, the retired
 * `roundTrip.property.test.ts`, and `laws/counterexample.law.test.ts`),
 * each with its own copy of the constraint-kind-to-rule-id table and its
 * own copy of the attach/validate/detach dance -- a must-agree copy with
 * nothing checking it. One copy now.
 *
 * Two things the copies could not do. The table is typed against the
 * constraint union, so a kind added to the metamodel fails to compile
 * here until someone classifies it; and it reads its rule ids from
 * `RULE_ID` rather than re-spelling the strings, so a renamed rule
 * cannot leave a stale literal behind.
 */

import type { Counterexample } from "../../src/counterexample/Counterexample.js";
import { generateCounterexamples } from "../../src/counterexample/CounterexampleGenerator.js";
import type { Constraint } from "../../src/model/Constraint.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

/**
 * The population rule each constraint kind's counterexample must trip.
 *
 * `null` means the generator deliberately emits no counterexample for
 * that kind. The five null entries mirror the `return undefined` arm of
 * `generateCounterexampleForConstraint`, which carries the two reasons;
 * they are listed rather than omitted so that "no generator yet" stays
 * distinguishable from "nobody noticed" on this side too.
 *
 * That mirroring is a must-agree pair, and both directions fail loudly
 * rather than drifting. A kind that gains a generator while its entry
 * stays null trips the "mapped to no rule" failure below; a kind that
 * loses one while its entry stays a rule id fails the law's coverage
 * assertion, which compares the kinds actually emitted against the
 * non-null entries here.
 */
const RULE_BY_TYPE = {
  internal_uniqueness: RULE_ID.uniquenessViolation,
  value_constraint: RULE_ID.valueConstraintViolation,
  frequency: RULE_ID.frequencyViolation,
  ring: RULE_ID.ringViolation,
  mandatory: RULE_ID.mandatoryViolation,
  disjunctive_mandatory: RULE_ID.disjunctiveMandatoryViolation,
  exclusion: RULE_ID.exclusionViolation,
  exclusive_or: RULE_ID.exclusiveOrViolation,
  subset: RULE_ID.subsetViolation,
  equality: RULE_ID.equalityViolation,
  external_uniqueness: RULE_ID.externalUniquenessViolation,
  value_comparison: null,
  cardinality: null,
  join_subset: null,
  join_equality: null,
  join_exclusion: null,
} as const satisfies Record<Constraint["type"], string | null>;

/** The rule a counterexample of this kind must trip, or null if none is generated. */
export function expectedRuleFor(type: Constraint["type"]): string | null {
  return RULE_BY_TYPE[type];
}

/**
 * Attach `ce`'s forbidden populations, validate, and detach them again,
 * so each counterexample is judged in isolation of the others.
 */
function ruleIdsWith(model: OrmModel, ce: Counterexample): string[] {
  const added: string[] = [];
  for (const forbidden of ce.forbidden) {
    const pop = model.addPopulation({ factTypeId: forbidden.factTypeId });
    for (const inst of forbidden.instances) {
      pop.addInstance({ roleValues: { ...inst.roleValues } });
    }
    added.push(pop.id);
  }
  const ruleIds = populationValidationRules(model).map((d) => d.ruleId);
  for (const id of added) model.removePopulation(id);
  return ruleIds;
}

/**
 * Check every counterexample the model yields against its own rule.
 * Returns a description of the first failure, or undefined when all pass.
 *
 * Mutating: the model's own populations are removed first, and the model
 * is left without them. A generated model may already violate a rule, and
 * a pre-existing violation of the rule under test would make the check
 * pass with the counterexample doing no work at all -- so the model is
 * emptied rather than trusted. `generateCounterexamples` does not read
 * `model.populations`, so this does not change what it produces.
 */
export function counterexampleRoundTripFailure(model: OrmModel): string | undefined {
  for (const pop of [...model.populations]) model.removePopulation(pop.id);

  for (const ce of generateCounterexamples(model)) {
    const expected = expectedRuleFor(ce.constraintType);
    if (expected === null) {
      return `${ce.constraintType} yielded a counterexample but is mapped to no rule`;
    }
    const ruleIds = ruleIdsWith(model, ce);
    if (!ruleIds.includes(expected)) {
      return `${ce.constraintType} counterexample did not trip ${expected}; `
        + `got [${[...new Set(ruleIds)].join(", ")}]`;
    }
  }
  return undefined;
}
