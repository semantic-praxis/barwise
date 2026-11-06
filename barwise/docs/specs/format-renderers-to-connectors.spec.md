# Format renderers live in their connectors, and dbt composes formats' SQL parser

Status: Draft -- no workstream implemented

Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor WS1 rows 1 and 24; barwise-ym8.y5z,
barwise-ym8.paz, barwise-ym8.3tg), barwise-ym8.gc9.e76
Touches: barwise/packages/core/src/mapping/, barwise/packages/core/src/export/,
barwise/packages/core/src/annotation/, barwise/packages/core/tests/,
barwise/packages/core/CLAUDE.md, barwise/packages/formats/src/,
barwise/packages/formats/tests/, barwise/packages/formats/package.json,
barwise/packages/formats/CLAUDE.md, barwise/packages/dbt/src/,
barwise/packages/dbt/tests/, barwise/packages/dbt/package.json,
barwise/packages/dbt/CLAUDE.md, barwise/packages/cli/tests/,
barwise/packages/vscode/tests/, barwise/package-lock.json,
barwise/scripts/lib/intended.cjs, barwise/scripts/check-architecture.mjs,
barwise/scripts/tests/gates.test.mjs, barwise/scripts/tests/expected-counts.json,
barwise/parity.manifest.json, barwise/audit-baseline.json, CLAUDE.md,
barwise/docs/adr/connector-packages.md, barwise/docs/adr/package-graph-authority.md,
barwise/docs/adr/must-agree-copies.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md, .beads/issues.jsonl

## Principle

**Orthogonality**, and the owner's decision of 2026-11-06 (adr-refactor
WS1, row 1): every interop format is its own format, with one interface
and one implementation approach. Today four are split in half. Core holds
`renderDdl`, `renderOpenApi`, `renderAvro` and `renderDbt` (1,309 lines in
`core/src/mapping/renderers/`, with the population renderers in
`core/src/export/populationRenderer.ts`), and the connector holds a thin
descriptor that calls back into core. A change to the DDL format edits two
packages; core exports format-specific text writers no part of core uses;
and the split forced three must-agree copies the parity manifest has to
hold together (`pascal-case-avro`, `pascal-case-openapi`,
`sql-quote-ident`).

The same split runs through SQL parsing. `@barwise/formats` and
`@barwise/dbt` each carry a byte-identical `SqlglotBridge.ts`, held by
the `sqlglot-bridge` parity set, because a connector could not import
another. The owner's direction (row 24): share by composition, a function
both sides call, wherever sharing couples nothing that should stay apart;
a parity check only where sharing would.

## What stays in core (resolved with the owner: the relational core)

- **`RelationalMapper`** and the relational schema types. ORM is a
  relational technology, the mapping is core domain, and it has a
  consumer that is no format: `barwise schema` in the CLI, and dbt's
  `exportedColumns`.
- **`core/sql`**, `parseSqlFile` and its cascade. Core's own mapping uses
  it (`constraintRouting.ts`, `dialectCapabilities.ts`), so it is not a
  format's private parser. The sqlglot bridge is not in core and cannot
  be: it runs a subprocess.
- **The export annotation collector** (`annotation/ExportAnnotationCollector.ts`),
  which is format-neutral; only its dbt rendering moves.

## Scope

In scope:

- The DDL, OpenAPI and Avro renderers, `names.ts`, and both population
  renderers move into `@barwise/formats` beside their descriptors, and
  `@barwise/core/mapping` stops exporting them.
- `renderDbt`, `DBT_KEY_TEST`, `dbtKeyTestColumns` and
  `annotateDbtExport` move into `@barwise/dbt`.
- `@barwise/dbt` depends on `@barwise/formats` (`INTENDED`, the root
  `CLAUDE.md` block and its `package.json` in one commit, per
  `package-graph-authority`). `@barwise/formats` exports one function,
  `parseSqlPatterns(sql, sourcePath, dialect)`: the sqlglot bridge with
  the regex fallback to core's `parseSqlFile`, normalized as both
  importers do today. Both importers call it, and dbt's copy of the bridge
  is deleted.
- The four parity sets the moves make shareable are shared and their
  manifest entries removed: `pascal-case-avro`, `pascal-case-openapi`,
  `sql-quote-ident`, `sqlglot-bridge`.
- When a renderer moves, the tests that exercise it move with it: core
  tests that render DDL to observe the mapping either assert on the
  `RelationalSchema` instead, or move to the connector. A test is not
  deleted to make the move pass.
- The ADR edits and enforcers in WS4.

Out of scope: moving `core/sql` (it serves core's own mapping); the CLI
and MCP must-agree copies (barwise-ym8.gc9.e76); format extensions
(barwise-83g).

## Inventory

| Code today                                                   | Destination                                                    |
| ------------------------------------------------------------ | -------------------------------------------------------------- |
| `core/src/mapping/renderers/ddl.ts`                          | `formats/src/ddl/renderDdl.ts`                                 |
| `core/src/mapping/renderers/openapi.ts`                      | `formats/src/openapi/renderOpenApi.ts`                         |
| `core/src/mapping/renderers/avro.ts`, `names.ts`             | `formats/src/avro/` (merged with `avroNames.ts`)               |
| `core/src/export/populationRenderer.ts`                      | `formats/src/population/` (SQL inserts, OpenAPI examples)      |
| `core/src/mapping/renderers/dbt.ts`, `DbtExportAnnotator.ts` | `dbt/src/render/`                                              |
| `dbt/src/sql/SqlglotBridge.ts`                               | deleted; `formats/src/sql/parseSqlPatterns.ts` is the one path |
| `core/src/export/types.ts`'s `ExportAnnotation` import       | from `annotation/ExportAnnotationCollector.ts` directly        |

Callers to repoint, measured 2026-11-06 with a grep for every moved
symbol: `formats/src/{ddl,openapi,avro}/*ExportFormat.ts` and
`avroNames.ts`; `dbt/src/DbtExportFormat.ts`,
`dbtMapping/analyze.ts`, `dbtMapping/compositeKeys.ts`; tests in core
(`mapping/ddl|openapi|avro|dbt|DbtExportAnnotator.test.ts`,
`export/populationRenderer.test.ts`, and 20 render calls across
`RelationalMapper`, `objectifiedMapping`, `subtypeMapping`,
`externalPreferredIdentifier`, `integration/fullPipeline` and
`integration/multiFileProject`), in cli
(`characterization/formatDefects.ts`, `commands/schema.test.ts`,
`compositeForeignKeyRoundTrip.test.ts`), in formats (`roundtrip`,
`NormaXmlImporter`, the export format tests), in dbt
(`DbtExportFormat.test.ts`) and in vscode
(`unit/exportDdlCommand.test.ts`). Core's tests cannot import a connector
even as a dev dependency: Turborepo would see a cycle (core's tests need
formats built, formats needs core built).

## Workstreams

### 1. DDL, OpenAPI and Avro renderers into `@barwise/formats`

Move the files in the inventory, export the renderers from
`@barwise/formats` for the CLI and tests, drop them from
`@barwise/core/mapping`, and repoint every caller. Core's tests that
rendered DDL only to observe the mapping assert on the `RelationalSchema`
the mapper returns; a test whose point is the rendered text moves to
formats. Share `toPascalCase` and `quoteIdent` and remove the three
parity sets. Verified by every package's suite, `npm run build`, and
`check:parity` passing with the three entries gone.

### 2. The dbt renderer into `@barwise/dbt`

Move `dbt.ts` and `DbtExportAnnotator.ts`, repoint `DbtExportFormat`,
`analyze.ts` and `compositeKeys.ts`, and import `ExportAnnotation` in
`core/src/export/types.ts` from the collector. dbt already depends on
`yaml`.

### 3. dbt composes formats' SQL parser

Add the `dbt -> formats` edge (`INTENDED`, root `CLAUDE.md` block, dbt's
`package.json`, lockfile). Add `parseSqlPatterns` to `@barwise/formats`
as the bridge-then-regex cascade the two importers each inline today;
both call it; delete `dbt/src/sql/SqlglotBridge.ts` and its tests'
duplicates; remove the `sqlglot-bridge` parity set. The sqlglot bridge
tests stay in formats and keep running in CI with the sqlglot group
synced.

### 4. The decisions and their enforcers

- **`connector-packages`.** Decision 3 is rewritten: "A format's
  rendering and parsing live in its connector; core keeps the relational
  mapping and the SQL parsing its own mapping uses." Decision 1's
  enforcer (barwise-ym8.paz), widened as row 1 decided: a core test pins
  the names `@barwise/core` and each of its subpath exports export,
  against a reviewed list (an allowlist: a new export fails until listed,
  so a renderer cannot return under a new name), and a check fails on a
  value in `core/src` that implements `ImportFormat` or
  `ExportFormatAdapter`. The `{#descriptor-wraps-core}` id goes with the
  rewritten decision; its gap issue (barwise-ym8.y5z) closes.
- **`package-graph-authority`.** A new decision, `{#core-external-deps}`:
  "Core's runtime dependencies are only those listed beside `INTENDED`"
  (today `ajv`, `effect`, `yaml`). `check:architecture` extends
  `runtime-deps-within` to external packages for core, with a
  `probes.json` row planting `z3-solver` in core's `package.json`; a
  depcruise rule fails an import in core that its `package.json` does not
  declare (`no-non-package-json`), which closes the hoisted-import gap.
- **`must-agree-copies`.** Decision 2, `{#check-first}`, becomes
  `{#share-by-composition}` (owner, row 24): share a copy by composition
  where the package graph lets both sides reach one owner; a parity
  check only where sharing would couple packages `INTENDED` keeps apart.
  Its gap issue (barwise-ym8.3tg) is narrowed to the classification
  barwise-ym8.gc9.7fb will mechanize.
- Each ADR edit moves `Date:`, cites decisions by id, and regenerates
  `ARCHITECTURE.md`; each new gate gets a `probes.json` row.

## Order and PRs

One PR per workstream, in order. WS1 to WS3 change code and keep every
gate green on their own; WS4 lands the decisions once the code matches
them, so no ADR states a rule the tree breaks.

## Open decisions (for review)

1. **Where the renderers' public exports live.** Recommended:
   `@barwise/formats` and `@barwise/dbt` export them from their package
   roots, so the CLI's `schema` command and tests import from one place.
   Alternative: a `@barwise/formats/render` subpath, which keeps the
   descriptor API separate from the renderers. The root is simpler and
   nothing outside the repository imports these.
2. **The core export allowlist's granularity.** Recommended: per
   subpath, names only (a JSON list beside the test), so a reviewer sees
   one line per new export. Types-only exports are included, since a
   type is surface too.

## Risks and testing

- **A moved test silently stops running.** `test:scripts` counts only
  script tests, and each package's suite has no count ratchet. Each
  workstream's PR states the per-package test count before and after,
  and the counts must reconcile (moved tests leave one package and arrive
  in another).
- **The vscode bundle.** esbuild bundles formats and dbt; moving code
  between them does not change what is bundled, but the bundle is built
  and its test run in each PR.
- **A behaviour change hiding in a move.** Each file moves verbatim in
  one commit and is edited (imports, shared helpers) in the next, so the
  diff of the move commit reads as a rename.
