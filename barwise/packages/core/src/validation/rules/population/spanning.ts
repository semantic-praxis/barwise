import { isEquality, isExclusion, isExclusiveOr, isSubset } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import {
  buildObjectUniverse,
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
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isExclusion(c)) continue;
      if (c.roleIds.every((rid) => ft.hasRole(rid))) continue; // local

      const valuesByRole = c.roleIds.map((rid) => valuesPlayedInRole(model, rid));
      const all = new Set<string>();
      for (const set of valuesByRole) {
        for (const value of set) all.add(value);
      }
      for (const value of all) {
        const count = valuesByRole.filter((set) => set.has(value)).length;
        if (count > 1) {
          diagnostics.push({
            severity: severityForModality(c),
            message: `Exclusion constraint on roles [${c.roleIds.join(", ")}] is `
              + `violated: "${value}" plays ${count} of the excluded roles.`,
            elementId: c.id ?? ft.id,
            ruleId: "population/exclusion-violation",
          });
        }
      }
    }
  }
  return diagnostics;
}

/**
 * Exclusive-or constraints whose roles span fact types: every instance of
 * the common player type must play exactly one of the roles.
 */
export function checkSpanningExclusiveOrViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const universe = buildObjectUniverse(model);
  if (universe.size === 0) return diagnostics;
  const rolePlayer = rolePlayerMap(model);

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isExclusiveOr(c)) continue;
      if (c.roleIds.every((rid) => ft.hasRole(rid))) continue; // local

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
          diagnostics.push({
            severity: severityForModality(c),
            message: `Exclusive-or constraint on roles [${c.roleIds.join(", ")}] `
              + `is violated: "${value}" plays ${count} of them (must be exactly one).`,
            elementId: c.id ?? ft.id,
            ruleId: "population/exclusive-or-violation",
          });
        }
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
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isSubset(c)) continue;
      const allLocal = c.subsetRoleIds.every((rid) => ft.hasRole(rid))
        && c.supersetRoleIds.every((rid) => ft.hasRole(rid));
      if (allLocal) continue;

      const subsetTuples = tuplesForRoleSeq(model, c.subsetRoleIds);
      const supersetTuples = tuplesForRoleSeq(model, c.supersetRoleIds);
      for (const tuple of subsetTuples) {
        if (!supersetTuples.has(tuple)) {
          diagnostics.push({
            severity: severityForModality(c),
            message: `Subset constraint is violated: tuple [${tuple}] in roles `
              + `[${c.subsetRoleIds.join(", ")}] has no match in roles `
              + `[${c.supersetRoleIds.join(", ")}].`,
            elementId: c.id ?? ft.id,
            ruleId: "population/subset-violation",
          });
        }
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
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isEquality(c)) continue;
      const allLocal = c.roleIds1.every((rid) => ft.hasRole(rid))
        && c.roleIds2.every((rid) => ft.hasRole(rid));
      if (allLocal) continue;

      const tuples1 = tuplesForRoleSeq(model, c.roleIds1);
      const tuples2 = tuplesForRoleSeq(model, c.roleIds2);
      for (const tuple of tuples1) {
        if (!tuples2.has(tuple)) {
          diagnostics.push({
            severity: severityForModality(c),
            message: `Equality constraint is violated: tuple [${tuple}] in roles `
              + `[${c.roleIds1.join(", ")}] has no match in roles `
              + `[${c.roleIds2.join(", ")}].`,
            elementId: c.id ?? ft.id,
            ruleId: "population/equality-violation",
          });
        }
      }
      for (const tuple of tuples2) {
        if (!tuples1.has(tuple)) {
          diagnostics.push({
            severity: severityForModality(c),
            message: `Equality constraint is violated: tuple [${tuple}] in roles `
              + `[${c.roleIds2.join(", ")}] has no match in roles `
              + `[${c.roleIds1.join(", ")}].`,
            elementId: c.id ?? ft.id,
            ruleId: "population/equality-violation",
          });
        }
      }
    }
  }
  return diagnostics;
}
