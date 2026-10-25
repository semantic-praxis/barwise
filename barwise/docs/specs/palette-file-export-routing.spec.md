# The editor's palette Avro and dbt exports go through the format registry

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-b30
Plan-reviewed: 58ce7c1e (code-review, pr-review)
Touches: barwise/packages/vscode/src/commands/ExportAvroCommand.ts,
barwise/packages/vscode/src/commands/ExportDbtCommand.ts,
barwise/packages/vscode/src/commands/ExportDdlCommand.ts,
barwise/packages/vscode/src/commands/ExportCommand.ts,
barwise/packages/vscode/src/diagram/tabPanels.ts,
-barwise/packages/vscode/src/export/ddlExport.ts,
+barwise/packages/vscode/src/export/registeredExport.ts,
+barwise/packages/vscode/src/commands/exportReport.ts,
+barwise/packages/vscode/tests/unit/exportFileCommands.test.ts,
barwise/packages/vscode/tests/unit/exportDdlCommand.test.ts,
barwise/packages/vscode/CLAUDE.md,
barwise/packages/dbt/src/DbtExportFormat.ts,
barwise/packages/dbt/tests/DbtExportFormat.test.ts,
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
  into `schema.yml`. The palette Avro files carry none.
- **dbt.** `ExportDbtCommand` calls `renderDbt` and `annotateDbtExport`
  with the defaults `DbtExportFormat` also uses, so file contents agree.
  The layout does not: the palette writes `models/staging/schema.yml` and
  `models/staging/<model>.sql` into an existing dbt project, while the
  exporter's files are `models/schema.yml`, `models/<model>.sql`, and
  `seeds/<table>.csv` for each populated table. The palette's layout is a
  fact only the palette knows.

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
- The CLI's `barwise export --format avro` passes no namespace. The MCP
  `export_model` tool (and the editor's `barwise_export_model`, which wraps
  it) passes whatever `options` its caller sends, so a namespace or a dbt
  `sourceName` reaches the exporter only when a caller asks for one.
  `renderDbt` and `DbtExportFormat` default `sourceName` and
  `generateRelationshipTests` identically (`"raw"`, `true`).
- `ExportDdlCommand` builds its constraint report and warning inline.
- `docs/getting-started/vscode.md` says the palette dbt export writes
  `models/schema.yml`; it writes `models/staging/schema.yml`.

## Scope

In scope:

- `export/ddlExport.ts` becomes `export/registeredExport.ts`: one function,
  `exportWith(format, model, options?)`, returning the registered
  exporter's result or a refusal naming why, as `exportDdl` does now. It
  registers the standard formats and the dbt formats at load. The DDL
  command and the diagram tab call it with `"ddl"`; `exportDdl` goes, since
  a wrapper that fixes one argument is a second name for the same call.
- `DbtExportFormat` takes a `modelsDir` option (default `"models"`, so
  every existing caller is unchanged) naming the directory its model files
  and `schema.yml` are written under (Open decision 2).
- The constraint report and its warning move from `ExportDdlCommand` into
  `commands/exportReport.ts`, which all three commands call with the
  result, the format, and the command's own summary line ("Exported DDL
  to <file>", "Exported N file(s) to <dir>/"). When a result has
  `constraintSpecs`, it shall write the `formatConstraintReport` text to a
  "Barwise <Format> Export" output channel, one per format, created on
  first use and cleared per export, and show a warning reading "<summary>.
  <heading>." with a "Show report" action; with none, it shows the summary
  as an information message. DDL's channel name and messages are
  unchanged.
- When the user exports as Avro or dbt, the command shall write every file
  in the result's `files`, at its path, under the chosen folder, with the
  exporter options Open decisions 1 to 3 settle; the commands do no path
  rewriting or filtering of their own.
- When the helper refuses, either command shows the refusal as an error and
  writes no file.
- The information messages count files: "Exported N file(s) to <dir>/",
  with dbt keeping its TODO and NOTE counts, read from the result's
  `annotations`.
- The "As Avro Schemas" picker description names the review annotations,
  and the getting-started page names `models/staging/`.

Out of scope:

- Computing `constraintSpecs` for Avro and dbt (barwise-u8y). This spec
  makes the palette show them once they exist.
- A namespace or source-name prompt in the palette, and a CLI flag for
  `modelsDir`; MCP callers can already pass it.

## Inventory

| Area                                       | Current state                       | Verdict                                         |
| ------------------------------------------ | ----------------------------------- | ----------------------------------------------- |
| `vscode/src/commands/ExportAvroCommand.ts` | `renderAvro(mapper.map(model))`     | `exportWith("avro")`; writes `result.files`     |
| `vscode/src/commands/ExportDbtCommand.ts`  | `renderDbt`, `annotateDbtExport`    | `exportWith("dbt")`; writes `result.files`      |
| `vscode/src/commands/ExportDdlCommand.ts`  | `exportDdl`; inline report          | `exportWith("ddl")`; report from `exportReport` |
| `vscode/src/commands/ExportCommand.ts`     | picker descriptions                 | Avro description names the annotations          |
| `vscode/src/diagram/tabPanels.ts`          | `exportDdl`                         | `exportWith("ddl")`                             |
| `vscode/src/export/ddlExport.ts`           | DDL-only helper                     | replaced by `registeredExport.ts`               |
| `vscode/src/commands/exportReport.ts`      | absent                              | new: per-format channel, report, warning        |
| `dbt/src/DbtExportFormat.ts`               | `models/*`, `seeds/*`, `schema.yml` | `modelsDir` option, default `"models"`          |
| `formats/src/avro/AvroExportFormat.ts`     | `namespace` option, doc annotations | unchanged                                       |

## Alternatives considered

- **Path rewriting in the palette** (map the exporter's `models/` to
  `models/staging/`). Rejected by plan review: the layout would again be a
  fact only the palette knows, and every new exporter path would need a
  rule there.
- **Keep the palette renderers and add the missing pieces** (doc
  annotations in the Avro command). Rejected: it is the duplication this
  spec removes, and the next exporter change would miss the palette again.

## API and migration impact

- `exportDdl` and `DdlExport` are internal to `barwise-vscode`, which
  exports no API; the two callers move in the same commit.
- `DbtExportFormat`'s new option is additive with an unchanged default.
- Palette users see: Avro doc fields gain review annotations; messages
  count files rather than schemas or models.

## Workstreams

### 1. The helper, the dbt option, both commands, the shared report

One PR. A new test file mocks `vscode` as `exportDdlCommand.test.ts` does,
adding `showOpenDialog`, `workspace.fs.stat`, `workspace.fs.createDirectory`
and `Uri.joinPath`. `exportDdlCommand.test.ts` changes its refusal test's
mocked module and function (`registeredExport.js`, `exportWith`) and
otherwise keeps its assertions. Acceptance:

- for a model the exporter annotates, the palette's Avro files are
  byte-equal to `getExporter("avro").export(model, { namespace:
  "com.<file>" }).files`, and one carries a `[TODO(barwise):` or
  `[NOTE(barwise):` doc;
- the palette's dbt files are byte-equal to `getExporter("dbt")
  .export(model, { modelsDir: "models/staging", includeExamples: false })
  .files`, and a populated model writes no `seeds/` file;
- `DbtExportFormat` with `modelsDir: "models/staging"` names its model and
  `schema.yml` files under it, and without the option its files are
  unchanged;
- when the helper is made to return a result with `constraintSpecs`, the
  Avro command's warning carries "the avro format" and the dbt command's
  "the dbt format";
- each refuses without writing when the helper refuses.

Watched red with the change reverted: the Avro check (no annotation), the
`modelsDir` check, both report checks, and both refusal checks. The dbt
file check holds on today's command too, since today's layout and contents
are what decisions 2 and 3 keep; it pins them, and its seeds clause
discriminates because the command writes every result file, so dropping
`includeExamples: false` writes seeds and fails it.

## Open decisions

1. **The Avro namespace.** Options: (a) keep `com.<file>` by passing it as
   the exporter's `namespace` option; (b) drop it, matching the CLI's
   default. **Recommend (a)**: a record's full name is
   `<namespace>.<name>`, and a schema registry treats a changed full name
   as a different schema, so (b) would break every user who registered
   palette output. The namespace is an exporter option, not a second
   renderer, so (a) keeps one answer per options.
2. **Where the dbt files go.** Options: (a) pass `modelsDir:
   "models/staging"` through a new exporter option, keeping today's
   palette layout; (b) write the exporter's default paths at the project
   root. **Recommend (a)**: the palette writes into a project the user
   already has, and `models/schema.yml` at the top of `models/` is the file
   such a project is most likely to have already; (b) would overwrite it.
   As an option, the layout is the exporter's answer for those options,
   and any surface can ask for it.
3. **dbt seeds.** Options: (a) pass `includeExamples: false`, so the
   palette writes no seeds, as today; (b) write the exporter's
   `seeds/<table>.csv` files. **Recommend (a)**: `dbt seed` loads every
   file under `seeds/` into the warehouse, so (b) would put a model's
   example population into the user's real project; the CLI writes seeds
   only into an output folder the user names. The DDL palette's example
   INSERTs differ, because that file is read before it is run.

## Risks and testing

- **A test that cannot fail.** The checks that can go red are watched red;
  the one that holds on today's code says so and names the clause in it
  that discriminates.
- **Avro files change.** Doc fields gain review annotations. The record
  names, fields and namespace are unchanged under decision 1 (a).
