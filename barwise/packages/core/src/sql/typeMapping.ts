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

import type { ConceptualDataTypeName } from "../model/ObjectType.js";

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
