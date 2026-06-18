import { isValueComparison, type ValueComparisonOperator } from "../../../model/Constraint.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";

/** Whether a string parses as a finite number. */
function isFiniteNumber(s: string): boolean {
  return s.trim() !== "" && Number.isFinite(Number(s));
}

/**
 * Evaluate `a <operator> b`. Compares numerically when both values parse as
 * finite numbers, otherwise lexically -- the same convention value-range
 * validation uses.
 */
function comparisonHolds(a: string, op: ValueComparisonOperator, b: string): boolean {
  const numeric = isFiniteNumber(a) && isFiniteNumber(b);
  const cmp = numeric
    ? Math.sign(Number(a) - Number(b))
    : (a < b ? -1 : a > b ? 1 : 0);
  switch (op) {
    case "<":
      return cmp < 0;
    case "<=":
      return cmp <= 0;
    case "=":
      return cmp === 0;
    case "<>":
      return cmp !== 0;
    case ">=":
      return cmp >= 0;
    case ">":
      return cmp > 0;
  }
}

/**
 * Value-comparison constraints assert an ordering between two role values
 * of a fact type. For each instance that supplies both roles, the asserted
 * relationship must hold.
 */
export function checkValueComparisonViolations(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue;

    const constraints = ft.constraints.filter(isValueComparison);
    for (const vc of constraints) {
      for (const inst of pop.instances) {
        const a = inst.roleValues[vc.roleId1];
        const b = inst.roleValues[vc.roleId2];
        if (a === undefined || b === undefined) continue;
        if (!comparisonHolds(a, vc.operator, b)) {
          diagnostics.push({
            severity: "error",
            message: `Population "${pop.id}": instance "${inst.id}" violates the `
              + `value-comparison constraint -- "${a}" ${vc.operator} "${b}" is false.`,
            elementId: pop.id,
            ruleId: "population/value-comparison-violation",
          });
        }
      }
    }
  }

  return diagnostics;
}
