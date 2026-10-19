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
 * Exclusion constraints whose roles span fact types: no object value may
 * appear in more than one of the excluded roles. (The local case -- all
 * roles in one fact type -- is handled by checkExclusionViolations.)
 */
export function checkSpanningExclusionViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const c of model.constraints) {
    if (!isExclusion(c)) continue;
    if (localFactTypeOf(model, c)) continue; // checked by the local rule

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
            "local",
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
 * Exclusive-or constraints whose roles span fact types: every instance of
 * the common player type must play exactly one of the roles.
 */
export function checkSpanningExclusiveOrViolations(
  model: OrmModel,
  universe: ObjectUniverse,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (universe.size === 0) return diagnostics;
  const rolePlayer = rolePlayerMap(model);

  for (const c of model.constraints) {
    if (!isExclusiveOr(c)) continue;
    if (localFactTypeOf(model, c)) continue; // checked by the local rule

    const playerId = c.roleIds
      .map((rid) => rolePlayer.get(rid))
      .find((p) => p !== undefined);
    if (playerId === undefined) continue;
    const required = universe.get(playerId);
    if (!required || required.size === 0) continue;

    const valuesByRole = c.roleIds.map((rid) => valuesPlayedInRole(model, rid));
    for (const value of required) {
      const count = valuesByRole.filter((set) => set.has(value)).length;
      if (count !== 1) {
        diagnostics.push(
          reportAs(
            severityForModality(c),
            RULE_ID.exclusiveOrViolation,
            "localMultiple",
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
