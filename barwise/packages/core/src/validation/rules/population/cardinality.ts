import { isCardinality } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { buildObjectUniverse, severityForModality, valuesPlayedInRole } from "./shared.js";

/**
 * Object-type cardinality: the number of instances of an object type must
 * fall within its declared `[min, max]` bound. The instance count is the
 * size of the type's object universe (the distinct values that appear in any
 * role played by the type across all populations). Population-gated: a type
 * with no sampled instances is skipped, since absence of data is not a
 * violation -- the same closed-world reading the other population rules use.
 */
export function checkObjectCardinalityViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const universe = buildObjectUniverse(model);

  for (const ot of model.objectTypes) {
    const card = ot.cardinality;
    if (!card) continue;
    const instances = universe.get(ot.id);
    if (!instances || instances.size === 0) continue; // no population data
    const count = instances.size;

    if (count < card.min) {
      diagnostics.push({
        severity: "error",
        message: `Object type "${ot.name}" has ${count} instance(s) in the `
          + `population but its cardinality requires at least ${card.min}.`,
        elementId: ot.id,
        ruleId: "population/object-cardinality-violation",
      });
    }
    if (card.max !== "unbounded" && count > card.max) {
      diagnostics.push({
        severity: "error",
        message: `Object type "${ot.name}" has ${count} instance(s) in the `
          + `population but its cardinality allows at most ${card.max}.`,
        elementId: ot.id,
        ruleId: "population/object-cardinality-violation",
      });
    }
  }

  return diagnostics;
}

/**
 * Unary-role cardinality: the number of distinct object instances that play
 * a unary role must fall within the constraint's `[min, max]` bound. The
 * count is the number of distinct values appearing in the role across all
 * populations. Population-gated: a role with no sampled values is skipped.
 */
export function checkUnaryRoleCardinalityViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      if (!isCardinality(c)) continue;
      const values = valuesPlayedInRole(model, c.roleId);
      if (values.size === 0) continue; // no population data
      const count = values.size;

      if (count < c.min) {
        diagnostics.push({
          severity: severityForModality(c),
          message: `Cardinality constraint on role "${c.roleId}" in fact type `
            + `"${ft.name}" is played by ${count} instance(s) but requires at `
            + `least ${c.min}.`,
          elementId: c.id ?? ft.id,
          ruleId: "population/unary-role-cardinality-violation",
        });
      }
      if (c.max !== "unbounded" && count > c.max) {
        diagnostics.push({
          severity: severityForModality(c),
          message: `Cardinality constraint on role "${c.roleId}" in fact type `
            + `"${ft.name}" is played by ${count} instance(s) but allows at `
            + `most ${c.max}.`,
          elementId: c.id ?? ft.id,
          ruleId: "population/unary-role-cardinality-violation",
        });
      }
    }
  }

  return diagnostics;
}
