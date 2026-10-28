/**
 * dbt renderer.
 *
 * Produces dbt model files and a schema.yml from a RelationalSchema.
 * Each table becomes a dbt model (a SELECT statement) and a schema
 * entry with column definitions, data types, and tests.
 *
 * Output is normalized (3NF) -- the relational schema produced by
 * RelationalMapper already follows absorption-based normalization.
 */

import { stringify } from "yaml";
import type { Column, ForeignKey, RelationalSchema, Table } from "../RelationalSchema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single dbt model file (name + SQL content).
 */
export interface DbtModelFile {
  /** File name without extension (e.g. "customer"). */
  readonly name: string;
  /** SQL content of the model file. */
  readonly sql: string;
}

/**
 * A complete dbt project export.
 */
export interface DbtProject {
  /** One model file per table. */
  readonly models: readonly DbtModelFile[];
  /** schema.yml content (YAML string). */
  readonly schemaYaml: string;
}

/**
 * Options for dbt rendering.
 */
export interface DbtRenderOptions {
  /**
   * Source name used in `{{ source('name', 'table') }}` refs.
   * Defaults to "raw".
   */
  readonly sourceName?: string;
  /**
   * Whether to generate relationship tests for foreign keys.
   * Defaults to true.
   */
  readonly generateRelationshipTests?: boolean;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render a RelationalSchema as a dbt project (model files + schema.yml).
 */
export function renderDbt(
  schema: RelationalSchema,
  options: DbtRenderOptions = {},
): DbtProject {
  const sourceName = options.sourceName ?? "raw";
  const genRelTests = options.generateRelationshipTests ?? true;

  const models: DbtModelFile[] = schema.tables.map((table) => ({
    name: table.name,
    sql: renderModelSql(table, sourceName),
  }));

  const schemaYaml = renderSchemaYaml(schema, genRelTests);

  return { models, schemaYaml };
}

// ---------------------------------------------------------------------------
// SQL model rendering
// ---------------------------------------------------------------------------

function renderModelSql(table: Table, sourceName: string): string {
  const lines: string[] = [];
  lines.push(`SELECT`);

  const columnLines = table.columns.map((col, i) => {
    const cast = `CAST(${col.name} AS ${sqlTypeToDbtType(col.dataType)})`;
    const alias = ` AS ${col.name}`;
    const comma = i < table.columns.length - 1 ? "," : "";
    return `  ${cast}${alias}${comma}`;
  });
  lines.push(...columnLines);

  lines.push(`FROM {{ source('${sourceName}', '${table.name}') }}`);

  return lines.join("\n") + "\n";
}

/**
 * Map SQL data types to dbt-friendly cast types.
 * dbt generally passes through SQL types, but we normalize casing.
 */
function sqlTypeToDbtType(sqlType: string): string {
  // Pass through as-is -- dbt uses the warehouse's native types.
  return sqlType;
}

// ---------------------------------------------------------------------------
// schema.yml rendering
// ---------------------------------------------------------------------------

/**
 * The dbt_utils test that keys a model on several columns. The dbt
 * importer reads the same name back as a composite key, so it imports this
 * constant rather than spelling it again.
 */
export const DBT_KEY_TEST = "dbt_utils.unique_combination_of_columns";

/**
 * The columns a model's `DBT_KEY_TEST` names, or undefined when the model
 * gets none: a key over several columns. The renderer writes the test from
 * it, and the export annotator notes the dbt_utils dependency from it.
 */
export function dbtKeyTestColumns(table: Table): readonly string[] | undefined {
  const key = table.primaryKey.columnNames;
  return key.length > 1 ? key : undefined;
}

interface SchemaModel {
  name: string;
  columns: SchemaColumn[];
  data_tests?: Array<Record<string, unknown>>;
}

interface SchemaColumn {
  name: string;
  data_type: string;
  data_tests?: Array<string | Record<string, unknown>>;
}

/**
 * A generic test with its arguments under `arguments:`. From dbt 1.10.8
 * (the flag `require_generic_test_arguments_property`, true by default
 * there) arguments beside the test name raise a deprecation, and dbt
 * requires every deprecation resolved before the move to Fusion
 * (dbt-export-current-test-syntax.spec.md, barwise-fnt). The importer reads
 * both forms.
 */
function genericTest(name: string, args: Record<string, unknown>): Record<string, unknown> {
  return { [name]: { arguments: args } };
}

function renderSchemaYaml(
  schema: RelationalSchema,
  genRelTests: boolean,
): string {
  const models: SchemaModel[] = schema.tables.map((table) => buildSchemaModel(table, genRelTests));

  const doc = {
    version: 2,
    models,
  };

  return stringify(doc, { lineWidth: 120 });
}

function buildSchemaModel(table: Table, genRelTests: boolean): SchemaModel {
  const columns: SchemaColumn[] = table.columns.map((col) => {
    const tests = buildColumnTests(col, table, genRelTests);
    const entry: SchemaColumn = {
      name: col.name,
      data_type: col.dataType,
    };
    if (tests.length > 0) {
      entry.data_tests = tests;
    }
    return entry;
  });

  // A key over several columns has no column to carry `unique`, so it is
  // tested on the model, as the dbt importer reads a composite key back
  // (dbt-composite-key-tests.spec.md, barwise-lqj). The test is dbt_utils',
  // which the project must declare; dbt core has no multi-column unique.
  const key = dbtKeyTestColumns(table);
  return {
    name: table.name,
    columns,
    ...(key
      ? { data_tests: [genericTest(DBT_KEY_TEST, { combination_of_columns: [...key] })] }
      : {}),
  };
}

function buildColumnTests(
  col: Column,
  table: Table,
  genRelTests: boolean,
): Array<string | Record<string, unknown>> {
  const tests: Array<string | Record<string, unknown>> = [];

  // not_null test for non-nullable columns.
  if (!col.nullable) {
    tests.push("not_null");
  }

  // unique test for primary key columns (single-column PKs).
  if (
    table.primaryKey.columnNames.length === 1
    && table.primaryKey.columnNames[0] === col.name
  ) {
    tests.push("unique");
  }

  // relationship tests for FK columns.
  if (genRelTests) {
    const fk = findForeignKeyForColumn(col.name, table.foreignKeys);
    if (fk) {
      tests.push(genericTest("relationships", {
        to: `ref('${fk.referencedTable}')`,
        field: fk.referencedColumns[0],
      }));
    }
  }

  return tests;
}

function findForeignKeyForColumn(
  columnName: string,
  foreignKeys: readonly ForeignKey[],
): ForeignKey | undefined {
  // Only match single-column FKs to keep tests simple.
  return foreignKeys.find(
    (fk) => fk.columnNames.length === 1 && fk.columnNames[0] === columnName,
  );
}
