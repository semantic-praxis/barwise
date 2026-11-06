/**
 * SQL dialects. Core's mapping chooses constraint rendering by dialect,
 * so the dialect list lives here; the parser cascade's own result types
 * live with the cascade in @barwise/formats
 * (format-renderers-to-connectors.spec.md, WS3).
 */

/**
 * Supported SQL dialects for the cascade parser.
 */
export type SqlDialect =
  | "ansi"
  | "snowflake"
  | "bigquery"
  | "postgres"
  | "mysql"
  | "redshift"
  | "databricks";

// Record-typed so the runtime list cannot lag the union; CLI help and
// MCP enums derive from this instead of re-listing (barwise-867).
const SQL_DIALECT_MEMBERS: Record<SqlDialect, true> = {
  ansi: true,
  snowflake: true,
  bigquery: true,
  postgres: true,
  mysql: true,
  redshift: true,
  databricks: true,
};

/** Every SqlDialect member, in declaration order. */
export const SQL_DIALECTS = Object.keys(SQL_DIALECT_MEMBERS) as readonly SqlDialect[];
