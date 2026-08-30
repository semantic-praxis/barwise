import type { Constraint } from "../../../model/Constraint.js";
import { isDisjunctiveMandatory, isMandatoryRole } from "../../../model/Constraint.js";
import type { FactType } from "../../../model/FactType.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { buildObjectUniverse, severityForModality, valuesPlayedInRole } from "./shared.js";

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
      diagnostics.push(...mandatoryViolationsIn(model, ft, c, universe));
    }
  }
  return diagnostics;
}

/**
 * One mandatory constraint, given the model-wide object universe. Shared by
 * the sweep above and the per-constraint entry below so the two cannot
 * answer differently (barwise-904).
 */
function mandatoryViolationsIn(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
  universe: ReturnType<typeof buildObjectUniverse>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isMandatoryRole(c)) return diagnostics;
  const role = ft.getRoleById(c.roleId);
  if (!role) return diagnostics;
  const required = universe.get(role.playerId);
  if (!required || required.size === 0) return diagnostics;

  const played = valuesPlayedInRole(model, c.roleId);
  for (const value of required) {
    if (!played.has(value)) {
      diagnostics.push({
        severity: severityForModality(c),
        message: `Mandatory constraint on role "${c.roleId}" in fact type `
          + `"${ft.name}" is violated: "${value}" appears in the model but `
          + `does not play this mandatory role.`,
        elementId: c.id ?? ft.id,
        ruleId: "population/mandatory-violation",
      });
    }
  }
  return diagnostics;
}

/** Does this one mandatory constraint reject the model's population? */
export function mandatoryViolationsFor(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
): Diagnostic[] {
  const universe = buildObjectUniverse(model);
  if (universe.size === 0) return [];
  return mandatoryViolationsIn(model, ft, c, universe);
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
      diagnostics.push(
        ...disjunctiveMandatoryViolationsIn(model, ft, c, universe, rolePlayer),
      );
    }
  }
  return diagnostics;
}

/** One disjunctive mandatory constraint, given the model-wide context it
 * needs. Shared by the sweep and the per-constraint entry (barwise-904). */
function disjunctiveMandatoryViolationsIn(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
  universe: ReturnType<typeof buildObjectUniverse>,
  rolePlayer: Map<string, string>,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!isDisjunctiveMandatory(c)) return diagnostics;
  const playerId = c.roleIds
    .map((rid) => rolePlayer.get(rid))
    .find((p) => p !== undefined);
  if (playerId === undefined) return diagnostics;
  const required = universe.get(playerId);
  if (!required || required.size === 0) return diagnostics;

  const playedSomewhere = new Set<string>();
  for (const rid of c.roleIds) {
    for (const value of valuesPlayedInRole(model, rid)) {
      playedSomewhere.add(value);
    }
  }

  for (const value of required) {
    if (!playedSomewhere.has(value)) {
      diagnostics.push({
        severity: severityForModality(c),
        message: `Disjunctive mandatory constraint on roles `
          + `[${c.roleIds.join(", ")}] is violated: "${value}" plays none `
          + `of them.`,
        elementId: c.id ?? ft.id,
        ruleId: "population/disjunctive-mandatory-violation",
      });
    }
  }
  return diagnostics;
}

/**
 * Does this one disjunctive mandatory constraint reject the model's
 * population? Its roles may span fact types, so `ft` is where the
 * constraint is declared, not the whole of what it covers.
 */
export function disjunctiveMandatoryViolationsFor(
  model: OrmModel,
  ft: FactType,
  c: Constraint,
): Diagnostic[] {
  const universe = buildObjectUniverse(model);
  if (universe.size === 0) return [];
  const rolePlayer = new Map<string, string>();
  for (const f of model.factTypes) {
    for (const role of f.roles) rolePlayer.set(role.id, role.playerId);
  }
  return disjunctiveMandatoryViolationsIn(model, ft, c, universe, rolePlayer);
}
