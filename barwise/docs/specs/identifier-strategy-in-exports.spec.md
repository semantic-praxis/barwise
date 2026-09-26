# Exports honor the project's identifier strategy

Status: Implemented 2026-09-26 -- the single workstream

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-ujb

A `.orm-project.yaml` can set `settings.preferred_identifier_strategy`
(`integer` or `uuid`): the SQL type for a primary key whose identifier
has no declared data type. `ProjectSerializer` saves and loads it, and
`RelationalMapper.map(model, { preferredIdentifierStrategy })` honors it.
But no export ever passes it. Every export format calls `map(model)`
with no options, so every such key exports as `TEXT`, whatever the
project says. Only tests exercise the strategy. After this change, an
export of a project types those keys by the project's strategy. The
"not declared" annotation still fires on them, as the owner decided on
2026-09-26, and now says the type came from the strategy.

## Principle

**Explicit over implicit.** The strategy is a project setting, so it
applies where a project is what is being exported. A single
`.orm.yaml` exported on its own does not go looking for a project file
above it.

## Requirements

- **R1.** `ExportOptions` shall carry an optional
  `preferredIdentifierStrategy`, and every relational export format
  (DDL, dbt, OpenAPI, Avro) shall pass it to `RelationalMapper.map`.
- **R2.** Exporting a project shall set that option from the project's
  settings, for every domain exported. This covers `barwise export
  <project>` in the CLI and `export_model` in MCP with a project source.
- **R3.** A key typed by the strategy is still defaulted: its column
  keeps `dataTypeDefaulted: true`, and the export still carries the
  `data_type` TODO. The column also records `defaultedByStrategy`, and a
  foreign key copying that key records it too. The TODO then reads:
  "Data type was not declared; exported as INTEGER by the project's
  identifier strategy. Add a data type to the value type."
- **R4.** Single-model exports are unchanged. That covers the CLI and
  MCP given an `.orm.yaml`, the `schema` command and tool, the VS Code
  export commands, and the diagram's annotation panel.

## Scope

In: `ExportOptions`, `Column`, `RelationalMapper`, the annotation
collector's message, the four relational export formats, and the
CLI and MCP project export paths. Out: making the strategy available to
single-model exports (a `--identifier-strategy` flag, or discovering an
enclosing project), which is a separate decision if it is ever wanted.

## Workstream (single)

Core first (option, column marker, message), then the formats, then the
two surfaces. Each step is testable on its own.

## Alternatives

- **Discover the enclosing project for a single model.** Rejected for
  now: it is inference, the thing the principle above rules out. It
  would also make a model export differently depending on where the
  file sits.
- **Drop the warning when the strategy applies.** The owner chose to
  keep it on 2026-09-26: the model still declares nothing, and the
  strategy is a default, not a declaration.

## API and migration impact

- `ExportOptions` gains an optional field; `Column` gains an optional
  field. Both are additive.
- A project with the setting exports differently: keys that exported as
  `TEXT` export as `INTEGER` or `UUID`. That is the setting finally doing
  what it says. A project without it is unchanged.

## Risks and testing

- A foreign key must carry the same type as the key it references.
  `copiedKeyType` already copies the type; R3 makes it copy the marker.
- Tests: the mapper marks a strategy-typed key and its foreign key; the
  collector words the TODO; each format passes the option (a DDL,
  dbt, OpenAPI and Avro export of a project-less model with the option
  set shows `INTEGER`); a CLI project export and an MCP project export
  honor the setting; a single-model export does not.

## Open decisions

None.

## Implementation notes

- The strategy reached only a key with no identifying value type at
  all. A key whose value type existed without a data type took `TEXT`
  even with a strategy set, because it went through the declared-type
  path. Both paths now go through one `keyTypeOf`, so "no declared
  type" means the same thing for both.
- MCP `export_model` already passed a caller's `options` through to the
  format, so an explicit `preferredIdentifierStrategy` there is honored,
  and it wins over the project's setting. That is a caller's own
  declaration, not inference, so R4 is not affected.
- Each new test was checked against the code before its change: the
  mapper and collector tests fail 3 of 3 against the old core, the CLI
  project tests 2 of 3 and the MCP ones 1 of 3 against the old
  surfaces. The passing ones are the single-model controls and MCP's
  explicit option, which was already passed through.
