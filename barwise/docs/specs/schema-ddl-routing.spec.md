# The deprecated schema surfaces render DDL through the DDL exporter

Status: Draft -- no workstream implemented

Created: 2026-10-24
Last-updated: 2026-10-24
Tracking: barwise-zk4
Touches: barwise/packages/cli/src/commands/schema.ts,
barwise/packages/cli/src/commands/export.ts,
barwise/packages/cli/tests/commands/schema.test.ts,
barwise/packages/mcp/src/tools/schema.ts,
barwise/packages/mcp/tests/tools/schema.test.ts,
barwise/packages/vscode/tests/unit/toolRegistration.test.ts,
barwise/docs/CLI.md

When `barwise schema` or the MCP `generate_schema` tool (and the editor's
language-model tool that wraps it) produce DDL, they shall produce it
through the registered `ddl` exporter, so a constraint DDL can express
appears as a clause and one it cannot is reported, instead of both being
dropped in silence as they are today.

## Principle

**Composability, and one answer per question.** "What DDL does this model
map to" has two answers in the repository. `barwise export --format ddl`
renders through `DdlExportFormat`: the mapper, then the dialect constraint
routing that adds `UNIQUE` and `CHECK` clauses and spills what DDL cannot
express into `constraintSpecs`, which every export surface that goes
through the format registry now reports (`export-constraint-specs.spec.md`;
the editor's palette export does not, barwise-wmm). `barwise schema` and `generate_schema`
call `renderDdl` on the mapper's schema directly, so the same model gives
two different DDL texts depending on which command asked, and the second
says nothing about what it left out.

Both surfaces are deprecated in favour of `export --format ddl`, and their
notices say so. Deprecated is not removed: until they go (Open decision
1), a reader of either one is reading a schema that drops constraints
without a word, which is the defect `export-constraint-specs.spec.md` fixed
for the surfaces it covered.

## Observed today (2026-10-24, at b09581cd)

- `barwise schema ring.orm.yaml` (the irreflexive ring fixture from
  `export-constraint-specs.spec.md`) prints the two tables with no comment
  for the ring and nothing on stderr but the deprecation notice; `barwise
  export --format ddl --no-annotate` on the same file prints a `--
  Constraint (not expressible in SQL DDL)` comment and the stderr report.
- A model with a value constraint or a secondary unique value column gets
  `CHECK` and `UNIQUE` clauses from `export` and none from `schema`.
- `--format json` on either surface returns the mapper's tables, which
  have no constraint clauses in any surface; it is out of scope.

## Scope

In scope:

- When `barwise schema` runs with `--format ddl` (the default), the CLI
  shall write exactly what `barwise export --format ddl --no-annotate
  --no-examples` writes to stdout for the same model, and write the
  constraint report to stderr through the export command's own
  `reportConstraintSpecs`, which `export.ts` exports for it rather than
  `schema.ts` keeping a second copy. The deprecation notice stays first on
  stderr. With `--output`, `schema` writes the file and the report and
  nothing else: no lineage manifest and no lineage warning, which are
  `export`'s, and which `schema` never wrote.
- When `generate_schema` runs with `format: "ddl"` (the default), the tool
  shall return what `executeExportModel(source, "ddl", { annotate: false,
  includeExamples: false })` returns, by calling it: the DDL block, bounded
  to a file with a preview when it is large, and the detailed report block
  when there is one. The bound is a change for a large model, and the one
  every other generating tool already applies.
- The editor's `barwise_generate_schema` tool wraps `executeSchema`, and
  its `toToolResult` joins the two blocks into one text part, the report
  after the DDL, as it does for `barwise_export_model`
  (`export-constraint-specs.spec.md`); a vscode test pins it.
- When either runs with the JSON format, its output shall not change.
- Each surface test asserts the specific ring verbalization or the specific
  clause it is about, and is watched red with its surface change reverted.

Out of scope:

- Removing the deprecated surfaces (Open decision 1).
- The editor's palette DDL export, which bypasses the registry the same
  way and is barwise-wmm; it writes a file rather than returning text, so
  its fix is its own.

## Inventory

| Area                              | Current state                   | Verdict                                       |
| --------------------------------- | ------------------------------- | --------------------------------------------- |
| `cli/src/commands/schema.ts`      | `renderDdl(mapper.map(model))`  | the `ddl` exporter text; export stderr report |
| `cli/src/commands/export.ts`      | `reportConstraintSpecs` private | exported for `schema.ts`                      |
| `mcp/src/tools/schema.ts`         | `renderDdl(mapper.map(model))`  | delegates to `executeExportModel`             |
| `vscode` `ToolRegistration.ts`    | wraps `executeSchema`           | unchanged; a test pins the joined report      |
| JSON format on both surfaces      | mapper tables                   | unchanged                                     |
| `formats/src/constraintReport.ts` | shared report text              | reused, unchanged                             |

## What changes for a reader

The DDL these surfaces print changes for every model whose constraints the
router expresses or spills: it gains the `UNIQUE` and `CHECK` clauses and
the spill comments `export` already prints, and an existing last clause
gains the comma the next clause needs, so lines change as well as appear.
Measured at plan review over the tracked models: 43 of 119 lose at least
one line to that rewrite. A model with validation errors also gains the
exporter's leading `-- Validation warnings:` comment block (Open decision
2). A consumer that line-matches `schema` output breaks on those models;
the surfaces are deprecated and the new text is their replacement's.

## Workstreams

### 1. Both surfaces, one PR

A few lines in each surface, delegating to the export code, and their
tests, with the ring fixture reused from the export report's tests.
Acceptance:

- the ring's verbalization in the CLI's stderr, in the MCP report block,
  and in the editor tool's joined text;
- the `UNIQUE` clause for a secondary unique value column in the CLI and
  MCP DDL;
- `barwise schema --format ddl` stdout byte-identical to `barwise export
  --format ddl --no-annotate --no-examples` stdout over every tracked
  model, which is the one-answer claim checked directly;
- JSON output byte-identical before and after over every tracked model;
- `schema --output` writes no lineage manifest.

## Open decisions

1. **Route or remove.** Options: (a) route the deprecated surfaces through
   the exporter, as above; (b) remove them now, which their notices
   promise "in a future version", and update the capability matrix and the
   pinned MCP and editor tool lists in the same commit. **Recommend (a)**:
   it fixes a silent loss today in a few lines, and removal is a
   user-facing break the owner has not yet scheduled; (a) does not make
   (b) harder.
2. **The validation-warnings block.** The exporter prepends validation
   errors as SQL comments; `renderDdl` never did. Options: (a) accept it,
   since it is information the reader of an invalid model's schema wants;
   (b) strip it, which needs either a new exporter option or a renderer
   split the export surfaces do not use. **Recommend (a)**: one DDL text
   per model and options is the point, and an option that exists only to
   keep a deprecated surface's output narrower is the shallow interface
   this repository's vocabulary warns about.

## Risks and testing

- **A test that cannot fail.** Every surface test asserts the specific
  verbalization or clause, and is watched red with its change reverted.
- **A consumer pinned to the old text.** Lines change on 43 of 119 tracked
  models. The surfaces are deprecated and their notices name the
  replacement, whose output the new text is.
