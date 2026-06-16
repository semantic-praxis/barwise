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
