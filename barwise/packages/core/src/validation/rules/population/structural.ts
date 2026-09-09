import type { ModelGraph } from "../../../model/graph.js";
import type { OrmModel } from "../../../model/OrmModel.js";
import type { Diagnostic } from "../../Diagnostic.js";
import { report, RULE_ID } from "../../ruleId.js";

/**
 * Every instance must supply a value for every role of its fact type.
 * A partial instance is not a smaller fact -- it is unverifiable data:
 * the constraint checks either skip it or compare absent values, both
 * of which mislead. Named here so the defect is reported as what it is
 * rather than surfacing as a spurious constraint violation.
 */
export function checkIncompleteInstances(model: OrmModel, graph: ModelGraph): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  for (const pop of model.populations) {
    const ft = graph.factType(pop.factTypeId);

    for (const inst of pop.instances) {
      const missing = ft.roles.filter(
        (r) => inst.roleValues[r.id] === undefined,
      );
      if (missing.length > 0) {
        // No `?? r.id` fallback: the graph resolves the player, so the
        // message names the type rather than degrading to an id when it
        // is needed most.
        const names = missing
          .map((r) => graph.player(r).name)
          .join(", ");
        diagnostics.push(
          report(RULE_ID.incompleteInstance, "default", inst.id, inst.id, ft.name, names),
        );
      }
    }
  }

  return diagnostics;
}
