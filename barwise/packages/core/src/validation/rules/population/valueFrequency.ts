import type { FrequencyConstraint, ValueConstraint } from "../../../model/Constraint.js";
import { isFrequency, isValueConstraint, type ValueRange } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Population } from "../../../model/Population.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { makeCompositeKey, severityForModality } from "./shared.js";

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
      diagnostics.push(...valueConstraintViolationsIn(pop, vc));
    }
  }

  return diagnostics;
}

/** One valueConstraint constraint against ONE population; shared so the model-wide
 * sweep and the per-constraint entry cannot answer differently (barwise-904). */
function valueConstraintViolationsIn(pop: Population, vc: ValueConstraint): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!vc.roleId) return diagnostics; // Type-level value constraints (no specific role)
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
  return diagnostics;
}

/** Does this one valueConstraint constraint reject the model's population? */
export function valueConstraintViolationsFor(
  model: OrmModel,
  factTypeId: string,
  vc: ValueConstraint,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const pop of model.populations) {
    if (pop.factTypeId !== factTypeId) continue;
    diagnostics.push(...valueConstraintViolationsIn(pop, vc));
  }
  return diagnostics;
}

/**
 * Frequency constraints restrict how many times a value (single role) or
 * value combination (a role sequence) occurs in the population. For each
 * distinct value-tuple across the constrained roles, count the instances
 * carrying it and check against the min/max bounds. A length-1 sequence is
 * the single-role case, with its original message preserved.
 */
export function checkFrequencyViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const frequencyConstraints = ft.constraints.filter(isFrequency);
    for (const fc of frequencyConstraints) {
      diagnostics.push(...frequencyViolationsIn(pop, fc));
    }
  }

  return diagnostics;
}

/** One frequency constraint against ONE population; shared so the model-wide
 * sweep and the per-constraint entry cannot answer differently (barwise-904). */
function frequencyViolationsIn(pop: Population, fc: FrequencyConstraint): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (fc.roleIds.length === 0) return diagnostics;
  // Count occurrences of each distinct value-tuple across the roles.
  // Only complete tuples (every role valued) are a full combination.
  const counts = new Map<string, number>();
  for (const inst of pop.instances) {
    if (!fc.roleIds.every((rid) => inst.roleValues[rid] !== undefined)) continue;
    const key = makeCompositeKey(inst, fc.roleIds);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const single = fc.roleIds.length === 1;
  const roleLabel = fc.roleIds.join(", ");
  for (const [key, count] of counts) {
    const subject = single
      ? `value "${key}" in role "${roleLabel}"`
      : `combination "${key.split("\0").join(", ")}" in roles "${roleLabel}"`;
    if (count < fc.min) {
      diagnostics.push({
        severity: severityForModality(fc),
        message: `Population "${pop.id}": ${subject} `
          + `appears ${count} time(s) but the minimum is ${fc.min}.`,
        elementId: pop.id,
        ruleId: "population/frequency-violation",
      });
    }
    if (fc.max !== "unbounded" && count > fc.max) {
      diagnostics.push({
        severity: severityForModality(fc),
        message: `Population "${pop.id}": ${subject} `
          + `appears ${count} time(s) but the maximum is ${fc.max}.`,
        elementId: pop.id,
        ruleId: "population/frequency-violation",
      });
    }
  }
  return diagnostics;
}

/** Does this one frequency constraint reject the model's population? */
export function frequencyViolationsFor(
  model: OrmModel,
  factTypeId: string,
  fc: FrequencyConstraint,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  for (const pop of model.populations) {
    if (pop.factTypeId !== factTypeId) continue;
    diagnostics.push(...frequencyViolationsIn(pop, fc));
  }
  return diagnostics;
}
