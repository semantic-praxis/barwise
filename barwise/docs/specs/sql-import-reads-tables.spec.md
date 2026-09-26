# SQL import reads the tables a schema declares

Status: Implemented 2026-09-26 -- both workstreams; see Implementation notes

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-jjd

`barwise import sql schema.sql` exits 0, prints "Imported N object
types", and builds those object types from the names it finds in joins
and foreign keys. It never reads `CREATE TABLE`. A table no foreign key
points at is dropped without a word. The trial measured this over every
SQL customer. C02's regmart kept 10 of 18 tables, C05's ERP 15 of 33,
C03's policy system 13 of 37, and C07's BigQuery warehouse 0 of 38 with
no warning at all. `--dialect oracle`, `db2` and `sqlserver` are accepted
silently, while `export --dialect` refuses anything outside its seven.

The DDL importer (`import model --format ddl`) does read `CREATE TABLE`,
but only a bare, unquoted, unqualified name. Measured on the same
fourteen trial DDL files, it imports 30 of 30 tables from the one ANSI
file (C09) and 0 from each of the other thirteen:
`CBS.PARTY`, `CLARITY.[ZC_X]`, `IF NOT EXISTS regmart.party`,
`CREATE OR REPLACE TABLE MARKETPLACE.CORE.PARTY`, and
`` erp_bronze.sap.`MAT` `` all fail its `"?(\w+)"?` pattern.

After this change, both importers read every `CREATE TABLE` in those
files. `import sql` builds its entities from the tables the file
declares, and refuses a dialect it does not support.

## Principle

**Composability.** Reading a table definition is one capability, and
it lives in the DDL importer. `import sql` uses it instead of guessing
tables from joins, and adds what only query SQL carries (joins, CHECK
and CASE patterns) on top. The dbt importer already layers mined SQL on
a model the same way.

## Requirements

- **R1. Identifiers.** The DDL importer shall read an identifier that is
  bare, `"double-quoted"`, `[bracketed]` or `` `backticked` ``, and a
  name qualified by up to two dots, in every place a name appears: the
  table, a column, a key column list, and a foreign key's target table
  and columns. A table's entity is named from the last part of its
  qualified name, so `CBS.PARTY` and `regmart.party` both give `Party`.
- **R2. Statements.** The DDL importer shall read
  `CREATE [OR REPLACE] [GLOBAL | LOCAL] [TEMP | TEMPORARY | TRANSIENT |
  EXTERNAL] TABLE [IF NOT EXISTS] <name> ( ... )`, with the body found
  by balanced parentheses, and ignore table options after the closing
  parenthesis (`ENGINE=`, `PARTITION BY`, `CLUSTER BY`, `WITH (...)`).
- **R3. Nothing silently dropped.** A `CREATE TABLE` the importer finds
  but cannot read produces a warning naming the table. The statements
  it does not import at all are counted in one warning that names the
  statement kinds (for example `CREATE INDEX` and `ALTER TABLE`).
- **R4. `import sql` reads declared tables.** When the input declares
  tables, `import sql` shall build them through the DDL importer's
  reading (R1 to R3), so each declared table becomes an entity. A table
  that joins or foreign keys mention but the input never declares is
  reported by name, not invented. Input with no `CREATE TABLE` at all,
  such as a file of queries, keeps today's pattern mining.
- **R5. Dialects.** `import sql --dialect` shall refuse a value outside
  `SQL_DIALECTS`, with exit 1 and a message naming the dialect as
  unsupported and listing the supported ones, as `export` does.

## Scope

In: `DdlImportFormat` (identifier and statement reading),
`SqlImportFormat` (composition and dialect check), the CLI `import sql`
subcommand, the trial rows these retire, and the tests. Out: data type
mapping for vendor types (`VARCHAR2`, `NVARCHAR`, `NUMBER(38)`), which
is measured below and filed if it falls short; `ALTER TABLE ... ADD
CONSTRAINT`; composite keys (barwise-1077).

## Workstreams (each independently shippable)

### 1. The DDL importer reads dialect `CREATE TABLE` (R1 to R3)

One identifier reader, used everywhere a name is read, and a statement
scanner that finds the body by depth rather than by the first `);`.
Acceptance: the fourteen trial DDL files import every declared table
through `import model --format ddl`.

### 2. `import sql` builds on it, and checks the dialect (R4, R5)

`SqlImportFormat` runs the DDL importer over the input first, then
merges the mined patterns into that model. The dialect check sits in the
format, so every surface that reaches it (the CLI, MCP `import_model`)
refuses the same way. Acceptance: the jjd reproduction imports three
entities. `--dialect oracle` exits 1 naming the dialect. The trial rows
under barwise-jjd are retired or reclassified with the gate at 0 new,
0 stale.

## Risks and testing

- **Rows the fix uncovers.** Once tables import, later trial steps run
  on real content and can fail in new ways, as happened with bvl. They
  are classified through `gate --write`, not by hand.
- **Vendor data types.** Measured during WS1. If they fall back
  silently, that is filed rather than widened into this spec.
- **Name collisions.** Two schemas can declare the same table name. The
  importer's existing duplicate handling is kept, and the collision is
  reported.
- Tests: one per identifier form and statement form (R1, R2), one for
  the unread-statement warning (R3), the jjd reproduction (R4), and the
  refusal (R5). Each new test must fail against the importer before its
  change.

## Open decisions

None. The trial already specifies that Oracle, SQL Server and DB2
through `import sql` are expected refusals (`expect: refusal`), a named
limitation rather than a defect.

## Implementation notes

- **What the trial measured afterwards.** Every declared table now
  imports on 12 of the 14 trial DDL files, through both `import model
  --format ddl` and `import sql`. On the other two, every miss is named
  on stderr: C06's `PARTITION OF` table, and on C10 a composite key
  (barwise-1077) and a name two schemas share. Oracle, SQL Server and DB2
  through `import sql` now exit 1 with the named refusal the trial
  expects. That retired the 12 `import:` rows under barwise-jjd and the
  one under barwise-zuk. zuk's report was this spec's R1 and R2 for the
  DDL importer, and its reproduction is now a test in
  `DdlDialectTables.test.ts`.
- **What still fails is not this bug.** Once `import sql` reads tables,
  the jjd round-trip, read-back and acceptance rows fail for a different
  reason. On every customer, the sprint-4 read-back through `import sql`
  loses exactly as many elements as the sprint-1 `model-roundtrip:ddl`
  row does through the DDL importer: the same loss, reached by a second
  command. Those rows moved to barwise-dnm, and the acceptance rows to
  barwise-1077 beside `acceptance-edit-distance-ddl`. The C07 BigQuery
  skin writes no FOREIGN KEY clauses, so a relationship its personas
  check for is not in the artifact at all.
- **Two expected names were the harness's.** The trial's DDL generator
  named any skin statement its own regex could not parse `extra_N`. C04's
  `CREATE OR REPLACE TRANSIENT TABLE` and C06's two `CREATE TYPE`
  statements therefore became names no file contains, and the grader
  reported them as silently dropped whatever the importer did. The
  generator now knows the table modifiers the importer reads, and marks a
  statement that declares no table as not expected
  (`trial/tests/generators.test.mjs`).
- **`trial:offline` does not regenerate.** A generator change takes
  effect only after `npm run trial:generate`. The first rerun after the
  fix above still graded this morning's files.
