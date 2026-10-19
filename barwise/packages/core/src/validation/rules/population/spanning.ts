import { isEquality, isExclusion, isExclusiveOr, isSubset } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { reportAs, RULE_ID } from "../../ruleId.js";
import { constraintElementId, localFactTypeOf } from "../../span.js";
import {
  type ObjectUniverse,
  rolePlayerMap,
  severityForModality,
  tuplesForRoleSeq,
  valuesPlayedInRole,
} from "./shared.js";

/**
 * Exclusion constraints: no object may play more than one of the excluded
 * roles, across the whole population. Every exclusion is checked here,
 * whether its roles span fact types or sit in one: an object that plays
 * both roles in different fact instances violates it as surely as one
 * that plays both in a single instance, which is all a per-instance check
 * could see (owner, 2026-10-19; orm-format-3 3a-ii-b notes).
 */
export function checkExclusionViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isExclusion(c)) continue;

    const valuesByRole = c.roleIds.map((rid) => valuesPlayedInRole(model, rid));
    const all = new Set<string>();
    for (const set of valuesByRole) {
      for (const value of set) all.add(value);
    }
    for (const value of all) {
      const count = valuesByRole.filter((set) => set.has(value)).length;
      if (count > 1) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.exclusionViolation,
            "default",
            constraintElementId(c),
            c.roleIds.join(", "),
            value,
            count,
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * Exclusive-or constraints: every instance of the common player type must
 * play exactly one of the roles, across the whole population. Checked here
 * for every exclusive-or, local or spanning: a per-instance reading would
 * flag every instance of a fact type that fills both roles, which is every
 * instance of a binary (owner, 2026-10-19).
 *
 * The two halves read different sets. "Plays more than one" is present
 * data, so it reads every value played, sample populations included -- a
 * sample is positive evidence. "Plays none" is absence, so it reads only
 * the universe, which leaves samples out.
 */
export function checkExclusiveOrViolations(
  model: OrmModel,
  universe: ObjectUniverse,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const rolePlayer = rolePlayerMap(model);

  for (const c of model.constraints) {
    if (!isExclusiveOr(c)) continue;

    const playerId = c.roleIds
      .map((rid) => rolePlayer.get(rid))
      .find((p) => p !== undefined);
    if (playerId === undefined) continue;
    const required = universe.get(playerId) ?? new Set<string>();

    const valuesByRole = c.roleIds.map((rid) => valuesPlayedInRole(model, rid));
    const candidates = new Set<string>(required);
    for (const set of valuesByRole) for (const value of set) candidates.add(value);
    for (const value of candidates) {
      const count = valuesByRole.filter((set) => set.has(value)).length;
      if (count > 1 || (count === 0 && required.has(value))) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.exclusiveOrViolation,
            "default",
            constraintElementId(c),
            c.roleIds.join(", "),
            value,
            count,
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * Subset constraints whose roles span fact types: every tuple in the subset
 * role sequence must appear in the superset role sequence.
 */
export function checkSpanningSubsetViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isSubset(c)) continue;
    if (localFactTypeOf(model, c)) continue; // checked by the local rule

    const subsetTuples = tuplesForRoleSeq(model, c.subsetRoleIds);
    const supersetTuples = tuplesForRoleSeq(model, c.supersetRoleIds);
    for (const tuple of subsetTuples) {
      if (!supersetTuples.has(tuple)) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.subsetViolation,
            "local",
            constraintElementId(c),
            tuple,
            c.subsetRoleIds.join(", "),
            c.supersetRoleIds.join(", "),
          ),
        );
      }
    }
  }
  return diagnostics;
}

/**
 * Equality constraints whose roles span fact types: the tuple sets of both
 * role sequences must be identical.
 */
export function checkSpanningEqualityViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isEquality(c)) continue;
    if (localFactTypeOf(model, c)) continue; // checked by the local rule

    const tuples1 = tuplesForRoleSeq(model, c.roleIds1);
    const tuples2 = tuplesForRoleSeq(model, c.roleIds2);
    for (const tuple of tuples1) {
      if (!tuples2.has(tuple)) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.equalityViolation,
            "local",
            constraintElementId(c),
            tuple,
            c.roleIds1.join(", "),
            c.roleIds2.join(", "),
          ),
        );
      }
    }
    for (const tuple of tuples2) {
      if (!tuples1.has(tuple)) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.equalityViolation,
            "localReverse",
            constraintElementId(c),
            tuple,
            c.roleIds2.join(", "),
            c.roleIds1.join(", "),
          ),
        );
      }
    }
  }
  return diagnostics;
}
