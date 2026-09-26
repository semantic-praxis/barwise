/**
 * Phase 2: create value types for non-FK, non-PK columns.
 */

import {
  describeHolder,
  freeObjectTypeName,
  reportColumnType,
  resolveColumnDescription,
  resolveColumnType,
} from "./columnTypes.js";
import type { DbtMapperContext } from "./context.js";
import { toPascalCase } from "./naming.js";

export function createValueTypes(ctx: DbtMapperContext): void {
  for (const m of ctx.doc.models) {
    const entityId = ctx.entityIdMap.get(m.name);
    if (!entityId) continue;

    const pk = ctx.pkMap.get(m.name);
    const rels = ctx.relMap.get(m.name) ?? [];
    const relColNames = new Set(rels.map((r) => r.columnName));

    for (const col of m.columns) {
      // Skip PK column (identifierTypes.ts) and FK columns (factTypes.ts).
      if (col.name === pk?.columnName) continue;
      if (relColNames.has(col.name)) continue;

      const candidate = toPascalCase(col.name);

      // A value type of this name is shared across models. An entity of
      // this name is not a value type at all, and making it the player of
      // an attribute fact type would turn the column into a reference.
      const holder = ctx.model.getObjectTypeByName(candidate);
      if (holder?.kind === "value") {
        ctx.valueTypeIdMap.set(`${m.name}::${col.name}`, holder.id);
        continue;
      }

      const vtName = holder
        ? freeObjectTypeName(ctx, `${toPascalCase(m.name)}${candidate}`)
        : candidate;
      if (holder) {
        ctx.report.warning(
          "data_type",
          m.name,
          `Column "${col.name}" cannot use the name "${candidate}": ${
            describeHolder(holder)
          } already holds it. `
            + `Created value type "${vtName}" instead.`,
          col.name,
        );
      }

      const resolved = resolveColumnType(ctx, col);
      const definition = resolveColumnDescription(ctx, m.name, col);

      const vt = ctx.model.addObjectType({
        name: vtName,
        kind: "value",
        definition,
        ...(resolved.dataType ? { dataType: resolved.dataType } : {}),
      });

      ctx.valueTypeIdMap.set(`${m.name}::${col.name}`, vt.id);
      reportColumnType(ctx, m.name, col, resolved);
    }
  }
}
