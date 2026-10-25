# The editor's Avro export writes a namespace Avro accepts

Status: Draft -- no workstream implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-1c2
Touches: +barwise/packages/formats/src/avro/avroNames.ts,
barwise/packages/formats/src/index.ts,
barwise/packages/vscode/src/commands/ExportAvroCommand.ts,
+barwise/packages/formats/tests/avroNames.test.ts,
barwise/packages/vscode/tests/unit/exportFileCommands.test.ts

When the editor's Avro export derives a namespace from the file name and
that namespace breaks Avro's name rule, the editor shall write a valid
one instead and tell the user both names. Today `order-system.orm.yaml`
exports with namespace `com.order-system`, and `2024model.orm.yaml` with
`com.2024model`. Strict Avro parsers reject both, so those schemas cannot
be read by them.

## Principle

Define errors out of existence where the code owns the choice, and keep
it explicit where the caller does. The editor chooses the namespace from
a file name, so it can make it valid. A caller of the exporter, an MCP
agent among them, chooses its own namespace, and the exporter writes what
it is given. The editor also says when it repaired a name, because the
repair changes every record's full name.

## Observed today (at 326c834e)

- `ExportAvroCommand` passes `namespace: com.<basename>` as written.
- `AvroExportFormat` passes `options.namespace` through to `renderAvro`
  without checking it. Two callers can set it: the editor command, and
  the MCP `export_model` tool, whose `options` accepts any extra key. The
  CLI sets no namespace.
- Avro 1.11, "Names": a namespace is dot-separated names, each matching
  `[A-Za-z_][A-Za-z0-9_]*`, or the empty string for the null namespace.
- Java Avro, which a Java schema registry uses, validates a record's
  simple name but not its namespace segments. So `com.order-system` can
  have been accepted and registered there, while a strict parser rejects
  it.

## Scope

- `toAvroNamespace(text)` shall return a namespace that is already valid
  unchanged. Otherwise it shall keep each dot-separated part's letters,
  digits and underscores, turn every other character into an underscore,
  and prefix an underscore to a part that is empty or starts with a
  digit.
- `isAvroNamespace` shall state the rule, the empty namespace included.
- Both live in `formats/src/avro/avroNames.ts` and are exported from
  `@barwise/formats`, beside the Avro adapter.
- When the derived namespace `com.<basename>` is not valid,
  `ExportAvroCommand` shall export under `toAvroNamespace` of it, and
  shall show a warning naming both namespaces. The warning shall also say
  that a registry which accepted the old namespace will treat the new
  schemas as new.
- The exporter shall not change: an MCP caller's namespace is written as
  given.

Out of scope:

- Record and field names, which `renderAvro` derives from table and
  column names (a table whose name starts with a digit gives an invalid
  record name).
- Refusing an invalid namespace in the exporter (Open decision 1).
- A namespace setting in the editor.

## Workstreams

### 1. The repair and its warning

The changes above. Acceptance, each pinned by a test:

- A valid namespace, and the empty one, pass the rule.
- `com.order-system`, `com.2024model`, `com.my model.v2` and `com..x`
  become valid.
- Every string of up to three characters, over an alphabet holding each
  character class the rule distinguishes, repairs to a namespace the rule
  accepts.
- The editor exports `order-system.orm.yaml` under `com.order_system`,
  with the warning.
- `school.orm.yaml` exports under `com.school` with no warning.

## Open decisions

1. **What the exporter does with an invalid namespace.** (a) Write it as
   given (recommended): a Java registry accepts it, so an MCP caller may
   depend on it, and the export result has no channel for a warning. (b)
   Refuse it: stops unreadable output for strict parsers, and breaks a
   caller whose registry took the name. (c) Repair it: a caller gets a
   name it did not write. Recommend (a).
2. **What the editor does with an invalid derived namespace.** (a) Repair
   it and warn (recommended): the output becomes readable everywhere, and
   a user whose lenient registry took the old name is told why the full
   names changed. (b) Keep it and warn: nothing registered changes, and
   strict parsers keep rejecting the output. (c) Keep it silently, as
   today. Recommend (a). A user who needs the old name can still export
   it through the MCP tool.
3. **Two file names that repair to one namespace** (`order-system` and
   `order_system`). The warning names the namespace it wrote, so the user
   can see the collision. Recommend no further handling. A collision needs
   two models in one workspace whose names differ only in characters the
   rule rejects.

## Risks and testing

No CLI or MCP output changes. An editor export of a file whose name is
already a valid namespace is unchanged. One whose name is not gets new
full names, and the user is told.
