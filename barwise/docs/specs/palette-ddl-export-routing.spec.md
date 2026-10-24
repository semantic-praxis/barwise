# The editor's palette DDL export goes through the format registry

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-wmm
Touches: barwise/packages/vscode/src/commands/ExportDdlCommand.ts,
+barwise/packages/vscode/tests/unit/exportDdlCommand.test.ts

When a user runs **Barwise: Export** and picks "As SQL DDL", the extension
shall write the DDL the registered `ddl` exporter produces -- the text
`barwise export --format ddl` writes and the editor's language-model export
tool returns -- and shall tell the user when the format could not express a
constraint, instead of writing the mapper's bare DDL and saying nothing.

## Principle

**One answer per question.** The repository now has one DDL renderer for
every surface that asks for DDL: the CLI `export`, the MCP `export_model`,
the editor's `barwise_export_model` tool, and since barwise-zk4 the
deprecated `schema` and `generate_schema`. The palette command is the last
caller of `renderDdl` on the mapper's schema directly
(`ExportDdlCommand.ts`), so the same open model gives one DDL from the
command palette and another from the chat panel beside it. The palette's
file has no `UNIQUE` clause for a secondary unique value, no `CHECK` for a
value constraint, and no comment for a constraint DDL cannot express; the
user is told it exported N tables and nothing else.

## Observed today (at 7b02cd91)

- `ExportDdlCommand.execute` deserializes the editor text, calls
  `new RelationalMapper().map(model)` and `renderDdl(schema)`, writes the
  result to the chosen `.sql` file, and shows "Exported N CREATE TABLE
  statement(s) to <file>".
- The Avro and dbt palette commands bypass the registry the same way
  (`renderAvro`, `renderDbt` plus `annotateDbtExport`). They lose no
  constraint the registry would report: neither registered exporter
  computes `constraintSpecs` (barwise-u8y), and their remaining
  differences are the exporters' validation and lineage. They are out of
  scope here.

## Scope

In scope:

- When the user exports as SQL DDL from the palette, the command shall
  write `getExporter("ddl").export(model).text` with the exporter's default
  options -- the text `barwise export --format ddl` writes for the same
  model (Open decision 1).
- When that result has `constraintSpecs`, the command shall show a warning
  naming how many constraints the format could not express, with the
  report text from `formatConstraintReport` available in the message's
  detail, after the file is written. When it has none, the information
  message is the one shown today.
- The table count in the information message comes from the export, not
  from a second mapping: the command counts `CREATE TABLE` statements in
  the text it wrote, so the message cannot disagree with the file.

Out of scope:

- The Avro and dbt palette commands (above; they become a constraint
  question only once barwise-u8y gives their exporters a list).
- A dialect choice in the palette. The exporter's default is `ansi`, as
  the CLI's is; offering dialects is a UI change of its own.

## Inventory

| Area                                          | Current state                  | Verdict                                         |
| --------------------------------------------- | ------------------------------ | ----------------------------------------------- |
| `vscode/src/commands/ExportDdlCommand.ts`     | `renderDdl(mapper.map(model))` | the registered `ddl` exporter; warning on specs |
| `ExportAvroCommand.ts`, `ExportDbtCommand.ts` | bypass the registry            | unchanged (no constraint list to lose)          |
| `formats/src/constraintReport.ts`             | shared report text             | reused, unchanged                               |

## Workstreams

### 1. The command, and a test that drives it

One PR. The test mocks `vscode` at the boundary, as
`toolRegistration.test.ts` does, drives `ExportDdlCommand.execute` against
an open editor holding the ring model from `export-constraint-specs.spec.md`
and a model with a secondary unique value, and asserts:

- the written file equals `barwise export --format ddl`'s text for the
  same model (both computed through the registry in the test);
- the ring model raises a warning whose detail names "No Person is parent
  of that same Person.";
- the unique-value model's file contains `UNIQUE (email)` and raises the
  information message, not a warning.

Each assertion is watched red with the command change reverted.

## Open decisions

1. **Which DDL the palette writes.** Options: (a) the exporter's defaults,
   so the palette writes what `barwise export --format ddl` writes and the
   language-model tool returns -- annotation comments, the barwise
   annotation lines a DDL import reads back, and example INSERTs;
   (b) `PLAIN_DDL_OPTIONS`, which keeps the palette's file as bare as it is
   now and adds only the routed clauses. **Recommend (a)**: the palette
   item says "Export", the CLI command of the same name writes the
   annotated text, and the annotation lines are what let `barwise import`
   read the file back faithfully; (b) keeps a third flavour of DDL alive
   for one surface. (a) makes the palette's file larger, which a user who
   wanted bare DDL notices at once.

## Risks and testing

- **A test that cannot fail.** Each assertion names a specific clause or
  verbalization, and is watched red with the change reverted.
- **A user who relied on the bare file.** The palette output gains
  comments and INSERT statements under (a). The surface is interactive
  and writes a file the user opens at once, so the change is visible
  where it happens.
