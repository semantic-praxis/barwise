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
 * @returns {{ text: string, manifest: object }}
 */
export function generateDdl(doc, skin, { factor = 1, seed = 1, artifactId = "ddl" } = {}) {
  const dialect = skin.dialect ?? "ansi";
  const types = { ...(TYPE_MAPS[dialect] ?? TYPE_MAPS.ansi), ...(skin.types ?? {}) };
  const naming = skin.naming ?? {};
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

  const ident = (raw, isTable) => {
    let n = naming.abbreviate ? abbreviate(raw, naming.abbreviations) : raw;
    n = caseName(n, isTable ? naming.table_case : naming.column_case);
    if (isTable && naming.table_prefix) n = `${naming.table_prefix}${n}`;
    return truncate(n, naming.max_identifier);
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
        const cname = ident(col.name, false);
        colNames.push(cname);
        let type;
        if (col.ref) type = types.id;
        else type = valueSqlType(col, types);
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
        if (col.ref) {
          const refName = tname(col.ref);
          const refCol = ident(col.ref.pk[0] ?? `${columnName(col.ref.entity)}_id`, false);
          fks.push({ column: cname, ref: refName, refColumn: refCol });
        }
      }
      const pkCols = t.pk.map((c) => ident(c, false));
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
      if (!idioms.no_foreign_keys) {
        for (const fk of fks) {
          constraints.push(
            `  FOREIGN KEY (${q(fk.column)}) REFERENCES ${schema}${q(fk.ref)} (${q(fk.refColumn)})`,
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
  for (const extra of skin.extra_tables ?? []) {
    const m = /CREATE\s+(?:OR\s+REPLACE\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)/i.exec(
      extra,
    );
    const rawName = m
      ? m[1].split(".").pop().replace(/[`"\[\]]/g, "")
      : `extra_${manifest.tables.length}`;
    lines.push(extra.trim().replace(/;?\s*$/, "") + ";", "");
    manifest.tables.push({
      name: rawName,
      kind: "extra",
      columns: [],
      pk: [],
      fks: [],
      importable: true,
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
