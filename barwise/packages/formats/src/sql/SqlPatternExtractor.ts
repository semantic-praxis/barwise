/**
 * SQL pattern extractor.
 *
 * Extracts ORM-relevant patterns from SQL statements using
 * regex-based analysis. This is the "regex" level of the cascade,
 * which works without a JVM and handles common SQL patterns reliably.
 *
 * Patterns extracted:
 * - JOIN conditions (binary relationships between tables)
 * - WHERE predicates (constraints on values)
 * - CASE/WHEN branches (value constraints, state machines)
 * - CHECK constraints (explicit value constraints)
 * - UNIQUE constraints
 * - NOT NULL constraints
 * - FOREIGN KEY references
 * - DEFAULT values
 * - GROUP BY columns (potential uniqueness patterns)
 */

import type { ParseLevel, SqlPatternContext } from "./types.js";

/**
 * Extract ORM-relevant patterns from a SQL statement.
 *
 * @param sql - The SQL statement text
 * @param filePath - Source file path for provenance
 * @param startLine - Start line in the source file (1-based)
 * @param parseLevel - Which cascade level is calling this
 * @returns Array of extracted patterns
 */
export function extractSqlPatterns(
  sql: string,
  filePath: string,
  startLine: number,
  parseLevel: ParseLevel = "regex",
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];
  const endLine = startLine + sql.split("\n").length - 1;

  patterns.push(...extractJoins(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractWherePredicates(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractCaseBranches(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractCheckConstraints(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractUniqueConstraints(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractNotNullConstraints(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractForeignKeys(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractDefaults(sql, filePath, startLine, endLine, parseLevel));
  patterns.push(...extractGroupBy(sql, filePath, startLine, endLine, parseLevel));

  return patterns;
}

/**
 * Extract JOIN patterns.
 */
function extractJoins(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];
  // Match: [LEFT|RIGHT|INNER|OUTER|CROSS|FULL] JOIN table [AS alias] ON condition
  const joinRegex =
    /(?:LEFT\s+|RIGHT\s+|INNER\s+|OUTER\s+|CROSS\s+|FULL\s+(?:OUTER\s+)?)?JOIN\s+(\w+(?:\.\w+)*)\s+(?:(?:AS\s+)?(\w+)\s+)?ON\s+(.*?)(?=(?:\s+(?:LEFT|RIGHT|INNER|OUTER|CROSS|FULL)\s+|\s+JOIN\s+|\s+WHERE\s+|\s+GROUP\s+|\s+ORDER\s+|\s+HAVING\s+|\s+LIMIT\s+|\s+UNION\s+|\)|;|$))/gis;

  let match;
  while ((match = joinRegex.exec(sql)) !== null) {
    const table = match[1]!;
    const condition = match[3]!;

    // Extract table names from the ON condition
    const tables = [table];
    const onTables = condition.match(/(\w+)\.\w+/g);
    if (onTables) {
      for (const ref of onTables) {
        const tbl = ref.split(".")[0]!;
        if (!tables.includes(tbl)) {
          tables.push(tbl);
        }
      }
    }

    // Extract column names from the ON condition
    const columns: string[] = [];
    const colRefs = condition.match(/(?:\w+\.)?(\w+)\s*=/g);
    if (colRefs) {
      for (const ref of colRefs) {
        const col = ref.replace(/\s*=.*/, "").split(".").pop()!;
        if (!columns.includes(col)) {
          columns.push(col);
        }
      }
    }

    patterns.push({
      kind: "join",
      filePath,
      startLine,
      endLine,
      sourceText: match[0]!.trim(),
      tables,
      columns,
      parseLevel,
    });
  }

  return patterns;
}

/**
 * Extract WHERE predicate patterns.
 */
function extractWherePredicates(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  // Match WHERE clause (don't stop at parens -- IN (...) needs to be included)
  const whereMatch =
    /\bWHERE\s+(.*?)(?=\s+GROUP\s+BY|\s+ORDER\s+BY|\s+HAVING\s+|\s+LIMIT\s+|\s+UNION\s+|;|$)/gis
      .exec(
        sql,
      );
  if (!whereMatch) return patterns;

  const whereClause = whereMatch[1]!;

  // Extract IN (...) predicates (value constraints)
  const inRegex = /(\w+(?:\.\w+)?)\s+IN\s*\((.*?)\)/gi;
  let inMatch;
  while ((inMatch = inRegex.exec(whereClause)) !== null) {
    const column = inMatch[1]!.split(".").pop()!;
    patterns.push({
      kind: "where",
      filePath,
      startLine,
      endLine,
      sourceText: inMatch[0]!.trim(),
      columns: [column],
      parseLevel,
      details: { predicateType: "in" },
    });
  }

  // Extract IS NOT NULL predicates (mandatory constraints)
  const notNullRegex = /(\w+(?:\.\w+)?)\s+IS\s+NOT\s+NULL/gi;
  let notNullMatch;
  while ((notNullMatch = notNullRegex.exec(whereClause)) !== null) {
    const column = notNullMatch[1]!.split(".").pop()!;
    patterns.push({
      kind: "where",
      filePath,
      startLine,
      endLine,
      sourceText: notNullMatch[0]!.trim(),
      columns: [column],
      parseLevel,
      details: { predicateType: "is_not_null" },
    });
  }

  // Extract comparison predicates (=, <>, >, <, >=, <=)
  const compRegex = /(\w+(?:\.\w+)?)\s*(=|<>|!=|>=?|<=?)\s*('[^']*'|\d+(?:\.\d+)?)/gi;
  let compMatch;
  while ((compMatch = compRegex.exec(whereClause)) !== null) {
    const column = compMatch[1]!.split(".").pop()!;
    patterns.push({
      kind: "where",
      filePath,
      startLine,
      endLine,
      sourceText: compMatch[0]!.trim(),
      columns: [column],
      parseLevel,
      details: {
        predicateType: "comparison",
        operator: compMatch[2],
        value: compMatch[3],
      },
    });
  }

  // Extract BETWEEN predicates (range constraints)
  const betweenRegex = /(\w+(?:\.\w+)?)\s+BETWEEN\s+('?[\w.-]+'?)\s+AND\s+('?[\w.-]+'?)/gi;
  let betweenMatch;
  while ((betweenMatch = betweenRegex.exec(whereClause)) !== null) {
    const column = betweenMatch[1]!.split(".").pop()!;
    patterns.push({
      kind: "where",
      filePath,
      startLine,
      endLine,
      sourceText: betweenMatch[0]!.trim(),
      columns: [column],
      parseLevel,
      details: {
        predicateType: "between",
        lower: betweenMatch[2],
        upper: betweenMatch[3],
      },
    });
  }

  return patterns;
}

/**
 * Extract CASE/WHEN branch patterns.
 */
function extractCaseBranches(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  // Match CASE expressions
  const caseRegex = /CASE\s+(.*?)\s+END/gis;
  let caseMatch;
  while ((caseMatch = caseRegex.exec(sql)) !== null) {
    const caseBody = caseMatch[1]!;

    // Extract WHEN values (for simple CASE)
    const whenValues: string[] = [];
    const whenRegex = /WHEN\s+(?:'([^']*)'|(\w+))/gi;
    let whenMatch;
    while ((whenMatch = whenRegex.exec(caseBody)) !== null) {
      whenValues.push(whenMatch[1] ?? whenMatch[2]!);
    }

    // Try to identify the column being switched on
    const columns: string[] = [];
    const caseColMatch = /^(\w+(?:\.\w+)?)\s/i.exec(caseBody.trim());
    if (caseColMatch) {
      columns.push(caseColMatch[1]!.split(".").pop()!);
    }

    if (whenValues.length > 0) {
      patterns.push({
        kind: "case",
        filePath,
        startLine,
        endLine,
        sourceText: caseMatch[0]!.trim(),
        columns,
        parseLevel,
        details: { values: whenValues },
      });
    }
  }

  return patterns;
}

/**
 * Extract CHECK constraint patterns.
 */
function extractCheckConstraints(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  const checkRegex = /CHECK\s*\((.*?)\)/gis;
  let checkMatch;
  while ((checkMatch = checkRegex.exec(sql)) !== null) {
    const condition = checkMatch[1]!;

    // Extract column names
    const columns: string[] = [];
    const colRefs = condition.match(/\b([a-z]\w*)\b/gi);
    if (colRefs) {
      const sqlKeywords = new Set([
        "IN",
        "AND",
        "OR",
        "NOT",
        "NULL",
        "IS",
        "BETWEEN",
        "LIKE",
        "TRUE",
        "FALSE",
        "CHECK",
      ]);
      for (const ref of colRefs) {
        if (!sqlKeywords.has(ref.toUpperCase()) && !columns.includes(ref)) {
          columns.push(ref);
        }
      }
    }

    patterns.push({
      kind: "check",
      filePath,
      startLine,
      endLine,
      sourceText: checkMatch[0]!.trim(),
      columns,
      parseLevel,
    });
  }

  return patterns;
}

/**
 * Extract UNIQUE constraint patterns.
 */
function extractUniqueConstraints(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  // Table-level UNIQUE constraint
  const uniqueRegex = /UNIQUE\s*\(([^)]+)\)/gi;
  let uniqueMatch;
  while ((uniqueMatch = uniqueRegex.exec(sql)) !== null) {
    const columns = uniqueMatch[1]!
      .split(",")
      .map((c) => c.trim().replace(/"/g, ""))
      .filter((c) => c.length > 0);

    patterns.push({
      kind: "unique",
      filePath,
      startLine,
      endLine,
      sourceText: uniqueMatch[0]!.trim(),
      columns,
      parseLevel,
    });
  }

  // Inline UNIQUE on column definition (within CREATE TABLE body)
  const createBodyForUnique = /CREATE\s+TABLE\s+\w+(?:\.\w+)*\s*\((.*)\)/gis;
  let bodyMatchUnique;
  while ((bodyMatchUnique = createBodyForUnique.exec(sql)) !== null) {
    const body = bodyMatchUnique[1]!;
    const parts = body.split(",");
    for (const part of parts) {
      // Match column_name TYPE ... UNIQUE (but not table-level UNIQUE(cols))
      const colMatch = /^\s*(\w+)\s+\w+(?:\([^)]*\))?[^,]*\bUNIQUE\b/i.exec(part);
      if (colMatch && !/^\s*UNIQUE\s*\(/i.test(part)) {
        patterns.push({
          kind: "unique",
          filePath,
          startLine,
          endLine,
          sourceText: colMatch[0]!.trim(),
          columns: [colMatch[1]!],
          parseLevel,
        });
      }
    }
  }

  return patterns;
}

/**
 * Extract NOT NULL constraint patterns.
 */
function extractNotNullConstraints(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  // Column-level NOT NULL in CREATE TABLE column definitions.
  // First, extract the column-list body from CREATE TABLE, then match NOT NULL per column.
  const createBodyRegex = /CREATE\s+TABLE\s+\w+(?:\.\w+)*\s*\((.*)\)/gis;
  let bodyMatch;
  while ((bodyMatch = createBodyRegex.exec(sql)) !== null) {
    const body = bodyMatch[1]!;
    // Split by commas (simple split -- good enough for column defs)
    const parts = body.split(",");
    for (const part of parts) {
      const colMatch = /^\s*(\w+)\s+\w+(?:\([^)]*\))?.*\bNOT\s+NULL\b/i.exec(part);
      if (colMatch) {
        patterns.push({
          kind: "not_null",
          filePath,
          startLine,
          endLine,
          sourceText: colMatch[0]!.trim(),
          columns: [colMatch[1]!],
          parseLevel,
        });
      }
    }
  }

  // Also match standalone ALTER TABLE ... NOT NULL
  const alterNotNull = /ALTER\s+TABLE\s+\w+\s+ALTER\s+(?:COLUMN\s+)?(\w+)\s+SET\s+NOT\s+NULL/gi;
  let alterMatch;
  while ((alterMatch = alterNotNull.exec(sql)) !== null) {
    patterns.push({
      kind: "not_null",
      filePath,
      startLine,
      endLine,
      sourceText: alterMatch[0]!.trim(),
      columns: [alterMatch[1]!],
      parseLevel,
    });
  }

  return patterns;
}

/**
 * Extract FOREIGN KEY patterns.
 */
function extractForeignKeys(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  const fkRegex = /FOREIGN\s+KEY\s*\(([^)]+)\)\s*REFERENCES\s+(\w+(?:\.\w+)?)\s*\(([^)]+)\)/gi;
  let match;
  while ((match = fkRegex.exec(sql)) !== null) {
    const columns = match[1]!.split(",").map((c) => c.trim().replace(/"/g, ""));
    const refTable = match[2]!;
    const refColumns = match[3]!.split(",").map((c) => c.trim().replace(/"/g, ""));

    patterns.push({
      kind: "foreign_key",
      filePath,
      startLine,
      endLine,
      sourceText: match[0]!.trim(),
      tables: [refTable],
      columns,
      parseLevel,
      details: { referencedColumns: refColumns },
    });
  }

  return patterns;
}

/**
 * Extract DEFAULT value patterns.
 */
function extractDefaults(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  const defaultRegex = /(?:^|,|\()\s*(\w+)\s+\w+(?:\([^)]*\))?[^,)]*\bDEFAULT\s+('?[^,\n)']+'?)/gi;
  let match;
  while ((match = defaultRegex.exec(sql)) !== null) {
    patterns.push({
      kind: "default",
      filePath,
      startLine,
      endLine,
      sourceText: match[0]!.trim(),
      columns: [match[1]!],
      parseLevel,
      details: { defaultValue: match[2]!.trim() },
    });
  }

  return patterns;
}

/**
 * Extract GROUP BY patterns.
 */
function extractGroupBy(
  sql: string,
  filePath: string,
  startLine: number,
  endLine: number,
  parseLevel: ParseLevel,
): SqlPatternContext[] {
  const patterns: SqlPatternContext[] = [];

  const groupByMatch = /GROUP\s+BY\s+(.*?)(?=HAVING|ORDER\s+BY|LIMIT|UNION|\)|;|$)/gis.exec(
    sql,
  );
  if (!groupByMatch) return patterns;

  const groupByClause = groupByMatch[1]!;
  const columns = groupByClause
    .split(",")
    .map((c) => c.trim().split(".").pop()!)
    .filter((c) => c.length > 0 && !/^\d+$/.test(c));

  if (columns.length > 0) {
    patterns.push({
      kind: "group_by",
      filePath,
      startLine,
      endLine,
      sourceText: groupByMatch[0]!.trim(),
      columns,
      parseLevel,
    });
  }

  return patterns;
}

/**
 * Split a SQL file into individual statements.
 *
 * Handles semicolon-delimited statements, respecting string literals
 * and comments.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < sql.length; i++) {
    const char = sql[i]!;
    const next = sql[i + 1];

    // Handle comments
    if (!inSingleQuote && !inDoubleQuote) {
      if (inLineComment) {
        if (char === "\n") {
          inLineComment = false;
        }
        current += char;
        continue;
      }
      if (inBlockComment) {
        if (char === "*" && next === "/") {
          inBlockComment = false;
          current += "*/";
          i++;
          continue;
        }
        current += char;
        continue;
      }
      if (char === "-" && next === "-") {
        inLineComment = true;
        current += char;
        continue;
      }
      if (char === "/" && next === "*") {
        inBlockComment = true;
        current += char;
        continue;
      }
    }

    // Handle string literals
    if (!inBlockComment && !inLineComment) {
      if (char === "'" && !inDoubleQuote) {
        inSingleQuote = !inSingleQuote;
      } else if (char === '"' && !inSingleQuote) {
        inDoubleQuote = !inDoubleQuote;
      }
    }

    // Statement delimiter
    if (char === ";" && !inSingleQuote && !inDoubleQuote && !inBlockComment && !inLineComment) {
      const stmt = current.trim();
      if (stmt.length > 0) {
        statements.push(stmt);
      }
      current = "";
      continue;
    }

    current += char;
  }

  // Last statement (may not end with semicolon)
  const last = current.trim();
  if (last.length > 0) {
    statements.push(last);
  }

  return statements;
}
