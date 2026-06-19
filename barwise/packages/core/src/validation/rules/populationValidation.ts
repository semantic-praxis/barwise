import type { OrmModel } from "../../model/OrmModel.js";
import type { Diagnostic } from "../Diagnostic.js";
import {
  checkObjectCardinalityViolations,
  checkUnaryRoleCardinalityViolations,
} from "./population/cardinality.js";
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
import {
  checkSpanningEqualityViolations,
  checkSpanningExclusionViolations,
  checkSpanningExclusiveOrViolations,
  checkSpanningSubsetViolations,
} from "./population/spanning.js";
import { checkDanglingPopulationFactType } from "./population/structural.js";
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
export function populationValidationRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkDanglingPopulationFactType(model));
  diagnostics.push(...checkUniquenessViolations(model));
  diagnostics.push(...checkValueConstraintViolations(model));
  diagnostics.push(...checkValueComparisonViolations(model));
  diagnostics.push(...checkFrequencyViolations(model));
  diagnostics.push(...checkExclusionViolations(model));
  diagnostics.push(...checkExclusiveOrViolations(model));
  diagnostics.push(...checkSubsetViolations(model));
  diagnostics.push(...checkEqualityViolations(model));
  diagnostics.push(...checkRingViolations(model));
  diagnostics.push(...checkMandatoryViolations(model));
  diagnostics.push(...checkDisjunctiveMandatoryViolations(model));
  diagnostics.push(...checkSpanningExclusionViolations(model));
  diagnostics.push(...checkSpanningExclusiveOrViolations(model));
  diagnostics.push(...checkSpanningSubsetViolations(model));
  diagnostics.push(...checkSpanningEqualityViolations(model));
  diagnostics.push(...checkExternalUniquenessViolations(model));
  diagnostics.push(...checkObjectCardinalityViolations(model));
  diagnostics.push(...checkUnaryRoleCardinalityViolations(model));

  return diagnostics;
}
