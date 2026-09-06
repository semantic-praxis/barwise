/**
 * SQL analysis types.
 *
 * Defines the dialect, pattern, and cascade result types used by
 * the SQL parsing cascade (sqlglot sidecar -> regex).
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

/**
 * Which cascade level produced a parse result.
 *
 * - "sqlglot": Structural AST parsing via the optional sqlglot
 *   sidecar (@barwise/dbt owns the subprocess; core stays pure).
 * - "regex": Lightweight regex-based pattern extraction.
 *
 * Two tiers, not three. An "llm" member was declared here for years
 * and produced by nothing (barwise-858): core cannot make an LLM call,
 * and no connector did either. A tier only exists once something
 * produces it; if a connector ever interprets SQL through a model, it
 * does so behind `ImportFormat.enrich` and adds the member then.
 */
export type ParseLevel = "sqlglot" | "regex";

/**
 * A SQL pattern extracted from analysis.
 *
 * Represents a business-rule-relevant construct found in SQL:
 * JOIN conditions, WHERE predicates, CASE branches, CHECK constraints,
 * UNIQUE constraints, GROUP BY columns.
 */
export interface SqlPatternContext {
  /** Kind of SQL pattern. */
  readonly kind:
    | "join"
    | "where"
    | "case"
    | "check"
    | "unique"
    | "group_by"
    | "not_null"
    | "foreign_key"
    | "default";
  /** Source file path. */
  readonly filePath: string;
  /** Start line in the source file (1-based). */
  readonly startLine: number;
  /** End line in the source file (1-based). */
  readonly endLine: number;
  /** The raw SQL text of the pattern. */
  readonly sourceText: string;
  /** Tables involved in the pattern. */
  readonly tables?: readonly string[];
  /** Columns involved in the pattern. */
  readonly columns?: readonly string[];
  /** Which cascade level produced this pattern. */
  readonly parseLevel: ParseLevel;
  /** Additional pattern-specific details. */
  readonly details?: Record<string, unknown>;
}

/**
 * Result of parsing a single SQL statement through the cascade.
 */
export interface CascadeStatementResult {
  /** The original SQL statement text. */
  readonly sql: string;
  /** Which level successfully parsed this statement. */
  readonly parseLevel: ParseLevel;
  /** Patterns extracted from the statement. */
  readonly patterns: readonly SqlPatternContext[];
  /** Errors encountered (empty if parsing succeeded). */
  readonly errors: readonly string[];
}

/**
 * Result of parsing an entire SQL file through the cascade.
 */
export interface CascadeFileResult {
  /** The source file path. */
  readonly filePath: string;
  /** Per-statement results. */
  readonly statements: readonly CascadeStatementResult[];
  /** Aggregated patterns across all statements. */
  readonly patterns: readonly SqlPatternContext[];
  /** Dialect used (or auto-detected). */
  readonly dialect: SqlDialect;
}

/**
 * Configuration for the Calcite sidecar process.
 */
export interface CalciteSidecarConfig {
  /** Path to the Java executable. Defaults to "java". */
  readonly javaCommand?: string;
  /** Path to the sidecar JAR file. Auto-detected if omitted. */
  readonly jarPath?: string;
  /** Timeout for sidecar responses (ms). Defaults to 10000. */
  readonly timeout?: number;
}

/**
 * Request sent to the Calcite sidecar (stdin JSON).
 */
export interface CalciteParseRequest {
  /** SQL statement to parse. */
  readonly sql: string;
  /** SQL dialect configuration. */
  readonly dialect: SqlDialect;
  /** Whether to try Babel parser on failure. */
  readonly useBabel?: boolean;
}

/**
 * Response from the Calcite sidecar (stdout JSON).
 */
export interface CalciteParseResponse {
  /** Whether parsing succeeded. */
  readonly success: boolean;
  /** Which parser level succeeded. */
  readonly level?: "core" | "babel";
  /** JSON representation of the parsed AST. */
  readonly ast?: Record<string, unknown>;
  /** Error message if parsing failed. */
  readonly error?: string;
  /** Tables referenced in the SQL. */
  readonly tables?: readonly string[];
  /** Columns referenced in the SQL. */
  readonly columns?: readonly string[];
}
