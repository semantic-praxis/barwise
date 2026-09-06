/**
 * SQL cascade parser.
 *
 * Orchestrates per-statement parsing through the cascade:
 * 1. sqlglot structural parsing (optional sidecar, applied by
 *    @barwise/dbt before falling back here -- core stays pure)
 * 2. Regex-based pattern extraction (always available)
 *
 * When the sqlglot sidecar is unavailable the cascade degrades to
 * regex extraction, which handles common SQL patterns reliably. There
 * is no LLM tier: semantic improvement of a parsed draft is the
 * optional `ImportFormat.enrich` phase, owned by whichever connector
 * has an LLM client, and it never reports back through `ParseLevel`.
 */

import { extractSqlPatterns, splitSqlStatements } from "./SqlPatternExtractor.js";
import type {
  CascadeFileResult,
  CascadeStatementResult,
  SqlDialect,
  SqlPatternContext,
} from "./types.js";

/**
 * Parse a SQL file through the cascade.
 *
 * Splits the file into statements and extracts patterns from each
 * using regex-based extraction (the pure tier; the sqlglot tier is
 * applied by @barwise/formats before this fallback).
 *
 * @param sql - The SQL file content
 * @param filePath - Source file path for provenance
 * @param dialect - SQL dialect (affects parsing behavior)
 * @returns Cascade result with per-statement breakdowns
 */
export function parseSqlFile(
  sql: string,
  filePath: string,
  dialect: SqlDialect = "ansi",
): CascadeFileResult {
  const stmts = splitSqlStatements(sql);
  const statementResults: CascadeStatementResult[] = [];
  const allPatterns: SqlPatternContext[] = [];

  let lineOffset = 1;

  for (const stmt of stmts) {
    const result = parseSqlStatement(stmt, filePath, lineOffset, dialect);
    statementResults.push(result);
    allPatterns.push(...result.patterns);

    // Advance line offset past this statement
    lineOffset += stmt.split("\n").length;
  }

  return {
    filePath,
    statements: statementResults,
    patterns: allPatterns,
    dialect,
  };
}

/**
 * Parse a single SQL statement through the cascade.
 *
 * @param sql - The SQL statement text
 * @param filePath - Source file path
 * @param startLine - Start line in the source file
 * @param _dialect - SQL dialect (reserved for Calcite integration)
 * @returns Statement result with extracted patterns
 */
export function parseSqlStatement(
  sql: string,
  filePath: string,
  startLine: number,
  _dialect: SqlDialect = "ansi",
): CascadeStatementResult {
  // Currently uses regex-based extraction only.
  // TODO: When Calcite sidecar is available, try it first and
  // fall back to regex for unsupported syntax.
  const patterns = extractSqlPatterns(sql, filePath, startLine, "regex");

  return {
    sql,
    parseLevel: "regex",
    patterns,
    errors: [],
  };
}

/**
 * Detect the SQL statement type from its first keyword.
 */
export function detectStatementType(
  sql: string,
): "select" | "create" | "alter" | "insert" | "update" | "delete" | "other" {
  const trimmed = sql.trim().toUpperCase();

  if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) return "select";
  if (trimmed.startsWith("CREATE")) return "create";
  if (trimmed.startsWith("ALTER")) return "alter";
  if (trimmed.startsWith("INSERT")) return "insert";
  if (trimmed.startsWith("UPDATE")) return "update";
  if (trimmed.startsWith("DELETE")) return "delete";
  return "other";
}
