import { isFrequency, isValueConstraint, type ValueRange } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { severityForModality } from "./shared.js";

/** Whether a string parses as a finite number. */
function isFiniteNumber(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}

/**
 * Whether a value falls within a range. Compares numerically when the value
 * and both present bounds parse as numbers, otherwise lexically. A missing
 * bound is open-ended; bounds are inclusive unless flagged otherwise.
 */
function valueInRange(val: string, r: ValueRange): boolean {
  const minIncl = r.minInclusive !== false;
  const maxIncl = r.maxInclusive !== false;
  const numeric = isFiniteNumber(val)
    && (r.min === undefined || isFiniteNumber(r.min))
    && (r.max === undefined || isFiniteNumber(r.max));

  if (numeric) {
    const v = Number(val);
    if (r.min !== undefined && (minIncl ? v < Number(r.min) : v <= Number(r.min))) return false;
    if (r.max !== undefined && (maxIncl ? v > Number(r.max) : v >= Number(r.max))) return false;
    return true;
  }
  if (r.min !== undefined && (minIncl ? val < r.min : val <= r.min)) return false;
  if (r.max !== undefined && (maxIncl ? val > r.max : val >= r.max)) return false;
  return true;
}

/**
 * Value constraints restrict what values a role may hold.
 * Each instance value for the constrained role must be an enumerated value
 * or fall within one of the allowed ranges.
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
      const ranges = vc.ranges ?? [];

      for (const inst of pop.instances) {
        const val = inst.roleValues[vc.roleId];
        if (val === undefined) continue;
        const allowed = allowedSet.has(val) || ranges.some((r) => valueInRange(val, r));
        if (!allowed) {
          const rangeNote = ranges.length > 0 ? " (or any permitted range)" : "";
          diagnostics.push({
            severity: severityForModality(vc),
            message: `Population "${pop.id}": instance "${inst.id}" has value `
              + `"${val}" for role "${vc.roleId}" which is not in the `
              + `allowed set [${vc.values.join(", ")}]${rangeNote}.`,
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
            severity: severityForModality(fc),
            message: `Population "${pop.id}": value "${val}" in role "${fc.roleId}" `
              + `appears ${count} time(s) but the minimum is ${fc.min}.`,
            elementId: pop.id,
            ruleId: "population/frequency-violation",
          });
        }
        if (fc.max !== "unbounded" && count > fc.max) {
          diagnostics.push({
            severity: severityForModality(fc),
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
