/**
 * Phase 1: create entity types from models with an identifiable PK.
 */

import type { DbtMapperContext } from "./context.js";
import { inferModelDescription, toPascalCase } from "./naming.js";

export function createEntityTypes(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    const pk = ctx.pkMap.get(m.name);
    if (!pk) continue; // Skip models without identifiable PK.

    const entityName = toPascalCase(m.name);
    const refMode = pk.columnName;

    // Resolve description.
    const description = m.description ?? inferModelDescription(m.name);
    const descSource = m.description ? "explicit" : "inferred";

    const ot = ctx.model.addObjectType({
      name: entityName,
      kind: "entity",
      referenceMode: refMode,
      definition: description,
    });

    ctx.entityIdMap.set(m.name, ot.id);

    if (descSource === "inferred") {
      ctx.report.warning(
        "description",
        m.name,
        `No model description provided. Inferred: "${description}"`,
      );
    } else {
      ctx.report.info(
        "description",
        m.name,
        `Model description used from YAML.`,
      );
    }
  }
}
