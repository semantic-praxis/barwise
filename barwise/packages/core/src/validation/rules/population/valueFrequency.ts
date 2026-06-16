import { isFrequency, isValueConstraint } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";

/**
 * Value constraints restrict what values a role may hold.
 * Each instance value for the constrained role must be in the allowed set.
 */
export function checkValueConstraintViolations(model: OrmModel): Diagnostic[] {
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
export function checkFrequencyViolations(model: OrmModel): Diagnostic[] {
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
