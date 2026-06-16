import {
  isDisjunctiveMandatory,
  isEquality,
  isExclusion,
  isExclusiveOr,
  isFrequency,
  isInternalUniqueness,
  isMandatoryRole,
  isRing,
  isSubset,
  isValueConstraint,
} from "../../model/Constraint.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { FactInstance } from "../../model/Population.js";
import type { Diagnostic } from "../Diagnostic.js";

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
 * types are checked too. External uniqueness remains unvalidated (its
 * cross-fact-type instance-join is a future enhancement).
 */
export function populationValidationRules(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  diagnostics.push(...checkDanglingPopulationFactType(model));
  diagnostics.push(...checkUniquenessViolations(model));
  diagnostics.push(...checkValueConstraintViolations(model));
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

  return diagnostics;
}

/**
 * The universe of an object type: every distinct value that appears in any
 * role played by that type across all of the model's populations. This is
 * the closed-world set of "instances that exist" for cross-fact-type
 * mandatory checks.
 */
function buildObjectUniverse(model: OrmModel): Map<string, Set<string>> {
  const universe = new Map<string, Set<string>>();
  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;
    for (const inst of pop.instances) {
      for (const role of ft.roles) {
        const value = inst.roleValues[role.id];
        if (value === undefined) continue;
        let values = universe.get(role.playerId);
        if (!values) {
          values = new Set();
          universe.set(role.playerId, values);
        }
        values.add(value);
      }
    }
  }
  return universe;
}

/** The set of values appearing in a given role across all populations. */
function valuesPlayedInRole(model: OrmModel, roleId: string): Set<string> {
  const values = new Set<string>();
  for (const pop of model.populations) {
    for (const inst of pop.instances) {
      const value = inst.roleValues[roleId];
      if (value !== undefined) values.add(value);
    }
  }
  return values;
}

/**
 * Mandatory constraints require every instance of the role's player type
 * to play that role. An instance "exists" if it appears in any role across
 * the model's populations (the object universe).
 */
function checkMandatoryViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const universe = buildObjectUniverse(model);
  if (universe.size === 0) return diagnostics;

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isMandatoryRole(c)) continue;
      const role = ft.getRoleById(c.roleId);
      if (!role) continue;
      const required = universe.get(role.playerId);
      if (!required || required.size === 0) continue;

      const played = valuesPlayedInRole(model, c.roleId);
      for (const value of required) {
        if (!played.has(value)) {
          diagnostics.push({
            severity: "error",
            message: `Mandatory constraint on role "${c.roleId}" in fact type `
              + `"${ft.name}" is violated: "${value}" appears in the model but `
              + `does not play this mandatory role.`,
            elementId: c.id ?? ft.id,
            ruleId: "population/mandatory-violation",
          });
        }
      }
    }
  }
  return diagnostics;
}

/**
 * Disjunctive mandatory constraints require every instance of the common
 * player type to play at least one of the specified roles (which may span
 * fact types).
 */
function checkDisjunctiveMandatoryViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const universe = buildObjectUniverse(model);
  if (universe.size === 0) return diagnostics;

  const rolePlayer = new Map<string, string>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      rolePlayer.set(role.id, role.playerId);
    }
  }

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isDisjunctiveMandatory(c)) continue;
      const playerId = c.roleIds
        .map((rid) => rolePlayer.get(rid))
        .find((p) => p !== undefined);
      if (playerId === undefined) continue;
      const required = universe.get(playerId);
      if (!required || required.size === 0) continue;

      const playedSomewhere = new Set<string>();
      for (const rid of c.roleIds) {
        for (const value of valuesPlayedInRole(model, rid)) {
          playedSomewhere.add(value);
        }
      }

      for (const value of required) {
        if (!playedSomewhere.has(value)) {
          diagnostics.push({
            severity: "error",
            message: `Disjunctive mandatory constraint on roles `
              + `[${c.roleIds.join(", ")}] is violated: "${value}" plays none `
              + `of them.`,
            elementId: c.id ?? ft.id,
            ruleId: "population/disjunctive-mandatory-violation",
          });
        }
      }
    }
  }
  return diagnostics;
}

/**
 * Every population must reference a fact type that exists in the model.
 */
function checkDanglingPopulationFactType(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    if (!model.getFactType(pop.factTypeId)) {
      diagnostics.push({
        severity: "error",
        message: `Population "${pop.id}" references fact type id "${pop.factTypeId}" `
          + `which does not exist in the model.`,
        elementId: pop.id,
        ruleId: "population/dangling-fact-type",
      });
    }
  }

  return diagnostics;
}

/**
 * Internal uniqueness constraints require that the combination of values
 * for the specified roles is unique across all instances in the population.
 */
function checkUniquenessViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const uniquenessConstraints = ft.constraints.filter(isInternalUniqueness);
    for (const uc of uniquenessConstraints) {
      const seen = new Map<string, string>(); // composite key -> first instance id

      for (const inst of pop.instances) {
        const key = makeCompositeKey(inst, uc.roleIds);
        const firstId = seen.get(key);
        if (firstId) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" violates `
              + `internal uniqueness constraint on role(s) [${uc.roleIds.join(", ")}]. `
              + `Duplicate of instance "${firstId}".`,
            elementId: pop.id,
            ruleId: "population/uniqueness-violation",
          });
        } else {
          seen.set(key, inst.id);
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Value constraints restrict what values a role may hold.
 * Each instance value for the constrained role must be in the allowed set.
 */
function checkValueConstraintViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const valueConstraints = ft.constraints.filter(isValueConstraint);
    for (const vc of valueConstraints) {
      if (!vc.roleId) continue; // Type-level value constraints (no specific role)
      const allowedSet = new Set(vc.values);

      for (const inst of pop.instances) {
        const val = inst.roleValues[vc.roleId];
        if (val !== undefined && !allowedSet.has(val)) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" has value `
              + `"${val}" for role "${vc.roleId}" which is not in the `
              + `allowed set [${vc.values.join(", ")}].`,
            elementId: pop.id,
            ruleId: "population/value-constraint-violation",
          });
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Frequency constraints restrict how many times an object may play a role.
 * For each distinct value in the constrained role, count how many instances
 * have that value and check against the min/max bounds.
 */
function checkFrequencyViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const frequencyConstraints = ft.constraints.filter(isFrequency);
    for (const fc of frequencyConstraints) {
      // Count occurrences of each distinct value in the constrained role.
      const counts = new Map<string, number>();
      for (const inst of pop.instances) {
        const val = inst.roleValues[fc.roleId];
        if (val !== undefined) {
          counts.set(val, (counts.get(val) ?? 0) + 1);
        }
      }

      for (const [val, count] of counts) {
        if (count < fc.min) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": value "${val}" in role "${fc.roleId}" `
              + `appears ${count} time(s) but the minimum is ${fc.min}.`,
            elementId: pop.id,
            ruleId: "population/frequency-violation",
          });
        }
        if (fc.max !== "unbounded" && count > fc.max) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": value "${val}" in role "${fc.roleId}" `
              + `appears ${count} time(s) but the maximum is ${fc.max}.`,
            elementId: pop.id,
            ruleId: "population/frequency-violation",
          });
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Exclusion constraints forbid an object from playing more than one of the
 * constrained roles. For each instance, collect values for the constrained
 * roles and check that each distinct object value appears in at most one role.
 *
 * Only validates when all constrained roles belong to the same fact type.
 */
function checkExclusionViolations(model: OrmModel): Diagnostic[] {
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
            diagnostics.push({
              severity: "error",
              message: `Population "${pop.id}": instance "${inst.id}" has value `
                + `"${val}" in multiple excluded roles [${roles.join(", ")}].`,
              elementId: pop.id,
              ruleId: "population/exclusion-violation",
            });
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
function checkExclusiveOrViolations(model: OrmModel): Diagnostic[] {
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
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" does not play `
              + `any of the exclusive-or roles [${localRoleIds.join(", ")}].`,
            elementId: pop.id,
            ruleId: "population/exclusive-or-violation",
          });
        } else if (playedRoles.length > 1) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" plays `
              + `${playedRoles.length} of the exclusive-or roles `
              + `[${playedRoles.join(", ")}] but must play exactly one.`,
            elementId: pop.id,
            ruleId: "population/exclusive-or-violation",
          });
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
function checkSubsetViolations(model: OrmModel): Diagnostic[] {
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
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" has subset `
              + `tuple [${subsetKey}] for roles [${sc.subsetRoleIds.join(", ")}] `
              + `with no matching superset tuple in roles `
              + `[${sc.supersetRoleIds.join(", ")}].`,
            elementId: pop.id,
            ruleId: "population/subset-violation",
          });
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
function checkEqualityViolations(model: OrmModel): Diagnostic[] {
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
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" has tuple `
              + `[${key1}] in roles [${eq.roleIds1.join(", ")}] with no `
              + `matching tuple in roles [${eq.roleIds2.join(", ")}].`,
            elementId: pop.id,
            ruleId: "population/equality-violation",
          });
        }
      }

      // Check direction 2: every tuple in set 2 must be in set 1.
      for (const inst of pop.instances) {
        const key2 = makeCompositeKey(inst, eq.roleIds2);
        if (!tuples1.has(key2)) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" has tuple `
              + `[${key2}] in roles [${eq.roleIds2.join(", ")}] with no `
              + `matching tuple in roles [${eq.roleIds1.join(", ")}].`,
            elementId: pop.id,
            ruleId: "population/equality-violation",
          });
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Ring constraints apply to reflexive relationships (a fact type where both
 * roles are played by the same object type). They enforce properties on the
 * directed pairs (roleId1 -> roleId2) in the population.
 *
 * Ring types and their semantics:
 *
 * - irreflexive: No self-loops. (a, a) is forbidden.
 *     Example: "No Person is a parent of that same Person."
 *
 * - asymmetric: If (a, b) then NOT (b, a). Implies irreflexive.
 *     Example: "If Person1 is parent of Person2, then Person2 is not
 *     parent of Person1."
 *
 * - antisymmetric: If (a, b) AND (b, a) then a = b.
 *     Example: "If Person1 manages Person2 and Person2 manages Person1,
 *     then they are the same Person."
 *
 * - symmetric: If (a, b) then (b, a) must also exist.
 *     Example: "If Person1 is sibling of Person2, then Person2 is
 *     sibling of Person1."
 *
 * - intransitive: If (a, b) AND (b, c) then NOT (a, c).
 *     Example: "If Person1 is parent of Person2 and Person2 is parent
 *     of Person3, then Person1 is not parent of Person3."
 *
 * - transitive: If (a, b) AND (b, c) then (a, c) must exist.
 *     Example: "If Person1 is ancestor of Person2 and Person2 is
 *     ancestor of Person3, then Person1 is ancestor of Person3."
 *
 * - acyclic: No directed cycles of any length. (a -> b -> ... -> a) is
 *     forbidden.
 *     Example: "No Person can be their own ancestor through any chain
 *     of parent relationships."
 *
 * - purely_reflexive: Only self-loops allowed. If (a, b) then a = b.
 *     Example: "A Person can only be compared to themselves."
 */
function checkRingViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const ringConstraints = ft.constraints.filter(isRing);
    for (const rc of ringConstraints) {
      if (!ft.hasRole(rc.roleId1) || !ft.hasRole(rc.roleId2)) continue;

      // Build the set of directed pairs.
      const pairs: Array<[string, string]> = [];
      const pairSet = new Set<string>();
      for (const inst of pop.instances) {
        const a = inst.roleValues[rc.roleId1];
        const b = inst.roleValues[rc.roleId2];
        if (a !== undefined && b !== undefined) {
          pairs.push([a, b]);
          pairSet.add(`${a}\0${b}`);
        }
      }

      switch (rc.ringType) {
        case "irreflexive":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && a === b) {
              diagnostics.push({
                severity: "error",
                message: `Population "${pop.id}": instance "${inst.id}" violates `
                  + `irreflexive ring constraint -- "${a}" appears in both roles.`,
                elementId: pop.id,
                ruleId: "population/ring-violation",
              });
            }
          }
          break;

        case "asymmetric":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined) {
              if (a === b) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": instance "${inst.id}" violates `
                    + `asymmetric ring constraint -- "${a}" appears in both `
                    + `roles (asymmetric implies irreflexive).`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              } else if (pairSet.has(`${b}\0${a}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": instance "${inst.id}" violates `
                    + `asymmetric ring constraint -- both (${a}, ${b}) and `
                    + `(${b}, ${a}) exist.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "antisymmetric":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined && a !== b) {
              if (pairSet.has(`${b}\0${a}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": instance "${inst.id}" violates `
                    + `antisymmetric ring constraint -- both (${a}, ${b}) and `
                    + `(${b}, ${a}) exist but ${a} != ${b}.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "symmetric":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined && !pairSet.has(`${b}\0${a}`)) {
              diagnostics.push({
                severity: "error",
                message: `Population "${pop.id}": instance "${inst.id}" violates `
                  + `symmetric ring constraint -- (${a}, ${b}) exists but `
                  + `(${b}, ${a}) does not.`,
                elementId: pop.id,
                ruleId: "population/ring-violation",
              });
            }
          }
          break;

        case "intransitive":
          for (const [a, b] of pairs) {
            // Find all (b, c) pairs and check (a, c) does not exist.
            for (const [b2, c] of pairs) {
              if (b === b2 && pairSet.has(`${a}\0${c}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": intransitive ring constraint `
                    + `violated -- (${a}, ${b}) and (${b}, ${c}) exist, `
                    + `but (${a}, ${c}) also exists.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "transitive":
          for (const [a, b] of pairs) {
            for (const [b2, c] of pairs) {
              if (b === b2 && !pairSet.has(`${a}\0${c}`)) {
                diagnostics.push({
                  severity: "error",
                  message: `Population "${pop.id}": transitive ring constraint `
                    + `violated -- (${a}, ${b}) and (${b}, ${c}) exist, `
                    + `but (${a}, ${c}) does not.`,
                  elementId: pop.id,
                  ruleId: "population/ring-violation",
                });
              }
            }
          }
          break;

        case "acyclic":
          diagnostics.push(...checkAcyclic(pairs, pop.id));
          break;

        case "purely_reflexive":
          for (const inst of pop.instances) {
            const a = inst.roleValues[rc.roleId1];
            const b = inst.roleValues[rc.roleId2];
            if (a !== undefined && b !== undefined && a !== b) {
              diagnostics.push({
                severity: "error",
                message: `Population "${pop.id}": instance "${inst.id}" violates `
                  + `purely reflexive ring constraint -- (${a}, ${b}) exists `
                  + `but only self-loops (a, a) are allowed.`,
                elementId: pop.id,
                ruleId: "population/ring-violation",
              });
            }
          }
          break;
      }
    }
  }

  return diagnostics;
}

/**
 * Check for cycles in a directed graph represented as edge pairs.
 * Uses DFS with coloring (white/gray/black) for cycle detection.
 */
function checkAcyclic(
  pairs: Array<[string, string]>,
  popId: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  // Build adjacency list.
  const adj = new Map<string, string[]>();
  for (const [a, b] of pairs) {
    const neighbors = adj.get(a);
    if (neighbors) {
      neighbors.push(b);
    } else {
      adj.set(a, [b]);
    }
  }

  // DFS with 3 states: 0 = unvisited, 1 = in progress, 2 = done.
  const state = new Map<string, number>();
  let cycleFound = false;

  function dfs(node: string): void {
    if (cycleFound) return;
    state.set(node, 1); // in progress
    for (const neighbor of adj.get(node) ?? []) {
      const s = state.get(neighbor) ?? 0;
      if (s === 1) {
        // Back edge: cycle detected.
        cycleFound = true;
        diagnostics.push({
          severity: "error",
          message: `Population "${popId}": acyclic ring constraint violated -- `
            + `cycle detected involving "${node}" and "${neighbor}".`,
          elementId: popId,
          ruleId: "population/ring-violation",
        });
        return;
      }
      if (s === 0) {
        dfs(neighbor);
      }
    }
    state.set(node, 2); // done
  }

  for (const node of adj.keys()) {
    if ((state.get(node) ?? 0) === 0) {
      dfs(node);
      if (cycleFound) break;
    }
  }

  return diagnostics;
}

/** Build a model-wide map of role id to the id of the type that plays it. */
function rolePlayerMap(model: OrmModel): Map<string, string> {
  const map = new Map<string, string>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      map.set(role.id, role.playerId);
    }
  }
  return map;
}

/** All composite-key tuples for a role sequence across all populations. */
function tuplesForRoleSeq(model: OrmModel, roleIds: readonly string[]): Set<string> {
  const tuples = new Set<string>();
  for (const pop of model.populations) {
    for (const inst of pop.instances) {
      if (roleIds.every((rid) => inst.roleValues[rid] !== undefined)) {
        tuples.add(makeCompositeKey(inst, roleIds));
      }
    }
  }
  return tuples;
}

/**
 * Exclusion constraints whose roles span fact types: no object value may
 * appear in more than one of the excluded roles. (The local case -- all
 * roles in one fact type -- is handled by checkExclusionViolations.)
 */
function checkSpanningExclusionViolations(model: OrmModel): Diagnostic[] {
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
            severity: "error",
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
function checkSpanningExclusiveOrViolations(model: OrmModel): Diagnostic[] {
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
            severity: "error",
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
function checkSpanningSubsetViolations(model: OrmModel): Diagnostic[] {
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
            severity: "error",
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
function checkSpanningEqualityViolations(model: OrmModel): Diagnostic[] {
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
            severity: "error",
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
            severity: "error",
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a composite key from an instance's values for the given role ids.
 * Used for uniqueness checking.
 */
function makeCompositeKey(
  inst: FactInstance,
  roleIds: readonly string[],
): string {
  return roleIds.map((rid) => inst.roleValues[rid] ?? "").join("\0");
}
