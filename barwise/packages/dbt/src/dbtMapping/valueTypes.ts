/**
 * Phase 2: create value types for non-FK, non-PK columns.
 */

import type { DbtMapperContext } from "./context.js";
import { inferColumnDescription, resolveDataType, toPascalCase } from "./naming.js";
import { resolveSourceColumnType } from "./sourceTypes.js";

export function createValueTypes(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    const entityId = ctx.entityIdMap.get(m.name);
    if (!entityId) continue;

    const pk = ctx.pkMap.get(m.name);
    const rels = ctx.relMap.get(m.name) ?? [];
    const relColNames = new Set(rels.map((r) => r.columnName));

    for (const col of m.columns) {
      // Skip PK column and FK columns.
      if (col.name === pk?.columnName) continue;
      if (relColNames.has(col.name)) continue;

      const vtName = toPascalCase(col.name);

      // Check if we already created this value type (shared across models).
      const existingVt = ctx.model.getObjectTypeByName(vtName);
      if (existingVt) {
        // Reuse existing value type.
        ctx.valueTypeIdMap.set(`${m.name}::${col.name}`, existingVt.id);
        continue;
      }

      // Resolve data type: prefer model column, fall back to source.
      let rawDataType = col.dataType;
      let dataTypeSource: "model" | "source" | "none" = "none";

      if (rawDataType) {
        dataTypeSource = "model";
      } else {
        const sourceType = resolveSourceColumnType(ctx, col.name);
        if (sourceType) {
          rawDataType = sourceType;
          dataTypeSource = "source";
        }
      }

      const dataType = resolveDataType(rawDataType);

      // Resolve description.
      const description = col.description ?? inferColumnDescription(col.name, m.name);
      const descSource = col.description ? "explicit" : "inferred";

      const vt = ctx.model.addObjectType({
        name: vtName,
        kind: "value",
        definition: description,
        dataType,
      });

      ctx.valueTypeIdMap.set(`${m.name}::${col.name}`, vt.id);

      if (descSource === "inferred") {
        ctx.report.warning(
          "description",
          m.name,
          `No description for column "${col.name}". Inferred: "${description}"`,
          col.name,
        );
      }

      if (dataTypeSource === "model") {
        ctx.report.info(
          "data_type",
          m.name,
          `Data type "${col.dataType}" resolved for column "${col.name}".`,
          col.name,
        );
      } else if (dataTypeSource === "source") {
        ctx.report.info(
          "data_type",
          m.name,
          `Data type "${rawDataType}" resolved for column "${col.name}" from source definitions.`,
          col.name,
        );
      } else {
        ctx.report.gap(
          "data_type",
          m.name,
          `No data_type for column "${col.name}" in model or source definitions.`,
          col.name,
        );
      }
    }
  }
}
