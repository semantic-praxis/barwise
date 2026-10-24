# Export reports the constraints its format could not express

Status: Implemented -- WS1

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-wc0
Plan-reviewed: 03489998 (code-review, pr-review)
Touches: barwise/packages/cli/src/commands/export.ts,
barwise/packages/cli/tests/commands/,
barwise/packages/mcp/src/tools/exportModel.ts,
barwise/packages/mcp/tests/tools/,
barwise/packages/vscode/tests/unit/,
barwise/packages/formats/src/ossie/OssieExportFormat.ts,
barwise/docs/CLI.md

`barwise export`, the MCP `export_model` tool, and the editor's
language-model export tool shall tell the person or agent exporting which
constraints the format reported it could not express, from
`ExportResult.constraintSpecs`, instead of discarding that list.

## Principle

**Explicit over implicit.** Two formats compute the list today -- the DDL
router spills to it and the Ossie writer fills it -- and both also write it
into the artifact (DDL as `-- Constraint (...)` comments above each table,
Ossie as its loss comment block). What is missing is the report to the
person or agent doing the export: with `--output`, in a pipeline, or behind
a tool call, the artifact is a file nobody reads. The fix shows what is
already computed; it computes nothing new.

**Composability.** The editor's language-model export tool calls the MCP
server's `executeExportModel`, so one change there reaches two surfaces.
Each format keeps owning what goes into `constraintSpecs`; the surfaces own
only how it is shown.

## Should the report go in the exported artifact or beside it? (resolved: beside it)

Beside it. The artifact is what a pipeline consumes -- `barwise export
--format ddl | psql` -- so the report goes to stderr on the CLI and into a
separate MCP content block. A format that wants the list in its artifact
already writes it there, and keeps doing so; when the artifact goes to a
terminal on stdout, the reader sees both, which is accepted.

## Scope

In scope:

- When `barwise export` produces a result with one or more
  `constraintSpecs`, the CLI shall write to stderr, after the artifact is
  written, a heading naming the count and the format, then one line per
  distinct verbalization (an identical verbalization spilled for several
  tables is one line with `(xN)`), and shall leave stdout and the exit
  code unchanged. Verbalizations only: a person reads this in a terminal,
  and the pseudocode and example are in the artifact and the MCP report.
- When a project export (`.orm-project.yaml`) writes a domain, the CLI
  shall report that domain's specs the same way immediately after writing
  it, the heading naming the domain (its context name, as the export loop
  already names it). A later domain that fails leaves the earlier domains'
  reports printed, since each is printed as its domain completes.
- When the MCP `export_model` tool's result has one or more
  `constraintSpecs`, the tool shall return a second content block after the
  artifact block: a heading with the count and format, then each spec's
  verbalization, pseudocode and example. That block goes through the same
  `boundedTextResult` as the artifact, under its own `kind`, so a large
  report spills to a file with a preview instead of flooding the context.
  The artifact block is unchanged.
- The editor's language-model tool joins content blocks into one text part
  (`toToolResult`), so there the report follows the artifact text after a
  line end; the report's heading is what separates them.
- When a result has no `constraintSpecs`, every surface shall print and
  return exactly what it does today. That silence is not a guarantee:
  OpenAPI, Avro and dbt never compute the list (barwise-u8y).

Out of scope:

- The editor's palette export commands (`barwise.export` through
  `ExportCommand.ts`, and `ExportDdlCommand`, `ExportAvroCommand`,
  `ExportDbtCommand`). They call the renderers directly rather than the
  format registry, so the palette DDL export has no routing and no
  `constraintSpecs` at all -- a divergence from the language-model tool
  that predates this change and is filed as barwise-wmm.
- Widening `ExportResult` to carry the DDL router's table name and reason;
  the report uses the public type as it is.

## Inventory

| Area                                     | Current state                          | Verdict                                  |
| ---------------------------------------- | -------------------------------------- | ---------------------------------------- |
| `cli/src/commands/export.ts`             | writes `result.text`; ignores specs    | stderr report per artifact written       |
| `mcp/src/tools/exportModel.ts`           | returns `boundedTextResult(text)` only | second, bounded block when specs exist   |
| `vscode/src/mcp/ToolRegistration.ts`     | joins blocks into one text part        | untouched; a test pins the joined report |
| `formats/src/ossie/OssieExportFormat.ts` | comment says no surface reads specs    | comment updated                          |
| formats filling the list                 | DDL, Ossie only                        | untouched; the rest is barwise-u8y       |
| palette export commands                  | bypass the registry                    | out of scope, barwise-wmm                |

## Workstreams

### 1. CLI, MCP, and the editor tool's test

One PR: a few lines in each surface, and one fixture -- a model with a ring
constraint, which the DDL export (default `ansi` dialect) cannot express and
spills. Tests, each asserting the fixture's ring verbalization text, and
each seen red with its surface change reverted:

- the CLI writes the heading and the verbalization to stderr and nothing
  new to stdout, for a single model and for a project domain;
- the MCP tool returns the second block with verbalization, pseudocode and
  example, and one block when the model has no unexpressible constraint;
- with `BARWISE_MCP_INLINE_LIMIT` set low, both blocks spill, and the
  report's preview still names the ring constraint;
- the editor's `barwise_export_model` tool result text contains the report
  heading and verbalization after the artifact.

`docs/CLI.md` names the stderr report under `export`; the Ossie export's
comment drops its "nothing reads constraintSpecs" sentence.

## API and migration impact

- No public type changes. The MCP result gains a content block only when
  there is something to report; a client reading `content[0]` sees what it
  saw before. The editor tool's single text part gains the report after
  the artifact text.

## Risks and testing

- **A test that cannot fail.** Every surface test asserts the specific
  verbalization, and is watched red with the surface change reverted.
