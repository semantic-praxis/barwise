import { isEquality, isExclusion, isExclusiveOr, isSubset } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { reportAs, RULE_ID } from "../../ruleId.js";
import { makeCompositeKey, severityForModality } from "./shared.js";

/**
 * Exclusion constraints forbid an object from playing more than one of the
 * constrained roles. For each instance, collect values for the constrained
 * roles and check that each distinct object value appears in at most one role.
 *
 * Only validates when all constrained roles belong to the same fact type.
 */
export function checkExclusionViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const exclusionConstraints = ft.constraints.filter(isExclusion);
    for (const ec of exclusionConstraints) {
      // Skip cross-fact-type constraints (roles not in this fact type).
      const localRoleIds = ec.roleIds.filter((rid) => ft.hasRole(rid));
      if (localRoleIds.length !== ec.roleIds.length) continue;

      for (const inst of pop.instances) {
        const valuesInRoles = new Map<string, string[]>(); // value -> role ids
        for (const rid of localRoleIds) {
          const val = inst.roleValues[rid];
          if (val !== undefined) {
            const roles = valuesInRoles.get(val);
            if (roles) {
              roles.push(rid);
            } else {
              valuesInRoles.set(val, [rid]);
            }
          }
        }

        for (const [val, roles] of valuesInRoles) {
          if (roles.length > 1) {
            diagnostics.push(
              reportAs(
                severityForModality(ec),
                RULE_ID.exclusionViolation,
                "spanning",
                pop.id,
                pop.id,
                inst.id,
                val,
                roles.join(", "),
              ),
            );
          }
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Exclusive-or constraints require each object to play exactly one of the
 * constrained roles. This combines disjunctive mandatory (at least one) with
 * exclusion (at most one).
 *
 * Only validates when all constrained roles belong to the same fact type.
 */
export function checkExclusiveOrViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const xorConstraints = ft.constraints.filter(isExclusiveOr);
    for (const xor of xorConstraints) {
      const localRoleIds = xor.roleIds.filter((rid) => ft.hasRole(rid));
      if (localRoleIds.length !== xor.roleIds.length) continue;

      for (const inst of pop.instances) {
        const playedRoles: string[] = [];
        for (const rid of localRoleIds) {
          if (inst.roleValues[rid] !== undefined) {
            playedRoles.push(rid);
          }
        }

        if (playedRoles.length === 0) {
          diagnostics.push(
            reportAs(
              severityForModality(xor),
              RULE_ID.exclusiveOrViolation,
              "spanning",
              pop.id,
              pop.id,
              inst.id,
              localRoleIds.join(", "),
            ),
          );
        } else if (playedRoles.length > 1) {
          diagnostics.push(
            reportAs(
              severityForModality(xor),
              RULE_ID.exclusiveOrViolation,
              "localNone",
              pop.id,
              pop.id,
              inst.id,
              playedRoles.length,
              playedRoles.join(", "),
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Subset constraints require every tuple extracted from the subset role
 * sequence to also appear in the superset role sequence.
 *
 * Only validates when all roles belong to the same fact type.
 */
export function checkSubsetViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const subsetConstraints = ft.constraints.filter(isSubset);
    for (const sc of subsetConstraints) {
      const allLocal = sc.subsetRoleIds.every((rid) => ft.hasRole(rid))
        && sc.supersetRoleIds.every((rid) => ft.hasRole(rid));
      if (!allLocal) continue;

      // Collect superset tuples.
      const supersetTuples = new Set<string>();
      for (const inst of pop.instances) {
        supersetTuples.add(makeCompositeKey(inst, sc.supersetRoleIds));
      }

      // Check each subset tuple exists in the superset.
      for (const inst of pop.instances) {
        const subsetKey = makeCompositeKey(inst, sc.subsetRoleIds);
        if (!supersetTuples.has(subsetKey)) {
          diagnostics.push(
            reportAs(
              severityForModality(sc),
              RULE_ID.subsetViolation,
              "spanning",
              pop.id,
              pop.id,
              inst.id,
              subsetKey,
              sc.subsetRoleIds.join(", "),
              sc.supersetRoleIds.join(", "),
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Equality constraints require the tuple sets from both role sequences to
 * be identical. This is equivalent to subset in both directions.
 *
 * Only validates when all roles belong to the same fact type.
 */
export function checkEqualityViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const equalityConstraints = ft.constraints.filter(isEquality);
    for (const eq of equalityConstraints) {
      const allLocal = eq.roleIds1.every((rid) => ft.hasRole(rid))
        && eq.roleIds2.every((rid) => ft.hasRole(rid));
      if (!allLocal) continue;

      // Collect both tuple sets.
      const tuples1 = new Set<string>();
      const tuples2 = new Set<string>();
      for (const inst of pop.instances) {
        tuples1.add(makeCompositeKey(inst, eq.roleIds1));
        tuples2.add(makeCompositeKey(inst, eq.roleIds2));
      }

      // Check direction 1: every tuple in set 1 must be in set 2.
      for (const inst of pop.instances) {
        const key1 = makeCompositeKey(inst, eq.roleIds1);
        if (!tuples2.has(key1)) {
          diagnostics.push(
            reportAs(
              severityForModality(eq),
              RULE_ID.equalityViolation,
              "spanning",
              pop.id,
              pop.id,
              inst.id,
              key1,
              eq.roleIds1.join(", "),
              eq.roleIds2.join(", "),
            ),
          );
        }
      }

      // Check direction 2: every tuple in set 2 must be in set 1.
      for (const inst of pop.instances) {
        const key2 = makeCompositeKey(inst, eq.roleIds2);
        if (!tuples1.has(key2)) {
          diagnostics.push(
            reportAs(
              severityForModality(eq),
              RULE_ID.equalityViolation,
              "spanningReverse",
              pop.id,
              pop.id,
              inst.id,
              key2,
              eq.roleIds2.join(", "),
              eq.roleIds1.join(", "),
            ),
          );
        }
      }
    }
  }

  return diagnostics;
}
