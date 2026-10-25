# The editor's palette Avro and dbt exports go through the format registry

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-b30
Touches: barwise/packages/vscode/src/commands/ExportAvroCommand.ts,
barwise/packages/vscode/src/commands/ExportDbtCommand.ts,
barwise/packages/vscode/src/commands/ExportDdlCommand.ts,
barwise/packages/vscode/src/diagram/tabPanels.ts,
-barwise/packages/vscode/src/export/ddlExport.ts,
+barwise/packages/vscode/src/export/registeredExport.ts,
+barwise/packages/vscode/src/commands/exportReport.ts,
+barwise/packages/vscode/tests/unit/exportFileCommands.test.ts,
barwise/packages/vscode/tests/unit/exportDdlCommand.test.ts,
barwise/packages/vscode/CLAUDE.md,
barwise/docs/getting-started/vscode.md

When a user runs **Barwise: Export** and picks "As Avro Schemas" or "As dbt
Project", the extension shall write the files the registered `avro` or `dbt`
exporter produces, as "As DDL" now does (barwise-wmm), instead of calling
`renderAvro` and `renderDbt` itself and producing files no other surface
produces.

## Principle

**One answer per question.** `palette-ddl-export-routing.spec.md` gave the
DDL palette export the answer the CLI, the MCP tool and the diagram tab
give. The two remaining palette exports still compute their own:

- **Avro.** `ExportAvroCommand` calls `renderAvro(mapper.map(model),
  { namespace: "com.<file>" })`. `AvroExportFormat` renders the same records
  and then adds `[TODO(barwise): ...]` and `[NOTE(barwise): ...]` doc
  annotations, the same review notes the palette dbt export already writes
  into `schema.yml`. The palette Avro files carry none, so a reviewer of the
  palette's `.avsc` files does not see what the CLI's would tell them.
- **dbt.** `ExportDbtCommand` calls `renderDbt` and `annotateDbtExport`
  with the defaults `DbtExportFormat` also uses, so file contents agree.
  The layout does not: the palette writes `models/staging/schema.yml` and
  `models/staging/<model>.sql` into an existing dbt project, while the
  exporter's files are `models/schema.yml`, `models/<model>.sql`, and
  `seeds/<table>.csv` for each populated table.

Each command restating the exporter means each fix lands twice or once:
`ExportResult.constraintSpecs` reports what DDL could not express, and
barwise-u8y will add it for Avro and dbt; the palette would show it only if
someone remembers these two commands.

## Observed today (at 9f4e94c8)

- `ExportAvroCommand` opens a folder picker, writes one `<Record>.avsc` per
  schema, opens the first, and reports "Exported N Avro schema(s) to
  <dir>/".
- `ExportDbtCommand` opens a folder picker, refuses a folder without
  `dbt_project.yml`, writes into `models/staging/`, opens `schema.yml`, and
  reports the model count and the TODO and NOTE counts.
- The CLI's `barwise export --format avro` and the MCP `export_model` tool
  pass no namespace, so their records have none. No surface passes
  `sourceName` or `generateRelationshipTests` for dbt; renderer and exporter
  default them identically (`"raw"`, `true`).
- `ExportDdlCommand` builds its constraint report and warning inline.

## Scope

In scope:

- `export/ddlExport.ts` becomes `export/registeredExport.ts`: one function,
  `exportWith(format, model, options?)`, returning the registered
  exporter's result or a refusal naming why, as `exportDdl` does now. It
  registers the standard formats and the dbt formats at load. The DDL
  command and the diagram tab call it with `"ddl"`; `exportDdl` goes, since
  a wrapper that fixes one argument is a second name for the same call.
- The constraint report and its warning move from `ExportDdlCommand` into
  `commands/exportReport.ts`, and all three commands call it. When a result
  has `constraintSpecs`, the command shall show the report and warning
  `palette-ddl-export-routing.spec.md` specifies, with the format's name in
  the heading; with none, its information message.
- When the user exports as Avro, the command shall write each of the
  result's `files` into the chosen folder, with the exporter options Open
  decision 1 settles.
- When the user exports as dbt, the command shall write the result's model
  and `schema.yml` files at the paths Open decision 2 settles, with the
  options Open decision 3 settles.
- When the helper refuses, either command shows the refusal as an error and
  writes no file.
- The information messages keep their counts where the count comes from
  the result itself (files written, TODO and NOTE annotations), not from a
  second mapping.

Out of scope:

- Computing `constraintSpecs` for Avro and dbt (barwise-u8y). This spec
  makes the palette show them once they exist.
- A namespace or source-name prompt in the palette.

## Inventory

| Area                                       | Current state                       | Verdict                                         |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| `vscode/src/commands/ExportAvroCommand.ts` | `renderAvro(mapper.map(model))`     | `exportWith("avro")`; writes `result.files`     |
| `vscode/src/commands/ExportDbtCommand.ts`  | `renderDbt`, `annotateDbtExport`    | `exportWith("dbt")`; writes the model files     |
| `vscode/src/commands/ExportDdlCommand.ts`  | `exportDdl`; inline report          | `exportWith("ddl")`; report from `exportReport` |
| `vscode/src/diagram/tabPanels.ts`          | `exportDdl`                         | `exportWith("ddl")`                             |
| `vscode/src/export/ddlExport.ts`           | DDL-only helper                     | replaced by `registeredExport.ts`               |
| `vscode/src/commands/exportReport.ts`      | absent                              | new: the channel, the report, the warning       |
| `dbt/src/DbtExportFormat.ts`               | `models/*`, `seeds/*`, `schema.yml` | unchanged                                       |
| `formats/src/avro/AvroExportFormat.ts`     | `namespace` option, doc annotations | unchanged                                       |

## Workstreams

### 1. The helper, both commands, the shared report

One PR. A new test file mocks `vscode` as `exportDdlCommand.test.ts` does,
adding `showOpenDialog`, `workspace.fs.stat`, `workspace.fs.createDirectory`
and `Uri.joinPath`. Acceptance:

- for a model the exporter annotates, the palette's Avro files are
  byte-equal to `getExporter("avro").export(model, <decision 1 options>)
  .files`, and one carries a `[TODO(barwise):` or `[NOTE(barwise):` doc;
- the palette's dbt files are byte-equal to the exporter's model and
  `schema.yml` files at the decision 2 paths, and a populated model writes
  no `seeds/` file under decision 3 (a);
- when the helper is made to return a result with `constraintSpecs` for
  `avro`, the warning carries "the avro format", which is the sibling
  wiring checked;
- each refuses without writing when the helper refuses.

The first, second and fourth are watched red with the command change
reverted. The DDL command's existing tests pass unchanged apart from the
import.

## Open decisions

1. **The Avro namespace.** Options: (a) keep `com.<file>` by passing it
   as the exporter's `namespace` option; (b) drop it, matching the CLI and
   MCP defaults. **Recommend (a)**: a record's full name is
   `<namespace>.<name>`, and a schema registry treats a changed full name
   as a different schema, so (b) would break every user who registered
   palette output. The namespace is an exporter option, not a second
   renderer, so (a) keeps one answer per options.
2. **Where the dbt files go.** Options: (a) write the exporter's
   `models/` files under `models/staging/`, where the palette writes today;
   (b) write the exporter's paths as they are, at the project root.
   **Recommend (a)**: the palette writes into a project the user already
   has, and `models/schema.yml` at the top of `models/` is the file such a
   project is most likely to have already; (b) would overwrite it. The
   contents are the exporter's either way.
3. **dbt seeds.** Options: (a) pass `includeExamples: false`, so the
   palette writes no seeds, as today; (b) write the exporter's
   `seeds/<table>.csv` files. **Recommend (a)**: `dbt seed` loads every
   file under `seeds/` into the warehouse, so (b) would put a model's
   example population into the user's real project; the CLI writes seeds
   only into an output folder the user names. The DDL palette's example
   INSERTs differ, because that file is read before it is run.

## Risks and testing

- **A test that cannot fail.** Each acceptance check compares against the
  exporter's output or names a specific annotation or heading, and is
  watched red with the change reverted.
- **Avro files change.** Doc fields gain review annotations. The record
  names, fields and namespace are unchanged under decision 1 (a).
