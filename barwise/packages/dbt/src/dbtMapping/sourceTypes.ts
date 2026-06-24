/**
 * Index and resolve source-table column data types.
 */

import type { DbtMapperContext } from "./context.js";

export function indexSourceDataTypes(ctx: DbtMapperContext): void {
  for (const source of ctx.doc.sources) {
    for (const table of source.tables) {
      for (const col of table.columns) {
        if (col.dataType) {
          const key = `${source.name}.${table.name}.${col.name}`;
          ctx.sourceDataTypes.set(key, col.dataType);

          // Build column-level index. If the same column name appears
          // across multiple source tables with different types, mark it
          // as ambiguous (null) so we don't guess wrong.
          const existing = ctx.sourceColumnTypes.get(col.name);
          if (existing === undefined) {
            // First time seeing this column name.
            ctx.sourceColumnTypes.set(col.name, col.dataType);
          } else if (existing !== null && existing !== col.dataType) {
            // Conflicting types -- mark ambiguous.
            ctx.sourceColumnTypes.set(col.name, null);
          }
          // If existing === col.dataType, no change needed (consistent).
        }
      }
    }
  }
}

/**
 * Look up a column's data type from source definitions.
 * Returns the type string if unambiguously found, undefined otherwise.
 */
export function resolveSourceColumnType(
  ctx: DbtMapperContext,
  columnName: string,
): string | undefined {
  const sourceType = ctx.sourceColumnTypes.get(columnName);
  // null means ambiguous (multiple sources disagree), undefined means not found.
  if (sourceType === null || sourceType === undefined) return undefined;
  return sourceType;
}
