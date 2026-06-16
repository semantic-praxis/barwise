import { isDisjunctiveMandatory, isMandatoryRole } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { buildObjectUniverse, valuesPlayedInRole } from "./shared.js";

/**
 * Mandatory constraints require every instance of the role's player type
 * to play that role. An instance "exists" if it appears in any role across
 * the model's populations (the object universe).
 */
export function checkMandatoryViolations(model: OrmModel): Diagnostic[] {
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
export function checkDisjunctiveMandatoryViolations(model: OrmModel): Diagnostic[] {
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
