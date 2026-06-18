/**
 * DDL renderer.
 *
 * Produces SQL DDL (CREATE TABLE) statements from a RelationalSchema.
 */

import { renderPopulationAsSql } from "../../export/populationRenderer.js";
import type { OrmModel } from "../../model/OrmModel.js";
import type { RelationalSchema, Table } from "../RelationalSchema.js";

export interface DdlRenderOptions {
  /** Include population examples as INSERT statements (default: true). */
  readonly includeExamples?: boolean;
}

/**
 * Render a RelationalSchema as SQL DDL.
 *
 * @param schema - The relational schema to render
 * @param model - The source ORM model (required for populations)
 * @param options - Rendering options
 */
export function renderDdl(
  schema: RelationalSchema,
  model?: OrmModel,
  options?: DdlRenderOptions,
): string {
  const includeExamples = options?.includeExamples ?? true;
  const ddl = schema.tables.map((t) => renderTable(t)).join("\n\n");

  // Append population examples if requested and model is provided
  if (includeExamples && model) {
    const examples = renderPopulationAsSql(model, schema);
    return examples ? ddl + examples : ddl;
  }

  return ddl;
}

function renderTable(table: Table): string {
  const lines: string[] = [];
  lines.push(`CREATE TABLE ${quoteIdent(table.name)} (`);

  const parts: string[] = [];

  // Columns.
  for (const col of table.columns) {
    const nullable = col.nullable ? "" : " NOT NULL";
    const def = col.defaultValue !== undefined
      ? ` DEFAULT ${sqlDefaultLiteral(col.defaultValue)}`
      : "";
    parts.push(`  ${quoteIdent(col.name)} ${col.dataType}${def}${nullable}`);
  }

  // Primary key.
  if (table.primaryKey.columnNames.length > 0) {
    const cols = table.primaryKey.columnNames
      .map((c) => quoteIdent(c))
      .join(", ");
    parts.push(`  PRIMARY KEY (${cols})`);
  }

  // Foreign keys.
  for (const fk of table.foreignKeys) {
    const cols = fk.columnNames.map((c) => quoteIdent(c)).join(", ");
    const refCols = fk.referencedColumns
      .map((c) => quoteIdent(c))
      .join(", ");
    parts.push(
      `  FOREIGN KEY (${cols}) REFERENCES ${quoteIdent(fk.referencedTable)} (${refCols})`,
    );
  }

  lines.push(parts.join(",\n"));
  lines.push(");");

  return lines.join("\n");
}

/**
 * Render a default value as a SQL literal: numeric and boolean values are
 * emitted bare, everything else as a single-quoted string with embedded
 * quotes doubled.
 */
function sqlDefaultLiteral(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value) || value === "TRUE" || value === "FALSE") {
    return value;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

function quoteIdent(name: string): string {
  // Simple quoting: wrap in double quotes if the name contains special chars,
  // otherwise return as-is.
  if (/^[a-z_][a-z0-9_]*$/.test(name)) {
    return name;
  }
  return `"${name.replace(/"/g, '""')}"`;
}
