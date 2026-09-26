/**
 * The one mapping from a SQL data type to a conceptual ORM data type.
 *
 * Both import paths that meet raw SQL types -- DDL import in
 * `@barwise/formats` and dbt schema import in `@barwise/dbt` -- ask
 * this question, and each previously owned its own answer; the copies
 * disagreed (`TIMESTAMP` became "datetime" through DDL and
 * "timestamp" through dbt, so the same column imported differently by
 * path), and a third, dead copy sat in the SQL importer (barwise-865).
 *
 * Returns `undefined` for an unrecognized type: what an unknown type
 * becomes is each caller's explicit policy (DDL degrades to "other",
 * dbt omits the data type), not this mapping's.
 */

import type { ConceptualDataTypeName, DataTypeDef } from "../model/ObjectType.js";

// Each keyword is guarded with (?![a-z]) so a keyword prefix does not
// swallow an unrelated type ("interval" is not an integer, "time" does
// not claim "timestamp" because timestamp is checked first) while
// still covering dialect suffixes: "varchar2", "timestamp_ntz",
// "timestamp with time zone", "int unsigned".
const RULES: readonly (readonly [RegExp, ConceptualDataTypeName])[] = [
  [/^(character varying|nvarchar|varchar|character|char|text|string)(?![a-z])/, "text"],
  [/^(tinyint|smallint|bigint|integer|int)(?![a-z])/, "integer"],
  [/^(decimal|numeric|number)(?![a-z])/, "decimal"],
  [/^(double precision|double|real|float)(?![a-z])/, "float"],
  [/^(boolean|bool)(?![a-z])/, "boolean"],
  [/^timestamp(?![a-z])/, "timestamp"],
  [/^datetime(?![a-z])/, "datetime"],
  [/^date(?![a-z])/, "date"],
  [/^time(?![a-z])/, "time"],
  [/^(serial|autoincrement|identity)(?![a-z])/, "auto_counter"],
  [/^(varbinary|binary|blob|bytea|bytes)(?![a-z])/, "binary"],
  [/^uuid(?![a-z])/, "uuid"],
  [/^money(?![a-z])/, "money"],
];

/**
 * Map a raw SQL type (any case, with or without a length suffix like
 * `VARCHAR(255)`) to its conceptual data type, or `undefined` when no
 * rule recognizes it.
 */
export function mapSqlTypeToConceptual(sqlType: string): ConceptualDataTypeName | undefined {
  const normalized = sqlType.toLowerCase().replace(/\(.*\)/, "").trim();
  for (const [pattern, conceptual] of RULES) {
    if (pattern.test(normalized)) return conceptual;
  }
  return undefined;
}

/**
 * Parse a raw SQL type into a conceptual data type with its length and
 * scale: `VARCHAR(50)` is text(50), `DECIMAL(10,2)` is decimal(10,2).
 * `undefined` when `mapSqlTypeToConceptual` does not recognize the type,
 * which leaves the unknown-type policy with the caller, as there.
 *
 * The DDL and dbt importers both need the length, not just the name: a
 * type parsed to its name alone re-exports `VARCHAR(50)` as `TEXT`
 * (ddl-import-fidelity.spec.md).
 */
export function parseSqlDataType(raw: string): DataTypeDef | undefined {
  const name = mapSqlTypeToConceptual(raw);
  if (!name) return undefined;
  const size = /\((\d+)(?:\s*,\s*(\d+))?\)/.exec(raw);
  if (!size) return { name };
  const length = parseInt(size[1]!, 10);
  return size[2] === undefined ? { name, length } : { name, length, scale: parseInt(size[2], 10) };
}
