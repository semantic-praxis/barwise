# The editor's Avro export writes a namespace Avro accepts

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-1c2
Touches: +barwise/packages/formats/src/avro/avroNames.ts,
barwise/packages/formats/src/avro/AvroExportFormat.ts,
barwise/packages/formats/src/index.ts,
barwise/packages/vscode/src/commands/ExportAvroCommand.ts,
+barwise/packages/formats/tests/avroNames.test.ts,
barwise/packages/formats/tests/AvroExportFormat.test.ts,
barwise/packages/vscode/tests/unit/exportFileCommands.test.ts

When the editor's Avro export derives a namespace from the file name, it
shall make it valid under Avro's name rule, leaving a valid one
unchanged. When any caller passes the Avro exporter a namespace that
breaks the rule, the exporter shall refuse it. Today
`order-system.orm.yaml` exports with namespace `com.order-system`, and
`2024model.orm.yaml` with `com.2024model`. Avro parsers and schema
registries reject both, so every schema in the export is unreadable.

## Principle

Explicit over implicit, and define errors out of existence. A namespace
a caller chose is the caller's to fix: rewriting it silently would hand
them a full name they never asked for, so the exporter refuses. A
namespace the editor derives from a file name is the editor's own
choice, and the editor can make it valid. The rule lives once, in the
Avro adapter's package, and the editor reads it from there, so the
refusal and the repair cannot disagree.

## Observed today (at 326c834e)

- `ExportAvroCommand` passes `namespace: com.<basename>` as written.
  It is the only caller that sets a namespace: the CLI and MCP export
  without one.
- `AvroExportFormat` passes the namespace through to `renderAvro`
  without checking it.
- Avro 1.11, "Names": a namespace is dot-separated names, each matching
  `[A-Za-z_][A-Za-z0-9_]*`.

## Should sanitizing worry a schema registry? (resolved: no)

The issue held the fix back because changing a namespace changes the
full name of records already registered. But a namespace that breaks the
rule never registered anything: the registry rejects the schema. Every
namespace the editor wrote that a registry accepted is already valid,
and the repair leaves a valid namespace unchanged. So no registered full
name changes.

## Scope

- `toAvroNamespace(text)` shall keep each dot-separated part's letters,
  digits and underscores, turn every other character into an
  underscore, and prefix an underscore to a part that is empty or starts
  with a digit. `isAvroNamespace` shall state the rule. Both live in
  `formats/src/avro/avroNames.ts` and are exported from
  `@barwise/formats`.
- When `AvroExportFormat.export` receives a namespace that
  `isAvroNamespace` rejects, it shall throw, naming the namespace and the
  rule.
- `ExportAvroCommand` shall pass `toAvroNamespace("com." + basename)`.

Out of scope: record and field names, which `renderAvro` derives from
table and column names (a table whose name starts with a digit gives an
invalid record name), and a namespace option on the CLI or MCP export.

## Workstreams

### 1. One rule, one refusal, one repair

The three changes above. Acceptance, each pinned by a test: a valid
namespace passes through unchanged; `com.order-system`, `com.2024model`,
`com.my model.v2` and `com..x` become valid; every output of
`toAvroNamespace` passes `isAvroNamespace`; the exporter refuses
`com.order-system`; the editor exports `order-system.orm.yaml` under
`com.order_system` with no error, and `school.orm.yaml` under
`com.school` as before.

## Open decisions

1. **Refuse or repair inside the exporter.** (a) Refuse (recommended):
   the namespace is the caller's, and a quiet rewrite changes the full
   name they register. (b) Repair there too: one behaviour everywhere,
   but a caller who mistyped gets a name they did not write and finds
   out at the registry. Recommend (a).
2. **Where the repair lives.** (a) Beside the rule in `@barwise/formats`
   (recommended): the editor already depends on it, and the repair's
   output is tested against the rule. (b) In the editor command: the
   only caller today, but then the rule is written twice. Recommend (a).

## Risks and testing

No tracked model has a file name that needs repair through the editor
path, so no CLI or MCP output changes. A caller that passed an invalid
namespace now gets an error where it used to get schemas no registry
would take.
