/**
 * Kernel + skin + tier -> a vendor-idiom DDL file and its ground truth.
 *
 * The generator is independent of barwise's own DDL exporter on purpose:
 * an input produced by the product's exporter is an input the importer
 * was written against. Real customers bring schemas written by a
 * vendor's tooling twenty years ago, and the skin is where that idiom
 * lives (naming, quoting, type names, the statements around the tables).
 *
 * Amplification: tier factor k replicates the kernel's tables into k
 * modules with distinct names, so a 40-entity kernel becomes a
 * 1,200-table schema at k = 30. Every module is the same shape, which
 * is why the skin's `extra_tables` exist: they are the hand-written
 * irregularity the amplifier cannot invent.
 */
import { columnName, relationalView, tableName } from "../model.mjs";
import { hashSeed, prng } from "../prng.mjs";

/**
 * The CREATE TABLE modifiers the importer reads, up to the table name. A
 * byte-identical copy of `CREATE_TABLE_PREFIX` in
 * `packages/formats/src/ddl/sqlIdentifiers.ts`: the lane never imports a
 * package, so the pair is registered in `parity.manifest.json` instead.
 */
const CREATE_TABLE_PREFIX = String
  .raw`\bCREATE\s+(?:OR\s+REPLACE\s+)?(?:(?:GLOBAL|LOCAL)\s+)?(?:(?:TEMP|TEMPORARY|TRANSIENT|EXTERNAL)\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`;

const TYPE_MAPS = {
  ansi: {
    text: "VARCHAR(255)",
    integer: "INTEGER",
    decimal: "DECIMAL(18,2)",
    date: "DATE",
    datetime: "TIMESTAMP",
    boolean: "BOOLEAN",
    id: "VARCHAR(64)",
  },
  postgres: {
    text: "text",
    integer: "integer",
    decimal: "numeric(18,2)",
    date: "date",
    datetime: "timestamptz",
    boolean: "boolean",
    id: "uuid",
  },
  mysql: {
    text: "VARCHAR(255)",
    integer: "INT",
    decimal: "DECIMAL(18,2)",
    date: "DATE",
    datetime: "DATETIME",
    boolean: "TINYINT(1)",
    id: "INT UNSIGNED",
  },
  snowflake: {
    text: "VARCHAR",
    integer: "NUMBER(38,0)",
    decimal: "NUMBER(18,2)",
    date: "DATE",
    datetime: "TIMESTAMP_NTZ",
    boolean: "BOOLEAN",
    id: "VARCHAR",
  },
  bigquery: {
    text: "STRING",
    integer: "INT64",
    decimal: "NUMERIC",
    date: "DATE",
    datetime: "TIMESTAMP",
    boolean: "BOOL",
    id: "STRING",
  },
  redshift: {
    text: "VARCHAR(256)",
    integer: "INTEGER",
    decimal: "DECIMAL(18,2)",
    date: "DATE",
    datetime: "TIMESTAMP",
    boolean: "BOOLEAN",
    id: "VARCHAR(64)",
  },
  databricks: {
    text: "STRING",
    integer: "INT",
    decimal: "DECIMAL(18,2)",
    date: "DATE",
    datetime: "TIMESTAMP",
    boolean: "BOOLEAN",
    id: "STRING",
  },
  sqlserver: {
    text: "NVARCHAR(255)",
    integer: "INT",
    decimal: "DECIMAL(18,2)",
    date: "DATE",
    datetime: "DATETIME2",
    boolean: "BIT",
    id: "INT",
  },
  oracle: {
    text: "VARCHAR2(255)",
    integer: "NUMBER(38)",
    decimal: "NUMBER(18,2)",
    date: "DATE",
    datetime: "TIMESTAMP",
    boolean: "NUMBER(1)",
    id: "NUMBER(38)",
  },
  db2: {
    text: "VARCHAR(255)",
    integer: "INTEGER",
    decimal: "DECIMAL(11,2)",
    date: "DATE",
    datetime: "TIMESTAMP",
    boolean: "CHAR(1)",
    id: "INTEGER",
  },
};

const QUOTES = { none: ["", ""], double: ['"', '"'], brackets: ["[", "]"], backticks: ["`", "`"] };

function caseName(name, style) {
  const snake = columnName(name);
  switch (style) {
    case "upper":
      return snake.toUpperCase();
    case "pascal":
      return snake.split("_").map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join("");
    case "lower":
    case "snake":
    default:
      return snake;
  }
}

function abbreviate(name, dict) {
  let out = name;
  for (const [long, short] of Object.entries(dict ?? {})) {
    out = out.replace(new RegExp(long, "gi"), short);
  }
  return out;
}

function truncate(name, max) {
  if (!max || name.length <= max) return name;
  return name.slice(0, max);
}

function valueSqlType(col, types) {
  const dt = col.valueType?.data_type?.name
    ?? (col.valueType?.name?.toLowerCase().includes("date") ? "date" : "text");
  const key = dt === "text" && (col.valueType?.name ?? "").endsWith("Id") ? "id" : dt;
  return types[key] ?? types.text;
}

/**
 * A skin's spelling of a table or column name: its abbreviations, case,
 * table prefix and identifier limit, in that order. One owner for the
 * generator, which writes these names, and the acceptance grader, which
 * maps an import's names back through them (trial-skin-name-mapping.spec.md):
 * a second copy that drifted would grade a name the artifact never wrote.
 */
export function skinNamer(skin) {
  const naming = skin?.naming ?? {};
  const spell = (raw, isTable) => {
    let n = naming.abbreviate ? abbreviate(raw, naming.abbreviations) : raw;
    n = caseName(n, isTable ? naming.table_case : naming.column_case);
    if (isTable && naming.table_prefix) n = `${naming.table_prefix}${n}`;
    return truncate(n, naming.max_identifier);
  };
  return { table: (raw) => spell(raw, true), column: (raw) => spell(raw, false) };
}

/**
 * @returns {{ text: string, manifest: object }}
 */
export function generateDdl(doc, skin, { factor = 1, seed = 1, artifactId = "ddl" } = {}) {
  const dialect = skin.dialect ?? "ansi";
  const types = { ...(TYPE_MAPS[dialect] ?? TYPE_MAPS.ansi), ...(skin.types ?? {}) };
  const idioms = skin.idioms ?? {};
  const [ql, qr] = QUOTES[idioms.quoting ?? "none"] ?? QUOTES.none;
  const q = (s) => `${ql}${s}${qr}`;
  const schema = idioms.schema_qualified
    ? (idioms.schema_qualified === true ? "app." : idioms.schema_qualified)
    : "";
  const rnd = prng(hashSeed(`${artifactId}:${seed}`));
  const base = relationalView(doc);
  const lines = [];
  const manifest = { artifact: artifactId, generator: "ddl", dialect, factor, tables: [] };
  let stmt = 0;

  const namer = skinNamer(skin);
  const ident = (raw, isTable) => (isTable ? namer.table(raw) : namer.column(raw));
  // The column a reference column points at, and the type it therefore has:
  // a column of a composite reference names its key column, and takes that
  // column's type, which may be a value's (C01's AdmissionDateTime).
  const referencedColumn = (col) =>
    col.refColumn ?? col.ref.pk[0] ?? `${columnName(col.ref.entity)}_id`;
  // Each table's column identifiers, held apart after the skin's naming.
  // relationalView names no two columns alike, but a skin's truncation can:
  // C12 cuts to 8 characters, so supersedes_determination_case_id and its
  // two siblings are all SUPERSED. A mainframe schema tool numbers the
  // tail (SUPERSE2, SUPERSE3), and so does this. Settled before any table
  // is written, since a reference in one table names another's columns.
  const max = skin.naming?.max_identifier;
  const columnIdents = new Map();
  for (const t of base) {
    const spelled = new Map();
    const used = new Set();
    for (const col of t.columns) {
      const stem = ident(col.name, false);
      let id = stem;
      for (let n = 2; used.has(id.toLowerCase()); n++) {
        id = (max ? stem.slice(0, max - String(n).length) : stem) + n;
      }
      used.add(id.toLowerCase());
      spelled.set(col.name, id);
    }
    columnIdents.set(t, spelled);
  }
  const colIdent = (t, name) => columnIdents.get(t)?.get(name) ?? ident(name, false);
  const columnType = (col) => {
    if (!col.ref) return valueSqlType(col, types);
    if (!col.refColumn) return types.id;
    const target = col.ref.columns.find((c) => c.name === col.refColumn);
    return target ? columnType(target) : types.id;
  };

  const emit = (sql, meta) => {
    stmt++;
    const dropSemi = idioms.missing_semicolon_every && stmt % idioms.missing_semicolon_every === 0;
    if (idioms.comments && rnd.chance(0.3)) lines.push(`-- ${rnd.pick(COMMENTS)}`);
    if (idioms.comments && rnd.chance(0.1)) lines.push(`/* ${rnd.pick(COMMENTS)} */`);
    lines.push(sql + (dropSemi ? "" : ";"), "");
    if (meta) manifest.tables.push({ ...meta, semicolon: !dropSemi });
  };

  if (idioms.preamble) lines.push(idioms.preamble, "");

  for (let m = 0; m < factor; m++) {
    const suffix = m === 0 ? "" : `_${m + 1}`;
    const tname = (t) => ident(`${tableName(t)}${suffix}`, true);
    // Lookup tables for value constraints, once per module.
    const lookups = new Map();
    if (idioms.lookup_tables) {
      for (const t of base) {
        for (const col of t.columns) {
          if (col.check && !lookups.has(col.valueType.name)) {
            const lname = ident(`${idioms.lookup_tables}${col.valueType.name}${suffix}`, true)
              .replace(/^(\w+?)_?/, (s) => s);
            lookups.set(col.valueType.name, lname);
            const codeCol = ident(`${col.valueType.name}_c`, false);
            const sql = `CREATE TABLE ${schema}${q(lname)} (\n  ${
              q(codeCol)
            } ${types.integer} NOT NULL,\n  ${
              q(ident("name", false))
            } ${types.text} NULL,\n  PRIMARY KEY (${q(codeCol)})\n)`;
            emit(sql, {
              name: lname,
              kind: "lookup",
              columns: [codeCol, ident("name", false)],
              pk: [codeCol],
              fks: [],
              importable: true,
            });
          }
        }
      }
    }
    for (const t of base) {
      const name = tname(t);
      const cols = [];
      const colNames = [];
      const fks = [];
      const checks = [];
      for (const col of t.columns) {
        const cname = colIdent(t, col.name);
        colNames.push(cname);
        const type = columnType(col);
        const isPk = t.pk.includes(col.name);
        const nullness = isPk || !col.nullable
          ? "NOT NULL"
          : (dialect === "sqlserver" || dialect === "oracle" ? "NULL" : "");
        const inlinePk = idioms.inline_pk && isPk && t.pk.length === 1 ? " PRIMARY KEY" : "";
        cols.push(`  ${q(cname)} ${type} ${nullness}${inlinePk}`.replace(/\s+$/, ""));
        if (col.check && idioms.check_constraints && !lookups.has(col.valueType.name)) {
          const vals = col.check.slice(0, 12).map((v) => `'${String(v).replace(/'/g, "''")}'`).join(
            ", ",
          );
          checks.push(`  CHECK (${q(cname)} IN (${vals}))`);
        }
      }
      // One FOREIGN KEY per reference, with as many columns as the table it
      // references has key columns: an objectification is keyed on its roles
      // (trial-generator-objectification.spec.md).
      for (const fk of t.fks) {
        const cols = fk.columns.map((n) => t.columns.find((c) => c.name === n));
        fks.push({
          columns: cols.map((c) => colIdent(t, c.name)),
          ref: tname(fk.ref),
          refColumns: cols.map((c) => colIdent(c.ref, referencedColumn(c))),
        });
      }
      const pkCols = t.pk.map((c) => colIdent(t, c));
      const constraints = [];
      if (!(idioms.inline_pk && pkCols.length === 1) && pkCols.length) {
        constraints.push(
          `  ${
            idioms.named_constraints
              ? `CONSTRAINT ${q(ident(`pk_${tableName(t)}${suffix}`, true))} `
              : ""
          }PRIMARY KEY (${pkCols.map(q).join(", ")})`,
        );
      }
      // A skin whose schemas leave multi-column uniqueness to the application
      // says so with `no_unique_constraints`. BigQuery has no UNIQUE
      // constraint at all, so its tables never carry one (PR #601 review).
      if (!idioms.no_unique_constraints && dialect !== "bigquery") {
        for (const u of t.uniques ?? []) {
          constraints.push(`  UNIQUE (${u.map((c) => q(colIdent(t, c))).join(", ")})`);
        }
      }
      if (!idioms.no_foreign_keys) {
        for (const fk of fks) {
          constraints.push(
            `  FOREIGN KEY (${fk.columns.map(q).join(", ")}) REFERENCES ${schema}${q(fk.ref)} (${
              fk.refColumns.map(q).join(", ")
            })`,
          );
        }
      }
      const body = [...cols, ...checks, ...constraints].join(",\n");
      const create = idioms.create_or_replace
        ? "CREATE OR REPLACE TABLE"
        : idioms.if_not_exists
        ? "CREATE TABLE IF NOT EXISTS"
        : "CREATE TABLE";
      let sql = `${create} ${schema}${q(name)} (\n${body}\n)`;
      if (idioms.engine_suffix) sql += " ENGINE=InnoDB DEFAULT CHARSET=utf8mb4";
      if (idioms.table_suffix) sql += ` ${idioms.table_suffix}`;
      emit(sql, {
        name,
        kind: t.entity ? "entity" : "fact",
        source: t.entity ?? t.factType.name,
        module: m + 1,
        columns: colNames,
        pk: pkCols,
        fks: idioms.no_foreign_keys ? [] : fks,
        importable: true,
      });
      if (idioms.extension_tables && t.entity && pkCols.length) {
        for (const n of [2, 3]) {
          const ext = ident(`${tableName(t)}${suffix}_${n}`, true);
          const extCols = [`  ${q(pkCols[0])} ${types.id} NOT NULL`];
          for (let i = 0; i < 4; i++) {
            extCols.push(`  ${q(ident(`${tableName(t)}_x${n}_${i}`, false))} ${types.text} NULL`);
          }
          const sql2 = `CREATE TABLE ${schema}${q(ext)} (\n${
            extCols.join(",\n")
          },\n  PRIMARY KEY (${q(pkCols[0])})\n)`;
          emit(sql2, {
            name: ext,
            kind: "extension",
            source: t.entity,
            module: m + 1,
            columns: [pkCols[0]],
            pk: [pkCols[0]],
            fks: [{ column: pkCols[0], ref: name, refColumn: pkCols[0] }],
            importable: true,
          });
        }
      }
    }
  }
  const generated = new Set(manifest.tables.map((t) => t.name.toLowerCase()));
  for (const extra of skin.extra_tables ?? []) {
    // A statement that is not a CREATE TABLE -- a skin's CREATE TYPE -- is
    // context, not an expected entity. Both used to become `extra_N`, a name
    // no file contains, so the grader counted it as silently dropped whatever
    // the importer did (C04's TRANSIENT table, C06's two types).
    const m = new RegExp(String.raw`${CREATE_TABLE_PREFIX}([^\s(]+)`, "i").exec(extra);
    const rawName = m
      ? m[1].split(".").pop().replace(/[`"\[\]]/g, "")
      : `extra_${manifest.tables.length}`;
    // C10's skin added SPRIDEN, SFRSTCR and STVTERM beside the generated
    // tables of those names, so the file created each twice and the import
    // kept whichever came first (PR #611 review).
    if (m && generated.has(rawName.toLowerCase())) {
      throw new Error(
        `generateDdl: the skin's extra table ${rawName} has the name of a generated table`,
      );
    }
    lines.push(extra.trim().replace(/;?\s*$/, "") + ";", "");
    manifest.tables.push({
      name: rawName,
      kind: "extra",
      columns: [],
      pk: [],
      fks: [],
      importable: m !== null,
      semicolon: true,
    });
  }
  if (idioms.postamble) lines.push(idioms.postamble, "");
  const text = (idioms.bom ? "﻿" : "") + lines.join(idioms.crlf ? "\r\n" : "\n");
  manifest.statementCount = stmt + (skin.extra_tables?.length ?? 0);
  return { text, manifest };
}

const COMMENTS = [
  "generated by the vendor's schema tool; do not edit by hand",
  "TODO: ask DBA team why this column is nullable",
  "legacy: superseded in release 14.2 but still read by the nightly job",
  "added for the 2019 audit; see ticket 44127",
  "n.b. the FK is enforced in the application layer, not here",
];
