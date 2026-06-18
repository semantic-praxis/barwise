/**
 * SQL import format.
 *
 * Parses raw SQL files (DDL, migrations, queries) into ORM models.
 * Supports both single-file (text) and directory (async) input.
 *
 * Uses the SQL cascade parser for pattern extraction and maps
 * extracted patterns to ORM constraints. Handles dialect detection
 * via explicit flags, file-level hints, or syntax probing.
 */

import {
  type ConceptualDataTypeName,
  type ImportFormat,
  type ImportOptions,
  type ImportResult,
  OrmModel,
} from "@barwise/core";
import { parseSqlFile, type SqlDialect, type SqlPatternContext } from "@barwise/core/sql";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

/**
 * Detect dialect from file-level hints in SQL content.
 */
function detectDialectFromHints(sql: string): SqlDialect | undefined {
  const firstLines = sql.split("\n").slice(0, 5).join("\n").toLowerCase();

  // Explicit dialect comment
  const dialectComment = /--\s*dialect:\s*(\w+)/i.exec(firstLines);
  if (dialectComment) {
    const d = dialectComment[1]!.toLowerCase();
    const map: Record<string, SqlDialect> = {
      snowflake: "snowflake",
      bigquery: "bigquery",
      postgres: "postgres",
      postgresql: "postgres",
      mysql: "mysql",
      redshift: "redshift",
      databricks: "databricks",
    };
    if (d in map) return map[d];
  }

  // Syntax-based hints
  if (/set\s+search_path/i.test(sql)) return "postgres";
  if (/create\s+or\s+replace\s+stage/i.test(sql)) return "snowflake";
  if (/qualify\s+/i.test(sql)) return "snowflake";
  if (/create\s+temp\s+function/i.test(sql)) return "bigquery";
  if (/struct\s*</i.test(sql)) return "bigquery";

  return undefined;
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
      if (
        entry === "node_modules"
        || entry === ".git"
        || entry === "target"
      ) {
        continue;
      }
      results.push(...findSqlFiles(fullPath));
    } else if (entry.endsWith(".sql")) {
      results.push(fullPath);
    }
  }

  return results;
}

/**
 * Map SQL data types to conceptual ORM data types.
 */
function _mapSqlType(sqlType: string): ConceptualDataTypeName {
  const normalized = sqlType.toUpperCase();

  if (/^(VARCHAR|CHAR|TEXT|STRING|NVARCHAR)/.test(normalized)) return "text";
  if (/^(INT|INTEGER|BIGINT|SMALLINT|TINYINT)/.test(normalized)) return "integer";
  if (/^(DECIMAL|NUMERIC|NUMBER)/.test(normalized)) return "decimal";
  if (/^(REAL|FLOAT|DOUBLE)/.test(normalized)) return "float";
  if (/^(BOOL|BOOLEAN)/.test(normalized)) return "boolean";
  if (/^DATE$/.test(normalized)) return "date";
  if (/^TIME$/.test(normalized)) return "time";
  if (/^(DATETIME|TIMESTAMP)/.test(normalized)) return "datetime";
  if (/^(BLOB|BINARY|BYTEA)/.test(normalized)) return "binary";
  if (normalized.startsWith("UUID")) return "uuid";
  return "other";
}

/**
 * Convert snake_case to PascalCase.
 */
function toPascalCase(str: string): string {
  return str
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join("");
}

/**
 * Build an ORM model from extracted SQL patterns.
 */
function buildModelFromPatterns(
  patterns: readonly SqlPatternContext[],
  modelName: string,
  warnings: string[],
): OrmModel {
  const model = new OrmModel({ name: modelName });

  // Collect all table names from patterns
  const tableNames = new Set<string>();
  for (const p of patterns) {
    if (p.tables) {
      for (const t of p.tables) {
        tableNames.add(t);
      }
    }
  }

  // Create entity types for tables
  const entityMap = new Map<string, string>();
  for (const tableName of tableNames) {
    const entityName = toPascalCase(tableName);
    try {
      const entity = model.addObjectType({
        name: entityName,
        kind: "entity",
        referenceMode: `${tableName}_id`,
      });
      entityMap.set(tableName.toLowerCase(), entity.id);
    } catch {
      // Skip duplicates
    }
  }

  // Process JOIN patterns -> binary fact types between entities
  for (const p of patterns) {
    if (p.kind === "join" && p.tables && p.tables.length >= 2) {
      const table1 = p.tables[0]!;
      const table2 = p.tables[1]!;
      const entity1Id = entityMap.get(table1.toLowerCase());
      const entity2Id = entityMap.get(table2.toLowerCase());

      if (entity1Id && entity2Id) {
        const entity1 = model.getObjectType(entity1Id);
        const entity2 = model.getObjectType(entity2Id);
        if (entity1 && entity2) {
          const factName = `${entity1.name} references ${entity2.name}`;
          try {
            model.addFactType({
              name: factName,
              roles: [
                { name: "references", playerId: entity2Id },
                { name: "is referenced by", playerId: entity1Id },
              ],
              readings: [`{0} references {1}`],
            });
          } catch {
            // Skip duplicate fact types
          }
        }
      }
    }
  }

  // Process CHECK constraints with IN clauses -> value constraints
  for (const p of patterns) {
    if (p.kind === "check" && p.columns && p.columns.length > 0) {
      // Extract IN values from CHECK constraint
      const inMatch = /IN\s*\((.*?)\)/i.exec(p.sourceText);
      if (inMatch) {
        const values = inMatch[1]!
          .split(",")
          .map((v) => v.trim().replace(/^['"]|['"]$/g, ""))
          .filter((v) => v.length > 0);

        if (values.length > 0) {
          const colName = p.columns[0]!;
          const valueTypeName = toPascalCase(colName);

          // Find or create value type
          if (!model.getObjectTypeByName(valueTypeName)) {
            model.addObjectType({
              name: valueTypeName,
              kind: "value",
              dataType: { name: "text" },
            });
          }
        }
      }
    }
  }

  // Process CASE patterns -> potential value constraints
  for (const p of patterns) {
    if (p.kind === "case" && p.details?.values) {
      const values = p.details.values as string[];
      if (values.length > 0 && p.columns && p.columns.length > 0) {
        const colName = p.columns[0]!;
        warnings.push(
          `CASE branch on "${colName}" suggests value constraint: ${values.join(", ")}`,
        );
      }
    }
  }

  // Process FOREIGN KEY patterns -> relationships
  for (const p of patterns) {
    if (p.kind === "foreign_key" && p.tables && p.tables.length > 0) {
      const refTable = p.tables[0]!;
      const refEntityId = entityMap.get(refTable.toLowerCase());
      if (refEntityId) {
        warnings.push(
          `Foreign key references ${refTable} (${p.columns?.join(", ") ?? "unknown columns"})`,
        );
      }
    }
  }

  return model;
}

/**
 * SQL import format: parses raw SQL files into ORM models.
 *
 * Supports both single-file text input and directory input.
 */
export class SqlImportFormat implements ImportFormat {
  readonly name = "sql";
  readonly description = "Import ORM model from raw SQL files (DDL, migrations, queries)";
  readonly inputKind = "text" as const;

  /**
   * Parse a single SQL string (text input).
   */
  parse(input: string, options?: ImportOptions): ImportResult {
    const warnings: string[] = [];
    const modelName = options?.modelName ?? "SQL Import";
    const dialect = (options?.dialect as SqlDialect) ?? detectDialectFromHints(input) ?? "ansi";

    const fileResult = parseSqlFile(input, "input.sql", dialect);

    if (fileResult.patterns.length === 0) {
      warnings.push("No ORM-relevant patterns found in SQL input");
    }

    const model = buildModelFromPatterns(fileResult.patterns, modelName, warnings);

    return {
      model,
      warnings,
      confidence: fileResult.patterns.length > 0 ? "medium" : "low",
    };
  }

  /**
   * Parse a directory of SQL files (async input).
   */
  async parseAsync(input: string, options?: ImportOptions): Promise<ImportResult> {
    const dir = resolve(input);
    const warnings: string[] = [];
    const modelName = options?.modelName ?? "SQL Import";
    const explicitDialect = options?.dialect as SqlDialect | undefined;

    const sqlFiles = findSqlFiles(dir);
    if (sqlFiles.length === 0) {
      warnings.push(`No .sql files found under "${dir}"`);
      return {
        model: new OrmModel({ name: modelName }),
        warnings,
        confidence: "low",
      };
    }

    const allPatterns: SqlPatternContext[] = [];
    let detectedDialect: SqlDialect | undefined = explicitDialect;

    for (const filePath of sqlFiles) {
      try {
        const sql = readFileSync(filePath, "utf-8");

        // Detect dialect from first file if not already known
        if (!detectedDialect) {
          detectedDialect = detectDialectFromHints(sql);
        }

        const fileResult = parseSqlFile(sql, filePath, detectedDialect ?? "ansi");
        allPatterns.push(...fileResult.patterns);
      } catch (err) {
        warnings.push(
          `Failed to read "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (allPatterns.length === 0) {
      warnings.push(`Found ${sqlFiles.length} SQL file(s) but no ORM-relevant patterns`);
    }

    const model = buildModelFromPatterns(allPatterns, modelName, warnings);

    return {
      model,
      warnings,
      confidence: allPatterns.length > 0 ? "medium" : "low",
    };
  }
}
