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
 * TABLE [IF NOT EXISTS]`, up to the name. The trial's DDL generator keeps
 * a byte-identical copy to name the tables it expects (it may not import a
 * package); `parity.manifest.json` fails CI when the two disagree, which is
 * how its ground truth once invented `extra_N` names (PR #577 review).
 */
const CREATE_TABLE_PREFIX = String
  .raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|TRANSIENT|EXTERNAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`;

/**
 * `<prefix> <name> (`. The body is found by balanced
 * parentheses from here, not by the first `);`, so table options after
 * the definition (`ENGINE=`, `PARTITION BY`, `WITH (...)`) are left out.
 */
const CREATE_TABLE = new RegExp(`${CREATE_TABLE_PREFIX}(${QUALIFIED})\\s*\\(`, "gi");

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
  const code = blankNonCode(input);
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
  for (const m of blankNonCode(input).matchAll(kinds)) {
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
 * The input with everything that is not SQL text blanked to spaces, offsets
 * kept: `--` and `/* ... *\/` comments, and the contents of string literals
 * (`'...'` with `''` escapes, and PostgreSQL `$tag$ ... $tag$` bodies). A
 * statement inside a comment or stored as data --
 * `VALUES ('CREATE TABLE ghost (id INT)')` -- is not a statement, and a `--`
 * inside a literal (`DEFAULT '--'`) is not a comment (PR #577 review). The
 * quotes themselves are kept, so `matchingParen` still sees a literal.
 * Quoted identifiers are skipped, not blanked: `"a--b"` is a name.
 */
function blankNonCode(input: string): string {
  const out = input.split("");
  const blank = (from: number, to: number) => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  let i = 0;
  while (i < input.length) {
    const c = input[i]!;
    const next = input[i + 1];
    if (c === "-" && next === "-") {
      const end = input.indexOf("\n", i);
      const stop = end < 0 ? input.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = input.indexOf("*/", i + 2);
      const stop = end < 0 ? input.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === "'") {
      let j = i + 1;
      while (j < input.length && !(input[j] === "'" && input[j + 1] !== "'")) {
        j += input[j] === "'" ? 2 : 1;
      }
      blank(i + 1, j);
      i = j + 1;
    } else if (c === "$" && DOLLAR_TAG.test(input.slice(i, i + 64))) {
      const tag = DOLLAR_TAG.exec(input.slice(i, i + 64))![0];
      const end = input.indexOf(tag, i + tag.length);
      blank(i + tag.length, end < 0 ? input.length : end);
      i = end < 0 ? input.length : end + tag.length;
    } else if (c === '"' || c === "`" || c === "[") {
      const end = input.indexOf(c === "[" ? "]" : c, i + 1);
      i = end < 0 ? input.length : end + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** A PostgreSQL dollar-quote opener: `$$` or `$body$`. */
const DOLLAR_TAG = /^\$[A-Za-z_]*\$/;
