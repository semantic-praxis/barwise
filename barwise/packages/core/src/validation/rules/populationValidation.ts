import type { ModelGraph } from "../../model/graph.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import {
  checkObjectCardinalityViolations,
  checkUnaryRoleCardinalityViolations,
} from "./population/cardinality.js";
import { checkJoinPathViolations } from "./population/joinPath.js";
import {
  checkDisjunctiveMandatoryViolations,
  checkMandatoryViolations,
} from "./population/mandatory.js";
import { checkRingViolations } from "./population/ring.js";
import {
  checkEqualityViolations,
  checkExclusionViolations,
  checkExclusiveOrViolations,
  checkSubsetViolations,
} from "./population/setComparison.js";
import { buildObjectUniverse, type ObjectUniverse } from "./population/shared.js";
import {
  checkSpanningEqualityViolations,
  checkSpanningExclusionViolations,
  checkSpanningExclusiveOrViolations,
  checkSpanningSubsetViolations,
} from "./population/spanning.js";
import {
  checkIncompleteInstances,
} from "./population/structural.js";
import {
  checkExternalUniquenessViolations,
  checkUniquenessViolations,
} from "./population/uniqueness.js";
import { checkValueComparisonViolations } from "./population/valueComparison.js";
import {
  checkFrequencyViolations,
  checkValueConstraintViolations,
} from "./population/valueFrequency.js";

/**
 * Population validation rules.
 *
 * These check sample fact instances against the constraints declared
 * on their fact types:
 *
 * - Dangling fact type reference: population references a nonexistent fact type.
 * - Internal uniqueness violations: duplicate tuples for the constrained role set.
 * - Value constraint violations: instance values not in the allowed set.
 * - Frequency violations: a role is played too few or too many times.
 * - Exclusion violations: an object plays more than one excluded role.
 * - Exclusive-or violations: an object does not play exactly one of the roles.
 * - Subset violations: a tuple in the subset roles has no match in the superset roles.
 * - Equality violations: the tuple sets for both role sequences differ.
 * - External uniqueness violations: two distinct common-object instances
 *   share the same identifying combination across the joined fact types.
 * - Ring violations: reflexive relationship properties are violated.
 * - Mandatory violations: an object instance exists somewhere but does not
 *   play a role it is required to play.
 * - Disjunctive mandatory violations: an object instance plays none of the
 *   roles it is required to play at least one of.
 *
 * Mandatory and disjunctive mandatory are checked against the object
 * universe -- every value that appears in any role played by a type across
 * all populations (a closed-world reading of the sample). Exclusion,
 * exclusive-or, subset, and equality constraints whose roles span fact
 * types are checked too. External uniqueness is checked by inferring the
 * common-object join key and flagging two distinct common instances that
 * share the same identifying combination; it is skipped when that join
 * key cannot be inferred as a single clear object type.
 *
 * Each rule family lives in its own module under `population/`; this file
 * is the orchestrator that runs them in order.
 */
/**
 * A rule that judges a model by what its non-sample data does NOT
 * contain.
 *
 * The universe is a parameter rather than something each rule fetches,
 * so that "which rules judge by absence" is a fact stated once, in the
 * table below, instead of a set restated wherever someone needs it --
 * which was `sample.law.test.ts`, and which
 * `core-model-laws.spec.md` WS4 was going to guard with a parity
 * manifest row (docs/specs/object-universe-as-a-parameter.spec.md).
 */
export type UniverseRule = (model: OrmModel, universe: ObjectUniverse) => Diagnostic[];

/**
 * The rules that judge by ABSENT data. A sample population is not
 * evidence about the world -- `buildObjectUniverse` skips it -- so
 * adding one may satisfy an obligation and must never create one. That
 * is the law in `sample.law.test.ts`, which reads this list.
 *
 * `as const satisfies` is what makes it a claim: a rule that does not
 * take a universe cannot be listed, and a rule that takes one and is
 * left out never receives it, so its call below does not compile
 * either. The other direction -- a new rule calling
 * `buildObjectUniverse` itself instead of joining the list -- is not a
 * type question, and is covered by the import scan in
 * `tests/validation/universeRuleTable.test.ts`.
 */
export const UNIVERSE_RULES = [
  checkMandatoryViolations,
  checkDisjunctiveMandatoryViolations,
  checkSpanningExclusiveOrViolations,
  checkObjectCardinalityViolations,
  checkJoinPathViolations,
] as const satisfies readonly UniverseRule[];

/**
 * The subset of `UNIVERSE_RULES` that judge ONLY by absence.
 *
 * Two of the five read the universe and are deliberately outside this
 * subset, and the difference is the finding rather than a convenience.
 *
 * `checkJoinPathViolations` reads the universe to enumerate a join
 * path's roots, but REPORTS two operands projecting the same tuple --
 * a present-data violation. `checkSpanningExclusiveOrViolations` reads
 * it to know which values must play exactly one role, and reports both
 * "plays none" (absence) and "plays two" (presence) under one rule id.
 * A sample population supplies tuples, so it can legitimately make
 * either fire: a sample is incomplete, not false.
 *
 * That is the distinction a set of rule IDS could not express, which is
 * why `core-model-laws.spec.md` WS4's Option B was not implementable --
 * one rule id straddles the boundary. What is left here is the three
 * rules whose every diagnostic is derived from absence: an object that
 * exists and plays no mandatory role, one that plays none of a
 * disjunctive set, and a type whose instance count comes from the
 * universe alone. A sample can only add plays, so it can only remove
 * those.
 *
 * Typed as a subset of the list above, so a rule can only be here if it
 * is also there.
 */
export const ABSENT_DATA_RULES = [
  checkMandatoryViolations,
  checkDisjunctiveMandatoryViolations,
  checkObjectCardinalityViolations,
] as const satisfies readonly (typeof UNIVERSE_RULES)[number][];

export function populationValidationRules(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  // Once, not once per rule: it walks every instance of every
  // population, and five rules used to build the same map for
  // themselves.
  const universe = buildObjectUniverse(model);

  diagnostics.push(...checkIncompleteInstances(model, graph));
  diagnostics.push(...checkUniquenessViolations(model));
  diagnostics.push(...checkValueConstraintViolations(model));
  diagnostics.push(...checkValueComparisonViolations(model));
  diagnostics.push(...checkFrequencyViolations(model));
  diagnostics.push(...checkExclusionViolations(model));
  diagnostics.push(...checkExclusiveOrViolations(model));
  diagnostics.push(...checkSubsetViolations(model));
  diagnostics.push(...checkEqualityViolations(model));
  diagnostics.push(...checkRingViolations(model));
  diagnostics.push(...checkMandatoryViolations(model, universe));
  diagnostics.push(...checkDisjunctiveMandatoryViolations(model, universe));
  diagnostics.push(...checkSpanningExclusionViolations(model));
  diagnostics.push(...checkSpanningExclusiveOrViolations(model, universe));
  diagnostics.push(...checkSpanningSubsetViolations(model));
  diagnostics.push(...checkSpanningEqualityViolations(model));
  diagnostics.push(...checkExternalUniquenessViolations(model));
  diagnostics.push(...checkObjectCardinalityViolations(model, universe));
  diagnostics.push(...checkUnaryRoleCardinalityViolations(model));
  diagnostics.push(...checkJoinPathViolations(model, universe));

  return diagnostics;
}
