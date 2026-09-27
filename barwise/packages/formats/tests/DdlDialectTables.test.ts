/**
 * The DDL importer reads CREATE TABLE as vendor dialects write it
 * (sql-import-reads-tables.spec.md, R1 to R3). It matched every name as
 * `"?(\w+)"?`, which read 0 tables from 13 of the enterprise trial's 14 DDL
 * files. Each form below is one of theirs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();
const entities = (sql: string) =>
  ddl.parse(sql).model.objectTypes.filter((o) => o.kind === "entity").map((o) => o.name).sort();

describe("R1: identifiers", () => {
  it.each([
    [
      "schema-qualified (Oracle, DB2)",
      "CREATE TABLE CBS.PARTY (PARTY_ID NUMBER(38) NOT NULL, PRIMARY KEY (PARTY_ID));",
    ],
    [
      "bracketed (SQL Server)",
      "CREATE TABLE CLARITY.[PARTY] ([PARTY_ID] NUMERIC(18,0) NOT NULL, PRIMARY KEY ([PARTY_ID]));",
    ],
    [
      "backticked (BigQuery, Databricks, MySQL)",
      "CREATE TABLE erp.sap.`PARTY` (`PARTY_ID` STRING NOT NULL, PRIMARY KEY (`PARTY_ID`));",
    ],
    [
      "double-quoted",
      'CREATE TABLE "sales"."party" ("party_id" INTEGER NOT NULL, PRIMARY KEY ("party_id"));',
    ],
    [
      "three-part (Snowflake)",
      "CREATE TABLE DB.CORE.PARTY (PARTY_ID VARCHAR NOT NULL, PRIMARY KEY (PARTY_ID));",
    ],
  ])("reads a %s table name and its key", (_, sql) => {
    const { model } = ddl.parse(sql);
    const party = model.getObjectTypeByName("Party");
    expect(party?.kind).toBe("entity");
    expect(party?.kind === "entity" ? party.referenceMode.toLowerCase() : undefined).toBe(
      "party_id",
    );
  });

  it("resolves a foreign key to a qualified, quoted target", () => {
    const sql = `
      CREATE TABLE CLARITY.[PATIENT] ([PAT_ID] INT NOT NULL, PRIMARY KEY ([PAT_ID]));
      CREATE TABLE CLARITY.[VISIT] (
        [VISIT_ID] INT NOT NULL,
        [PAT_ID] INT NOT NULL,
        PRIMARY KEY ([VISIT_ID]),
        CONSTRAINT [FK_VISIT_PAT] FOREIGN KEY ([PAT_ID]) REFERENCES CLARITY.[PATIENT] ([PAT_ID])
      );`;
    const { model } = ddl.parse(sql);
    const fts = model.factTypes.map((f) => f.name);
    expect(fts.some((n) => /Visit/.test(n) && /Patient/.test(n))).toBe(true);
  });
});

describe("R2: statement forms", () => {
  it.each([
    ["IF NOT EXISTS", "CREATE TABLE IF NOT EXISTS regmart.party (party_id uuid NOT NULL);"],
    ["OR REPLACE", "CREATE OR REPLACE TABLE MARKETPLACE.CORE.PARTY (PARTY_ID VARCHAR NOT NULL);"],
    ["TEMPORARY", "CREATE TEMPORARY TABLE party (party_id INT);"],
    [
      "table options after the body",
      "CREATE TABLE cis.`party` (`party_id` INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;",
    ],
    ["a partition clause", "CREATE TABLE party (party_id INT) PARTITION BY RANGE (party_id);"],
    ["no trailing semicolon", "CREATE TABLE party (party_id INT, PRIMARY KEY (party_id))"],
    [
      "comments inside the column list, as barwise's own export writes",
      "CREATE TABLE party (\n  -- the party (person or organisation); see PK)\n  party_id INT, /* ) */\n  PRIMARY KEY (party_id)\n);",
    ],
  ])("reads %s", (_, sql) => {
    expect(entities(sql)).toEqual(["Party"]);
  });

  it("reads two statements when only the second is terminated", () => {
    const sql = "CREATE TABLE party (party_id INT)\nCREATE TABLE site (site_id INT);";
    expect(entities(sql)).toEqual(["Party", "Site"]);
  });
});

describe("R3: nothing is dropped without a word", () => {
  it("names a table it cannot read, and counts the statements it does not import", () => {
    const sql = `
      CREATE TABLE tms.event (event_id INT NOT NULL);
      CREATE TABLE tms.event_2026 PARTITION OF tms.event FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
      CREATE INDEX idx_event ON tms.event (event_id);
      CREATE INDEX idx_event2 ON tms.event (event_id);
      ALTER TABLE tms.event ADD COLUMN note TEXT;`;
    const { warnings } = ddl.parse(sql);
    expect(warnings.some((w) => w.includes("tms.event_2026") && w.includes("not imported"))).toBe(
      true,
    );
    expect(warnings).toContain("Statements not imported: CREATE INDEX (2), ALTER TABLE (1).");
  });

  it("names a table whose name another schema already took", () => {
    const sql = "CREATE TABLE a.party (id INT); CREATE TABLE b.party (id INT);";
    const { model, warnings } = ddl.parse(sql);
    expect(model.objectTypes.filter((o) => o.name === "Party")).toHaveLength(1);
    expect(warnings.some((w) => w.includes('already imports as "Party"'))).toBe(true);
  });

  it("does not read a commented-out table", () => {
    expect(entities("-- CREATE TABLE ghost (id INT);\nCREATE TABLE party (id INT);")).toEqual([
      "Party",
    ]);
  });
});

describe("barwise-zuk's reproduction: four idioms in one file", () => {
  it("reads every table, where it read none and said the file had no CREATE TABLE", () => {
    const sql = readFileSync(new URL("fixtures/ddl-vendor-idioms.sql", import.meta.url), "utf8");
    const { model, warnings } = ddl.parse(sql);
    const names = model.objectTypes.filter((o) => o.kind === "entity").map((o) => o.name).sort();
    expect(names).toEqual(["Customers", "LineItems", "Orders", "PlainTbl"]);
    expect(warnings.some((w) => /No CREATE TABLE/.test(w))).toBe(false);
  });
});

describe("PR #577 review: what is not a statement, and what a skipped table keeps", () => {
  it("does not read a CREATE TABLE stored as data in a string literal", () => {
    const sql = "CREATE TABLE audit_log (id INT, note TEXT, PRIMARY KEY (id));\n"
      + "INSERT INTO audit_log (id, note) VALUES (1, 'CREATE TABLE ghost (id INT)');";
    expect(entities(sql)).toEqual(["AuditLog"]);
  });

  it("does not read a CREATE TABLE inside a dollar-quoted function body", () => {
    const sql =
      "CREATE FUNCTION f() RETURNS void AS $body$ CREATE TABLE ghost (id INT); $body$ LANGUAGE sql;\n"
      + "CREATE TABLE real_table (id INT, PRIMARY KEY (id));";
    expect(entities(sql)).toEqual(["RealTable"]);
  });

  it("does not take a -- inside a string literal for a comment", () => {
    const sql =
      "CREATE TABLE party (party_id INT, sep VARCHAR(2) DEFAULT '--', PRIMARY KEY (party_id));";
    expect(entities(sql)).toEqual(["Party"]);
  });

  it("does not merge a skipped same-named table's columns into the one imported", () => {
    const sql = "CREATE TABLE a.party (party_id INT, PRIMARY KEY (party_id));\n"
      + "CREATE TABLE b.party (party_code INT, region TEXT, PRIMARY KEY (party_code));";
    const { model } = ddl.parse(sql);
    expect(model.getObjectTypeByName("Region")).toBeUndefined();
    expect(model.factTypes.some((f) => /Region|PartyCode/.test(f.name))).toBe(false);
  });
});
