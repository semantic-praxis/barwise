/**
 * The SQL parser cascade's pattern and result types (sqlglot sidecar ->
 * regex), moved from core with the cascade
 * (format-renderers-to-connectors.spec.md, WS3).
 */
import type { SqlDialect } from "@barwise/core/sql";

/**
 * Which cascade level produced a parse result.
 *
 * - "sqlglot": Structural AST parsing via the optional sqlglot
 *   sidecar (SqlglotBridge.ts, beside this file).
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
