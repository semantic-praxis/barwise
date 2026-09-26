/**
 * Reading SQL names and CREATE TABLE statements the way vendor dialects
 * write them (sql-import-reads-tables.spec.md, R1 to R3).
 *
 * The DDL importer matched every name as `"?(\w+)"?`. Measured over the
 * enterprise trial's fourteen DDL files, that read 30 of 30 tables from the
 * one ANSI file and 0 from each of the other thirteen: `CBS.PARTY`,
 * `CLARITY.[ZC_X]`, `IF NOT EXISTS regmart.party`, `CREATE OR REPLACE TABLE
 * MARKETPLACE.CORE.PARTY` and erp_bronze.sap.`MAT` all failed it.
 */

/**
 * One name part: bare, "double-quoted" (a doubled quote inside), [bracketed]
 * or `backticked`. Oracle and DB2 allow `$` and `#` in bare names.
 */
export const IDENT = String.raw`(?:"(?:[^"]|"")+"|\[[^\]]+\]|` + "`[^`]+`"
  + String.raw`|[A-Za-z_][\w$#]*)`;

/** A name qualified by up to two dots: `table`, `schema.table`, `db.schema.table`. */
export const QUALIFIED = String.raw`${IDENT}(?:\s*\.\s*${IDENT}){0,2}`;

/** A name part without its quotes. */
export function unquote(part: string): string {
  const p = part.trim();
  if (p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1).replace(/""/g, '"');
  if ((p.startsWith("[") && p.endsWith("]")) || (p.startsWith("`") && p.endsWith("`"))) {
    return p.slice(1, -1);
  }
  return p;
}

/**
 * The last part of a qualified name, unquoted: what a table is called
 * once its schema is set aside. `CBS.PARTY` and `regmart.party` are
 * `PARTY` and `party`. Quotes are respected, so a dot inside `[a.b]` is
 * part of the name.
 */
export function lastPart(qualified: string): string {
  const parts = [...qualified.matchAll(new RegExp(IDENT, "g"))].map((m) => m[0]);
  return unquote(parts[parts.length - 1] ?? qualified);
}

/** A comma-separated list of names, each unquoted: `a, [b], `c``. */
export function identifierList(list: string): string[] {
  return [...list.matchAll(new RegExp(IDENT, "g"))].map((m) => unquote(m[0]));
}

/** A CREATE TABLE statement found in the input. */
export interface CreateTableStatement {
  /** The table's name as written, qualified and quoted. */
  readonly qualifiedName: string;
  /** The last part of the name, unquoted. */
  readonly name: string;
  /** What is between the definition's outer parentheses. */
  readonly body: string;
}

/**
 * `CREATE [OR REPLACE] [GLOBAL|LOCAL] [TEMP|TEMPORARY|TRANSIENT|EXTERNAL]
 * TABLE [IF NOT EXISTS] <name> (`. The body is found by balanced
 * parentheses from here, not by the first `);`, so table options after
 * the definition (`ENGINE=`, `PARTITION BY`, `WITH (...)`) are left out.
 */
const CREATE_TABLE = new RegExp(
  String.raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?`
    + String.raw`(?:(?:TEMP|TEMPORARY|TRANSIENT|EXTERNAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`
    + `(${QUALIFIED})\\s*\\(`,
  "gi",
);

/** Any CREATE ... TABLE, readable or not: what R3 counts against. */
const ANY_CREATE_TABLE =
  /\bCREATE\s+(?:[A-Z]+\s+){0,3}?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(;]+)/gi;

/**
 * Every readable CREATE TABLE in the input, and the ones that are not:
 * a `CREATE TABLE x AS SELECT`, or a definition whose parentheses never
 * close, is named in `unread` rather than dropped.
 */
export function findCreateTables(input: string): {
  readonly tables: readonly CreateTableStatement[];
  readonly unread: readonly string[];
} {
  const code = blankComments(input);
  const tables: CreateTableStatement[] = [];
  const readAt = new Set<number>();
  for (const m of code.matchAll(CREATE_TABLE)) {
    const open = m.index! + m[0].length - 1;
    const close = matchingParen(code, open);
    if (close < 0) continue;
    readAt.add(m.index!);
    tables.push({
      qualifiedName: m[1]!,
      name: lastPart(m[1]!),
      body: input.slice(open + 1, close),
    });
  }
  const unread = [...code.matchAll(ANY_CREATE_TABLE)]
    .filter((m) => !readAt.has(m.index!))
    .map((m) => m[1]!);
  return { tables, unread };
}

/**
 * The statements the DDL importer does not read, counted by kind:
 * `CREATE INDEX`, `ALTER TABLE`, `CREATE VIEW` and the like. R3: they are
 * named in one warning rather than skipped without a word.
 */
export function otherStatements(input: string): Map<string, number> {
  const counts = new Map<string, number>();
  const kinds =
    /(?:^|;)\s*(CREATE\s+(?:OR\s+REPLACE\s+)?(?:UNIQUE\s+)?(?:INDEX|VIEW|SCHEMA|SEQUENCE|TRIGGER|PROCEDURE|FUNCTION|MATERIALIZED\s+VIEW|TYPE|DATABASE)|ALTER\s+TABLE|COMMENT\s+ON|INSERT\s+INTO|GRANT|DROP\s+\w+)\b/gim;
  for (const m of blankComments(input).matchAll(kinds)) {
    const kind = m[1]!.toUpperCase().replace(/\s+/g, " ").replace(/^CREATE OR REPLACE /, "CREATE ");
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}

/**
 * The index of the `)` closing the `(` at `open`, or -1. Parentheses inside
 * a string literal or a quoted name do not count.
 */
function matchingParen(text: string, open: number): number {
  let depth = 0;
  let quote: string | null = null;
  for (let i = open; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === "`") quote = c;
    else if (c === "[") quote = "]";
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

/**
 * The input with `--` and `/* ... *\/` comments replaced by spaces, so a
 * commented-out statement is not read and offsets still line up.
 */
function blankComments(input: string): string {
  return input.replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}
