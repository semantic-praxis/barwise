import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";

/**
 * Every population must reference a fact type that exists in the model.
 */
export function checkDanglingPopulationFactType(model: OrmModel): Diagnostic[] {
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
 * Every instance must supply a value for every role of its fact type.
 * A partial instance is not a smaller fact -- it is unverifiable data:
 * the constraint checks either skip it or compare absent values, both
 * of which mislead. Named here so the defect is reported as what it is
 * rather than surfacing as a spurious constraint violation.
 */
export function checkIncompleteInstances(model: OrmModel): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = model.getFactType(pop.factTypeId);
    if (!ft) continue; // dangling reference: reported above

    for (const inst of pop.instances) {
      const missing = ft.roles.filter(
        (r) => inst.roleValues[r.id] === undefined,
      );
      if (missing.length > 0) {
        const names = missing
          .map((r) => model.getObjectType(r.playerId)?.name ?? r.id)
          .join(", ");
        diagnostics.push({
          severity: "error",
          message: `Population instance "${inst.id}" of fact type "${ft.name}" `
            + `has no value for role(s) played by: ${names}. Every instance `
            + `must fill every role of its fact type.`,
          elementId: inst.id,
          ruleId: "population/incomplete-instance",
        });
      }
    }
  }

  return diagnostics;
}
