/**
 * Avro schema renderer.
 *
 * Produces Apache Avro schema definitions (.avsc JSON) from a
 * RelationalSchema. Each table becomes an Avro record type with
 * fields derived from columns.
 *
 * Type mapping:
 *   SQL TEXT / VARCHAR  -> Avro "string"
 *   SQL INTEGER         -> Avro "long"
 *   SQL DECIMAL / FLOAT -> Avro "double"
 *   SQL BOOLEAN         -> Avro "boolean"
 *   SQL DATE            -> Avro int (logicalType: date)
 *   SQL TIME            -> Avro int (logicalType: time-millis)
 *   SQL DATETIME / TIMESTAMP -> Avro long (logicalType: timestamp-millis)
 *   SQL UUID            -> Avro string (logicalType: uuid)
 *   SQL BINARY / BLOB   -> Avro "bytes"
 *   Fallback            -> Avro "string"
 *
 * Nullable columns become Avro unions: ["null", type].
 */

import type { Column, RelationalSchema, Table } from "../RelationalSchema.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * An Avro field type -- either a primitive string or a logical type object.
 */
export type AvroFieldType =
  | string
  | { readonly type: string; readonly logicalType: string; };

/**
 * A single Avro schema field.
 */
export interface AvroField {
  readonly name: string;
  readonly type: AvroFieldType | readonly ["null", AvroFieldType];
  readonly doc?: string;
}

/**
 * A single Avro record schema (one per table).
 */
export interface AvroSchema {
  readonly type: "record";
  readonly name: string;
  readonly namespace?: string;
  readonly doc?: string;
  readonly fields: readonly AvroField[];
}

/**
 * The complete set of Avro schemas for a RelationalSchema.
 */
export interface AvroSchemaSet {
  readonly schemas: readonly AvroSchema[];
}

/**
 * Options for Avro rendering.
 */
export interface AvroRenderOptions {
  /** Avro namespace (e.g. "com.example.model"). */
  readonly namespace?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Render a RelationalSchema as a set of Avro record schemas.
 */
export function renderAvro(
  schema: RelationalSchema,
  options: AvroRenderOptions = {},
): AvroSchemaSet {
  const schemas: AvroSchema[] = schema.tables.map((table) =>
    renderTableSchema(table, options.namespace)
  );
  return { schemas };
}

/**
 * Render a single Avro schema as formatted JSON (for writing to .avsc file).
 */
export function avroSchemaToJson(schema: AvroSchema): string {
  return JSON.stringify(schema, null, 2);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function renderTableSchema(
  table: Table,
  namespace?: string,
): AvroSchema {
  const names = fieldNames(table);
  const fields: AvroField[] = table.columns.map((col) =>
    renderField(col, table, names.get(col.name)!)
  );

  const schema: AvroSchema = {
    type: "record",
    name: toPascalCase(table.name),
    ...(namespace ? { namespace } : {}),
    fields,
  };

  return schema;
}

function renderField(col: Column, table: Table, name: string): AvroField {
  const avroType = sqlTypeToAvro(col.dataType);
  const isPk = table.primaryKey.columnNames.includes(col.name);
  const docs = [
    ...(isPk ? ["Primary key"] : []),
    ...(name !== col.name ? [`The column "${col.name}".`] : []),
  ];

  const field: AvroField = {
    name,
    type: col.nullable ? ["null", avroType] : avroType,
    ...(docs.length > 0 ? { doc: docs.join(". ") } : {}),
  };

  return field;
}

/** An Avro name: a letter or `_`, then letters, digits and `_`. */
const AVRO_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Each column's field name. A column whose name Avro refuses, such as
 * `(ambiguous)` from an unresolved reference mode, was written as is, and
 * the schema did not parse (barwise-9g3, found by the characterization
 * golden's format check). Each character outside the alphabet becomes
 * `_`, with `_` before a leading digit; a name another column holds gets
 * `_2`, `_3`, and so on. Valid names are kept and reserved first, as the
 * OpenAPI path parameters are.
 */
function fieldNames(table: Table): Map<string, string> {
  const names = new Map(
    table.columns.filter((c) => AVRO_NAME.test(c.name)).map((c) => [c.name, c.name]),
  );
  const taken = new Set(names.values());
  for (const col of table.columns) {
    if (names.has(col.name)) continue;
    const base = col.name.replace(/[^A-Za-z0-9_]/g, "_").replace(/^(?=[0-9])/, "_");
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base}_${n}`;
    names.set(col.name, name);
    taken.add(name);
  }
  return names;
}

/**
 * Map a SQL data type string to an Avro type.
 */
function sqlTypeToAvro(sqlType: string): AvroFieldType {
  const normalized = sqlType.toUpperCase().replace(/\(.*\)/, "").trim();

  switch (normalized) {
    case "TEXT":
    case "VARCHAR":
      return "string";

    case "INTEGER":
    case "INT":
    case "BIGINT":
      return "long";

    case "DECIMAL":
    case "NUMERIC":
    case "FLOAT":
    case "DOUBLE":
      return "double";

    case "BOOLEAN":
    case "BOOL":
      return "boolean";

    case "DATE":
      return { type: "int", logicalType: "date" };

    case "TIME":
      return { type: "int", logicalType: "time-millis" };

    case "DATETIME":
    case "TIMESTAMP":
      return { type: "long", logicalType: "timestamp-millis" };

    case "UUID":
      return { type: "string", logicalType: "uuid" };

    case "BINARY":
    case "BLOB":
      return "bytes";

    default:
      return "string";
  }
}

/**
 * Convert a snake_case name to PascalCase for Avro record names.
 */
function toPascalCase(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}
