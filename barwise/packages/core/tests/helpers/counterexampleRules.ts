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
import { type Constraint, roleIdsOf } from "../../src/model/Constraint.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";
import { graphFor } from "./graphFor.js";

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
  const ruleIds = populationValidationRules(model, graphFor(model)).map((d) => d.ruleId);
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

/**
 * Every rule a constraint of each kind can produce.
 *
 * Distinct from `RULE_BY_TYPE` above, which answers a narrower question
 * -- which rule a COUNTEREXAMPLE of this kind must trip -- and is null
 * for the kinds the generator does not probe. Those kinds still produce
 * diagnostics when a population breaks them, and `strayFailures` needs
 * to know which. The two must agree where both speak, and
 * `counterexample.law.test.ts` asserts that rather than trusting it.
 *
 * Typed against the constraint union for the same reason `RULE_BY_TYPE`
 * is: a kind added to the metamodel fails to compile here until someone
 * says what it can report.
 */
const RULES_FROM_KIND = {
  internal_uniqueness: [RULE_ID.uniquenessViolation],
  external_uniqueness: [RULE_ID.externalUniquenessViolation],
  mandatory: [RULE_ID.mandatoryViolation],
  disjunctive_mandatory: [RULE_ID.disjunctiveMandatoryViolation],
  value_constraint: [RULE_ID.valueConstraintViolation],
  exclusion: [RULE_ID.exclusionViolation],
  exclusive_or: [RULE_ID.exclusiveOrViolation],
  subset: [RULE_ID.subsetViolation],
  equality: [RULE_ID.equalityViolation],
  ring: [RULE_ID.ringViolation],
  frequency: [RULE_ID.frequencyViolation],
  value_comparison: [RULE_ID.valueComparisonViolation],
  cardinality: [RULE_ID.objectCardinalityViolation, RULE_ID.unaryRoleCardinalityViolation],
  join_subset: [RULE_ID.joinSubsetViolation],
  join_equality: [RULE_ID.joinEqualityViolation],
  join_exclusion: [RULE_ID.joinExclusionViolation],
} as const satisfies Record<Constraint["type"], readonly string[]>;

/** Exposed so the law can check it against `RULE_BY_TYPE`. */
export function rulesFromKind(type: Constraint["type"]): readonly string[] {
  return RULES_FROM_KIND[type];
}

/**
 * The rules a counterexample cannot be blamed for tripping: those a
 * constraint reaching OUTSIDE the fact types it populated can produce.
 *
 * A counterexample is a PARTIAL population by construction -- it
 * populates only what it needs to break one constraint -- so a
 * constraint with a role in a fact type it left empty is asking a
 * question the counterexample does not answer, and no filler value
 * changes the answer. Closing those needs a globally consistent
 * population, which is constraint solving rather than counterexample
 * generation.
 *
 * This is deliberately NOT CLAUDE.md's present-data / absent-data split,
 * which barwise-995 proposed and the measurement retired. That axis is a
 * shadow of this one and diverges exactly on constraints relating two
 * fact types: a subset constraint reads populations directly, so it is
 * present-data, and it fires because the partner fact type is empty. See
 * `docs/specs/counterexample-stray-rules.spec.md`.
 *
 * The reach is read from `roleIdsOf`, so a constraint kind added to the
 * metamodel is classified by the code that already knows its shape.
 */
function nonLocalRuleIds(model: OrmModel, ce: Counterexample): Set<string> {
  const home = new Map<string, string>();
  for (const ft of model.factTypes) for (const role of ft.roles) home.set(role.id, ft.id);

  const populated = new Set(ce.forbidden.map((f) => f.factTypeId));
  const out = new Set<string>();
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      const reaches = roleIdsOf(c).map((rid) => home.get(rid));
      const outside = !populated.has(ft.id)
        || reaches.some((ftId) => ftId === undefined || !populated.has(ftId));
      if (outside) { for (const id of RULES_FROM_KIND[c.type]) out.add(id); }
    }
  }
  // Object cardinality is declared on the object type, not on a role, so
  // `roleIdsOf` cannot see it. It counts the whole object universe,
  // which a partial population can never complete.
  for (const ot of model.objectTypes) {
    if (ot.cardinality) out.add(RULE_ID.objectCardinalityViolation);
  }
  return out;
}

/** One counterexample tripping one rule that is neither its own nor non-local. */
export interface LocalStray {
  readonly constraintType: Constraint["type"];
  readonly ruleId: string;
}

/**
 * Every LOCAL stray this model's counterexamples produce: a rule tripped
 * besides the probe's own, by data the probe itself minted, inside the
 * fact types it populated.
 *
 * Mutating in the same way `counterexampleRoundTripFailure` is, and for
 * the same reason: the model's own populations are removed first, so a
 * pre-existing violation is not counted as a stray.
 */
export function localStrays(model: OrmModel): LocalStray[] {
  for (const pop of [...model.populations]) model.removePopulation(pop.id);

  const strays: LocalStray[] = [];
  for (const ce of generateCounterexamples(model)) {
    const expected = expectedRuleFor(ce.constraintType);
    const excluded = nonLocalRuleIds(model, ce);
    for (const ruleId of new Set(ruleIdsWith(model, ce))) {
      if (ruleId === expected || excluded.has(ruleId)) continue;
      strays.push({ constraintType: ce.constraintType, ruleId });
    }
  }
  return strays;
}
