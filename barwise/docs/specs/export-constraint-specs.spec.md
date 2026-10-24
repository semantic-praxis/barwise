# Export reports the constraints its format could not express

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-wc0
Touches: barwise/packages/cli/src/commands/export.ts,
barwise/packages/cli/tests/commands/,
barwise/packages/mcp/src/tools/exportModel.ts,
barwise/packages/mcp/tests/tools/,
barwise/docs/CLI.md

`barwise export` and the MCP `export_model` tool shall tell the person
exporting which constraints the target format could not express, from the
`ExportResult.constraintSpecs` every exporter already fills, instead of
dropping that list on the floor.

## Principle

**Explicit over implicit.** An export that silently leaves out a business
rule misleads exactly the person who trusts it: the DDL has no CHECK for the
ring constraint, the Ossie document has no line for the frequency, and
nothing says so. The formats already produce the list -- the DDL router
spills to it and the Ossie writer fills it -- and the surfaces discard it.
The fix is to show what is already computed, not to compute anything new.

**Composability.** The VS Code language-model export tool calls the MCP
server's `executeExportModel`, so a change there reaches two surfaces at
once. Each format keeps owning what goes into `constraintSpecs`; the
surfaces own only how it is shown.

## Should the report go in the exported artifact or beside it? (resolved: beside it)

Beside it. The artifact is what a pipeline consumes -- `barwise export
--format ddl | psql` -- so the report goes to stderr on the CLI and to a
separate content block in the MCP result. A format that wants the list in
its own artifact already writes it there (the DDL router's SQL comments,
the Ossie writer's comment block); that stays the format's call.

## Scope

In scope:

- When `barwise export` produces a result with one or more
  `constraintSpecs`, the CLI shall write to stderr a heading naming the
  count and the format, then one line per spec with its verbalization,
  after the artifact is written, and shall leave stdout and the exit code
  unchanged.
- When a project export (`.orm-project.yaml`) produces specs for a domain,
  the CLI shall report them the same way, each heading naming the domain.
- When the MCP `export_model` tool's result has one or more
  `constraintSpecs`, the tool shall return them as a second content block,
  after the artifact block: the count and format, then for each spec its
  verbalization, pseudocode and example. The artifact block, including its
  spill to a file when large, is unchanged, so a spill never hides the
  report.
- When a result has no `constraintSpecs`, both surfaces shall print and
  return exactly what they do today.

Out of scope:

- The editor's palette export commands (`ExportDdlCommand`,
  `ExportAvroCommand`, `ExportDbtCommand`). They call the renderers
  directly rather than the format registry, so they have no
  `constraintSpecs` to show; routing them through the registry is a
  separate change with its own blast radius.
- Changing what any format puts in `constraintSpecs`.

## Inventory

| Area                            | Current state                          | Verdict                               |
| ------------------------------- | -------------------------------------- | ------------------------------------- |
| `cli/src/commands/export.ts`    | writes `result.text`; ignores specs    | stderr report after the artifact      |
| `mcp/src/tools/exportModel.ts`  | returns `boundedTextResult(text)` only | second content block when specs exist |
| VS Code language-model tool     | wraps `executeExportModel`             | inherits the MCP block; no change     |
| VS Code palette export commands | bypass the registry                    | out of scope (above)                  |
| formats that fill the list      | DDL router, Ossie writer               | untouched                             |

## Workstreams

### 1. CLI and MCP

Both surfaces in one PR: the change is a few lines in each, and the
acceptance tests share one fixture (a model with a ring constraint, which
DDL cannot express). Tests: the CLI writes the heading and each
verbalization to stderr and nothing new to stdout, for a single model and
for a project domain; the MCP tool returns the second block with
verbalization, pseudocode and example, and still returns one block when
there are no specs; a spilled artifact still carries the report block.
`docs/CLI.md` names the stderr report under `export`.

## API and migration impact

- None to any public type. The MCP tool result gains a content block only
  when there is something to report; a client reading `content[0]` sees
  what it saw before.

## Open decisions (for review)

1. **How much the CLI prints.** Options: verbalizations only (one line
   each, readable in a terminal), or verbalization, pseudocode and example
   (complete, but three lines per constraint on stderr). **Recommend
   verbalizations only** on the CLI, where a person reads it, and the full
   spec in the MCP block, where an agent acts on it.

## Risks and testing

- **A test that cannot fail.** Each surface test asserts the specific
  verbalization text of the fixture's ring constraint, not merely that a
  block exists, and is seen red with the surface change reverted.
