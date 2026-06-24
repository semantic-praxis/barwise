/**
 * Pure name and data-type inference helpers for dbt-to-ORM mapping.
 */

import type { ConceptualDataTypeName, DataTypeDef } from "@barwise/core";

// ---------------------------------------------------------------------------
// Data type resolution
// ---------------------------------------------------------------------------

const SQL_TYPE_MAP: Record<string, ConceptualDataTypeName> = {
  text: "text",
  varchar: "text",
  "character varying": "text",
  string: "text",
  int: "integer",
  integer: "integer",
  bigint: "integer",
  smallint: "integer",
  number: "decimal",
  numeric: "decimal",
  decimal: "decimal",
  float: "float",
  double: "float",
  "double precision": "float",
  real: "float",
  boolean: "boolean",
  bool: "boolean",
  date: "date",
  time: "time",
  datetime: "datetime",
  timestamp: "timestamp",
  "timestamp_ntz": "timestamp",
  "timestamp_ltz": "timestamp",
  "timestamp_tz": "timestamp",
  "timestamp without time zone": "timestamp",
  "timestamp with time zone": "timestamp",
  binary: "binary",
  varbinary: "binary",
  bytes: "binary",
  uuid: "uuid",
};

export function resolveDataType(rawType: string | undefined): DataTypeDef | undefined {
  if (!rawType) return undefined;

  const normalized = rawType.toLowerCase().replace(/\(.*\)/, "").trim();
  const conceptual = SQL_TYPE_MAP[normalized];

  if (!conceptual) return undefined;

  // Extract length/scale from parenthesized suffix.
  const parenMatch = rawType.match(/\((\d+)(?:\s*,\s*(\d+))?\)/);
  const length = parenMatch ? parseInt(parenMatch[1]!, 10) : undefined;
  const scale = parenMatch?.[2] ? parseInt(parenMatch[2], 10) : undefined;

  return { name: conceptual, length, scale };
}

// ---------------------------------------------------------------------------
// Name inference
// ---------------------------------------------------------------------------

/**
 * Convert a snake_case dbt name to PascalCase.
 * Strips common prefixes like "stg_".
 */
export function toPascalCase(name: string): string {
  // Strip common dbt prefixes.
  let clean = name;
  for (const prefix of ["stg_", "staging_", "int_", "fct_", "dim_"]) {
    if (clean.startsWith(prefix)) {
      clean = clean.slice(prefix.length);
      break;
    }
  }

  return clean
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Infer a model description from its name when none is provided.
 */
export function inferModelDescription(modelName: string): string {
  const name = toPascalCase(modelName);
  // Split PascalCase back to words.
  const words = name.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return `A ${words} entity (description inferred from model name).`;
}

/**
 * Infer a column description from its name and parent model.
 */
export function inferColumnDescription(
  columnName: string,
  modelName: string,
): string {
  const colWords = columnName.replace(/_/g, " ");
  const modelWords = toPascalCase(modelName)
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase();

  // Common patterns.
  if (columnName.endsWith("_id")) {
    const entity = columnName.slice(0, -3).replace(/_/g, " ");
    return `Identifier for the associated ${entity}.`;
  }
  if (columnName.endsWith("_at") || columnName.endsWith("_date")) {
    return `The ${colWords} of the ${modelWords}.`;
  }
  if (
    columnName.startsWith("is_")
    || columnName.startsWith("has_")
  ) {
    return `Whether the ${modelWords} ${colWords.replace(/^(is|has) /, "")}.`;
  }
  if (
    columnName.startsWith("count_")
    || columnName.startsWith("total_")
    || columnName.startsWith("sum_")
    || columnName.startsWith("avg_")
    || columnName.startsWith("number_of_")
  ) {
    return `Computed: ${colWords} for the ${modelWords}.`;
  }

  return `The ${colWords} of a ${modelWords}.`;
}
