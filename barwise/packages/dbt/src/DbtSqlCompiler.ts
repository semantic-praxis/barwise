/**
 * dbt SQL compiler.
 *
 * Resolves Jinja templates in dbt SQL files to produce parseable SQL.
 *
 * Two strategies:
 * 1. Preferred: run `dbt compile` to produce fully-resolved SQL in target/compiled/
 * 2. Fallback: stub Jinja rendering that replaces common macros with placeholders
 *
 * The stub approach produces syntactically valid SQL that may reference
 * non-existent tables, but is sufficient for structural analysis of
 * JOINs, WHERE clauses, and CASE branches.
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * A compiled SQL file with its source path and resolved SQL content.
 */
export interface CompiledSqlFile {
  /** Original source file path (relative to project root). */
  readonly sourcePath: string;
  /** Compiled SQL content (Jinja resolved). */
  readonly sql: string;
  /** Whether the SQL was compiled via dbt or stub-rendered. */
  readonly compilationMethod: "dbt-compile" | "stub";
}

/**
 * Compile dbt SQL files from a project directory.
 *
 * Attempts to use pre-compiled SQL from target/compiled/ first.
 * Falls back to stub Jinja rendering for each .sql file in models/.
 *
 * @param projectDir - Path to the dbt project root
 * @returns Array of compiled SQL files
 */
export function compileDbtSql(projectDir: string): CompiledSqlFile[] {
  // Try compiled output first
  const compiled = readCompiledOutput(projectDir);
  if (compiled.length > 0) {
    return compiled;
  }

  // Fall back to stub rendering
  return stubRenderSqlFiles(projectDir);
}

/**
 * Read pre-compiled SQL from target/compiled/.
 */
function readCompiledOutput(projectDir: string): CompiledSqlFile[] {
  const compiledDir = join(projectDir, "target", "compiled");
  if (!existsSync(compiledDir)) {
    return [];
  }

  const results: CompiledSqlFile[] = [];

  // Find all .sql files under target/compiled/
  const sqlFiles = findSqlFiles(compiledDir);
  for (const filePath of sqlFiles) {
    try {
      const sql = readFileSync(filePath, "utf-8");
      const sourcePath = relative(compiledDir, filePath);
      results.push({
        sourcePath,
        sql,
        compilationMethod: "dbt-compile",
      });
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Stub-render all .sql files in the models/ directory.
 */
function stubRenderSqlFiles(projectDir: string): CompiledSqlFile[] {
  const modelsDir = join(projectDir, "models");
  const searchDir = existsSync(modelsDir) ? modelsDir : projectDir;

  const sqlFiles = findSqlFiles(searchDir);
  const results: CompiledSqlFile[] = [];

  for (const filePath of sqlFiles) {
    try {
      const raw = readFileSync(filePath, "utf-8");
      const sql = stubRenderJinja(raw);
      const sourcePath = relative(projectDir, filePath);
      results.push({
        sourcePath,
        sql,
        compilationMethod: "stub",
      });
    } catch {
      // Skip unreadable files
    }
  }

  return results;
}

/**
 * Stub-render Jinja templates in a SQL string.
 *
 * Replaces common dbt macros with syntactically valid SQL:
 * - {{ ref('model') }} -> model
 * - {{ source('src', 'table') }} -> src.table
 * - {{ config(...) }} -> (removed)
 * - {% if is_incremental() %} ... {% endif %} -> (removed, keeps else block)
 * - {{ var('name') }} -> 'name'
 * - {{ this }} -> this_model
 * - Other {{ ... }} -> removed
 * - Other {% ... %} -> removed
 */
export function stubRenderJinja(sql: string): string {
  let result = sql;

  // ref('model') or ref("model")
  result = result.replace(/\{\{\s*ref\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, "$1");

  // source('src', 'table') or source("src", "table")
  result = result.replace(
    /\{\{\s*source\(\s*['"]([^'"]+)['"]\s*,\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g,
    "$1.$2",
  );

  // config(...) -- strip entirely
  result = result.replace(/\{\{\s*config\([^)]*\)\s*\}\}/g, "");
  result = result.replace(/\{%[-\s]*config\([^)]*\)\s*[-]?%\}/g, "");

  // var('name') -> 'name'
  result = result.replace(/\{\{\s*var\(\s*['"]([^'"]+)['"]\s*\)\s*\}\}/g, "'$1'");

  // this -> this_model
  result = result.replace(/\{\{\s*this\s*\}\}/g, "this_model");

  // is_incremental() blocks -- remove the incremental path, keep else
  result = result.replace(
    /\{%[-\s]*if\s+is_incremental\(\)\s*[-]?%\}[\s\S]*?\{%[-\s]*else\s*[-]?%\}([\s\S]*?)\{%[-\s]*endif\s*[-]?%\}/g,
    "$1",
  );
  // is_incremental() blocks without else -- remove entirely
  result = result.replace(
    /\{%[-\s]*if\s+is_incremental\(\)\s*[-]?%\}[\s\S]*?\{%[-\s]*endif\s*[-]?%\}/g,
    "",
  );

  // Remaining Jinja blocks {% ... %}
  result = result.replace(/\{%[-\s]*[\s\S]*?[-]?%\}/g, "");

  // Remaining Jinja expressions {{ ... }}
  result = result.replace(/\{\{[\s\S]*?\}\}/g, "");

  // Clean up extra blank lines
  result = result.replace(/\n{3,}/g, "\n\n");

  return result.trim();
}

/**
 * Recursively find all .sql files under a directory.
 */
function findSqlFiles(dir: string): string[] {
  const results: string[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = join(dir, entry);

    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      if (entry === "node_modules" || entry === ".git" || entry === "dbt_packages") {
        continue;
      }
      results.push(...findSqlFiles(fullPath));
    } else if (entry.endsWith(".sql")) {
      results.push(fullPath);
    }
  }

  return results;
}
