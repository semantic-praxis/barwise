/**
 * Phase 2: create value types for non-FK, non-PK columns.
 */

import {
  claimValueType,
  describeHolder,
  formatDataType,
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
    const entityName = toPascalCase(m.name);

    for (const col of m.columns) {
      // Skip PK column (identifierTypes.ts) and FK columns (factTypes.ts).
      if (col.name === pk?.columnName) continue;
      if (relColNames.has(col.name)) continue;

      const resolved = resolveColumnType(ctx, col);
      const claim = claimValueType(ctx, entityName, entityId, col, resolved, "attribute");

      if (claim.kind === "share") {
        ctx.valueTypeIdMap.set(`${m.name}::${col.name}`, claim.valueType.id);
        continue;
      }

      if (claim.displaced) {
        ctx.report.warning(
          "data_type",
          m.name,
          `Column "${col.name}" (${formatDataType(resolved.dataType)}) cannot use the name "${
            toPascalCase(col.name)
          }": ${describeHolder(claim.displaced)} already holds it. `
            + `Created value type "${claim.name}" instead.`,
          col.name,
        );
      }

      const definition = resolveColumnDescription(ctx, m.name, col);

      const vt = ctx.model.addObjectType({
        name: claim.name,
        kind: "value",
        definition,
        ...(resolved.dataType ? { dataType: resolved.dataType } : {}),
      });

      ctx.valueTypeIdMap.set(`${m.name}::${col.name}`, vt.id);
      reportColumnType(ctx, m.name, col, resolved);
    }
  }
}
