/**
 * SQL import format.
 *
 * Parses raw SQL files (DDL, migrations, queries) into ORM models.
 * Supports both single-file (text) and directory (async) input.
 *
 * Tables come from the CREATE TABLE statements the input declares, read
 * by the DDL importer; the cascade's mined patterns (joins, CHECK, CASE)
 * are reported on top. Only input that declares no table at all -- a
 * file of queries -- builds its entities from the tables the patterns
 * mention. The importer used to do that for every input, so a schema's
 * tables became the targets of its foreign keys and every other table
 * was dropped without a word (sql-import-reads-tables.spec.md,
 * barwise-jjd).
 */

import { type ImportFormat, type ImportOptions, type ImportResult, OrmModel } from "@barwise/core";
import {
  parseSqlFile,
  SQL_DIALECTS,
  type SqlDialect,
  type SqlPatternContext,
} from "@barwise/core/sql";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DdlImportFormat } from "../ddl/DdlImportFormat.js";
import { findCreateTables } from "../ddl/sqlIdentifiers.js";
import { normalizeCascadeResult, parseSqlWithSqlglot } from "./SqlglotBridge.js";

/**
 * The explicit dialect, refused when barwise does not support it, the way
 * `export --dialect` refuses one. It used to be accepted silently, so
 * Oracle, DB2 and SQL Server imports read as ANSI with no word said
 * (sql-import-reads-tables.spec.md, R5).
 */
function explicitDialect(options?: ImportOptions): SqlDialect | undefined {
  const dialect = options?.dialect;
  if (dialect === undefined) return undefined;
  if (!(SQL_DIALECTS as readonly unknown[]).includes(dialect)) {
    throw new Error(
      `SQL dialect "${String(dialect)}" is not supported. Supported dialects: ${
        SQL_DIALECTS.join(", ")
      }.`,
    );
  }
  return dialect as SqlDialect;
}

/**
 * Build the model from the SQL: the declared tables through the DDL
 * importer when there are any, otherwise the tables the patterns mention.
 */
function buildModel(
  sql: string,
  patterns: readonly SqlPatternContext[],
  modelName: string,
  warnings: string[],
  inferReferences: boolean,
): OrmModel {
  // A CREATE TABLE the reader cannot parse (PARTITION OF, AS SELECT) still
  // declares a table: the DDL importer names it, where pattern mining would
  // drop it without a word (PR #577 review).
  const declared = findCreateTables(sql);
  if (declared.tables.length === 0 && declared.unread.length === 0) {
    return buildModelFromPatterns(patterns, modelName, warnings);
  }
  const ddl = new DdlImportFormat().parse(sql, { modelName, inferReferences });
  warnings.push(...ddl.warnings);
  mergePatterns(ddl.model, patterns, warnings);
  return ddl.model;
}

/**
 * Merge the mined patterns into a model built from declared tables. A join
 * between two declared tables that no foreign key already relates adds the
 * same "references" fact type pattern mining would, and says so -- the
 * declared path used to only report patterns, so a relationship a query
 * showed was lost (PR #577 review). A table only a query mentions was
 * never declared, so it is named rather than invented (R4).
 */
function mergePatterns(
  model: OrmModel,
  patterns: readonly SqlPatternContext[],
  warnings: string[],
): void {
  const entityFor = (table: string) =>
    model.getObjectTypeByName(toPascalCase(table.split(".").pop()!))?.id;
  // A join pattern's first table is the joined table. The other side is
  // not in `tables` on every tier -- sqlglot reports only the joined table,
  // the regex tier adds the ON clause's qualifiers -- so it is read from
  // the ON clause itself. A qualifier is often an alias (`c`, `o`) neither
  // tier resolves; only one that names a declared table completes the pair,
  // so an aliased join adds nothing rather than a guess.
  const pairFor = (p: SqlPatternContext): [string, string] | undefined => {
    const joined = p.tables?.[0] ? entityFor(p.tables[0]) : undefined;
    const qualifiers = [...p.sourceText.matchAll(/([A-Za-z_][\w$]*)\s*\.\s*[A-Za-z_"`[]/g)]
      .map((m) => m[1]!);
    const other = qualifiers.map(entityFor).find((id) => id && id !== joined);
    if (!joined || !other) return undefined;
    // The table whose key is the join column is the one referenced.
    const keyedByJoin = (id: string) => {
      const ot = model.getObjectType(id);
      const mode = ot?.kind === "entity" ? ot.referenceMode.toLowerCase() : undefined;
      return (p.columns ?? []).some((c) => c.toLowerCase() === mode);
    };
    return keyedByJoin(joined) && !keyedByJoin(other) ? [other, joined] : [joined, other];
  };
  for (const name of addJoinFactTypes(model, patterns, pairFor, { skipRelated: true })) {
    warnings.push(`A query joins tables no foreign key relates; added "${name}".`);
  }
  const undeclared = new Set<string>();
  for (const p of patterns) {
    const named = p.kind === "join" ? (p.tables ?? []).slice(0, 1) : (p.tables ?? []);
    for (const t of named) if (!entityFor(t)) undeclared.add(t);
    if (p.kind === "case" && p.details?.values && p.columns?.length) {
      const values = p.details.values as string[];
      warnings.push(
        `CASE branch on "${p.columns[0]}" suggests value constraint: ${values.join(", ")}`,
      );
    }
  }
  if (undeclared.size > 0) {
    warnings.push(
      `Tables the SQL mentions but never declares, not imported: ${
        [...undeclared].sort().join(", ")
      }.`,
    );
  }
}

/**
 * A binary "references" fact type for each JOIN whose pair of entities
 * `pairFor` resolves, the first referencing the second. With
 * `skipRelated`, a pair some fact type already relates is left alone: on
 * the declared path that is the foreign key. Returns the names added.
 */
function addJoinFactTypes(
  model: OrmModel,
  patterns: readonly SqlPatternContext[],
  pairFor: (p: SqlPatternContext) => [string, string] | undefined,
  { skipRelated = false } = {},
): string[] {
  const added: string[] = [];
  for (const p of patterns) {
    if (p.kind !== "join") continue;
    const pair = pairFor(p);
    if (!pair) continue;
    const [entity1Id, entity2Id] = pair;
    const entity1 = model.getObjectType(entity1Id);
    const entity2 = model.getObjectType(entity2Id);
    if (!entity1 || !entity2) continue;
    if (
      skipRelated
      && model.factTypes.some((ft) =>
        ft.roles.some((r) => r.playerId === entity1Id)
        && ft.roles.some((r) => r.playerId === entity2Id)
      )
    ) continue;
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
      added.push(factName);
    } catch {
      // Skip duplicate fact types
    }
  }
  return added;
}

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
  addJoinFactTypes(model, patterns, (p) => {
    if (!p.tables || p.tables.length < 2) return undefined;
    const id1 = entityMap.get(p.tables![0]!.toLowerCase());
    const id2 = entityMap.get(p.tables![1]!.toLowerCase());
    return id1 && id2 ? [id1, id2] : undefined;
  });

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
    const dialect = explicitDialect(options) ?? detectDialectFromHints(input) ?? "ansi";

    const fileResult = parseSqlWithSqlglot(input, "input.sql", dialect)
      ?? normalizeCascadeResult(parseSqlFile(input, "input.sql", dialect));

    const model = buildModel(
      input,
      fileResult.patterns,
      modelName,
      warnings,
      options?.["inferReferences"] === true,
    );
    if (model.objectTypes.length === 0 && fileResult.patterns.length === 0) {
      warnings.push("No ORM-relevant patterns found in SQL input");
    }

    return {
      model,
      warnings,
      confidence: model.objectTypes.length > 0 ? "medium" : "low",
    };
  }

  /**
   * Parse a directory of SQL files (async input).
   */
  async parseAsync(input: string, options?: ImportOptions): Promise<ImportResult> {
    const dir = resolve(input);
    const warnings: string[] = [];
    const modelName = options?.modelName ?? "SQL Import";
    const dialectOption = explicitDialect(options);

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
    let detectedDialect: SqlDialect | undefined = dialectOption;
    const sources: string[] = [];

    for (const filePath of sqlFiles) {
      try {
        const sql = readFileSync(filePath, "utf-8");
        sources.push(sql);

        // Detect dialect from first file if not already known
        if (!detectedDialect) {
          detectedDialect = detectDialectFromHints(sql);
        }

        const fileResult = parseSqlWithSqlglot(sql, filePath, detectedDialect ?? "ansi")
          ?? normalizeCascadeResult(parseSqlFile(sql, filePath, detectedDialect ?? "ansi"));
        allPatterns.push(...fileResult.patterns);
      } catch (err) {
        warnings.push(
          `Failed to read "${filePath}": ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // Every file's CREATE TABLEs are read together, so a foreign key in
    // one file finds its target table in another.
    const model = buildModel(
      sources.join("\n;\n"),
      allPatterns,
      modelName,
      warnings,
      options?.["inferReferences"] === true,
    );
    if (model.objectTypes.length === 0 && allPatterns.length === 0) {
      warnings.push(`Found ${sqlFiles.length} SQL file(s) but no ORM-relevant patterns`);
    }

    return {
      model,
      warnings,
      confidence: model.objectTypes.length > 0 ? "medium" : "low",
    };
  }
}
