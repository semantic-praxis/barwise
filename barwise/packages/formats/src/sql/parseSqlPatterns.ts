/**
 * The SQL pattern cascade every importer uses: the sqlglot sidecar when
 * `uv` and sqlglot answer, and the regex tier otherwise, normalized so
 * the two tiers report source text the same way.
 *
 * The SQL importer and the dbt importer each inlined this two-line
 * cascade over their own copy of the bridge, held identical by a parity
 * set. Since dbt depends on formats, both call this one function
 * (format-renderers-to-connectors.spec.md, WS3;
 * docs/adr/must-agree-copies.md#share-by-composition).
 */
import type { SqlDialect } from "@barwise/core/sql";
import { parseSqlFile } from "./SqlCascadeParser.js";
import { normalizeCascadeResult, parseSqlWithSqlglot } from "./SqlglotBridge.js";
import type { CascadeFileResult } from "./types.js";

export function parseSqlPatterns(
  sql: string,
  sourcePath: string,
  dialect: SqlDialect,
): CascadeFileResult {
  return parseSqlWithSqlglot(sql, sourcePath, dialect)
    ?? normalizeCascadeResult(parseSqlFile(sql, sourcePath, dialect));
}
