# The editor's palette DDL export goes through the format registry

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-wmm
Touches: barwise/packages/vscode/src/commands/ExportDdlCommand.ts,
barwise/packages/vscode/src/diagram/tabPanels.ts,
+barwise/packages/vscode/src/export/ddlExport.ts,
+barwise/packages/vscode/tests/unit/exportDdlCommand.test.ts

When a user runs **Barwise: Export** and picks "As DDL", the extension
shall write the DDL the registered `ddl` exporter produces with its default
options -- the DDL the editor's own diagram DDL tab already shows -- and
shall tell the user when the format could not express a constraint, instead
of writing the mapper's bare DDL and saying nothing.

## Principle

**One answer per question, inside one package first.** The extension
already renders DDL through the registry in one place: the diagram's DDL
tab (`tabPanels.ts` `buildDdl`: `getExporter("ddl").export(model).text`,
with the formats registered at module load and a guard for a missing
exporter). The palette command beside it (`ExportDdlCommand.ts`) calls
`renderDdl(new RelationalMapper().map(model))` instead. So one open model
shows one DDL in the diagram tab and writes another from the palette: the
palette's file has no `UNIQUE` clause for a secondary unique value, no
`CHECK` for a value constraint, and no comment for a constraint DDL cannot
express, and the user is told only how many tables it wrote.

The fix is one helper both callers use, not a second copy of the diagram
tab's call in the command.

## Observed today (at 7b02cd91)

- `ExportDdlCommand.execute` deserializes the editor text, maps it, calls
  `renderDdl`, writes the `.sql` file the user picks, opens it, and shows
  "Exported N CREATE TABLE statement(s) to <file>", N from the mapping.
- The quick pick item in `ExportCommand.ts` is labelled "As DDL".
- The Avro and dbt palette commands also bypass their registered exporters
  and their outputs differ (namespace, doc annotations, file layout,
  seeds), but neither registered exporter computes `constraintSpecs`
  (barwise-u8y), so no constraint report is lost there. That divergence is
  barwise-b30.

## Scope

In scope:

- A vscode-free module, `vscode/src/export/ddlExport.ts`, owns the call:
  it registers the standard formats at load, as `tabPanels.ts` does now,
  and exports one function returning the registered `ddl` exporter's
  result for a model with its default options, or a refusal naming why
  (exporter not registered, export threw). `tabPanels.buildDdl` and
  `ExportDdlCommand` both call it, so the diagram tab and the palette
  cannot drift.
- When the user exports as DDL from the palette, the command shall write
  that result's text.
- When that result has `constraintSpecs`, the command shall write the
  `formatConstraintReport` text to a "Barwise DDL Export" output channel,
  as the import commands do, and show a warning whose message is the
  report's own heading line (so the warning and the report state the same
  count) with a "Show report" action that reveals the channel. With none,
  it shows the information message.
- The information message names the file and no table count: the count
  was a second reading of the model, the one place the message could
  disagree with the file, and the file is opened beside it.
- When the helper refuses, the command shows the refusal as an error and
  writes no file.

Out of scope:

- The Avro and dbt palette commands (barwise-b30).
- A dialect choice in the palette; the exporter's default is `ansi`.

## Inventory

| Area                                      | Current state                  | Verdict                                       |
| ----------------------------------------- | ------------------------------ | --------------------------------------------- |
| `vscode/src/commands/ExportDdlCommand.ts` | `renderDdl(mapper.map(model))` | the shared helper; channel report and warning |
| `vscode/src/diagram/tabPanels.ts`         | `buildDdl` calls the registry  | calls the shared helper                       |
| `vscode/src/export/ddlExport.ts`          | absent                         | new: registration, the call, the refusal      |
| `formats/src/constraintReport.ts`         | shared report text             | reused, unchanged                             |

## Workstreams

### 1. The helper, the command, and a test that drives it

One PR. The new test file mocks `vscode` itself -- `window`
(`activeTextEditor`, `showSaveDialog`, `showTextDocument`,
`show{Information,Warning,Error}Message`, `createOutputChannel`),
`workspace` (`fs.writeFile`, `openTextDocument`) and `Uri` -- because the
`toolRegistration.test.ts` mock covers only the language-model API.
`src/commands` is outside the vscode coverage gate (its vitest config says
the integration suite covers commands), so the test adds evidence, not a
ratchet. Acceptance:

- the ring model's written file contains the router's `-- Constraint (not
  expressible in SQL DDL)` comment, the output channel receives "No Person
  is parent of that same Person.", and the warning's message is the
  report's heading line;
- the unique-value model's written file contains `UNIQUE (email)`;
- the diagram tab's DDL and the palette's file are equal for the same
  model, since both come from the helper.

The first two are watched red with the command change reverted. The third
holds by construction and is pinned against a future second copy.

## Open decisions

1. **Which DDL the palette writes.** Options: (a) the exporter's defaults,
   as the diagram tab shows and `barwise export --format ddl` writes --
   annotation comments, the barwise annotation lines a DDL import reads
   back, and example INSERTs; (b) `PLAIN_DDL_OPTIONS`, keeping the file as
   bare as today with the routed clauses added. **Recommend (a)**: the
   palette and the diagram tab then give one answer, the annotation lines
   are what let `barwise import` read the file back faithfully, and (b)
   would make the tab and the palette disagree in a new way. A user who
   wanted bare DDL sees the larger file at once, since the command opens
   it.

## Risks and testing

- **A test that cannot fail.** The two behavioural assertions name a
  specific clause, comment or verbalization, and are watched red with the
  change reverted.
- **A user who relied on the bare file.** Under (a) the palette output
  gains comments and INSERT statements, visible the moment the file opens.
