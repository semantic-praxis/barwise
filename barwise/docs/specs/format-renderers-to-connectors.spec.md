# Format renderers live in their connectors, and dbt composes formats' SQL parser

Status: WS1 implemented 2026-11-06 (the DDL, OpenAPI, Avro and population renderers in `@barwise/formats`; `connector-packages.md#format-in-its-connector` held by `core/tests/public/exports.test.ts`); WS2-WS4 not started

Created: 2026-11-06
Last-updated: 2026-11-06
Tracking: barwise-ym8.gc9 (adr-refactor WS1 rows 1 and 24; barwise-ym8.y5z,
barwise-ym8.paz, barwise-ym8.3tg), barwise-ym8.gc9.e76
Touches: barwise/packages/core/src/mapping/, barwise/packages/core/src/export/,
barwise/packages/core/src/annotation/, barwise/packages/core/src/sql/,
barwise/packages/core/tests/, barwise/packages/core/CLAUDE.md,
barwise/packages/formats/src/, barwise/packages/formats/tests/,
barwise/packages/formats/package.json, barwise/packages/formats/CLAUDE.md,
barwise/packages/dbt/src/, barwise/packages/dbt/tests/,
barwise/packages/dbt/package.json, barwise/packages/dbt/CLAUDE.md,
barwise/packages/cli/src/, barwise/packages/cli/tests/,
barwise/packages/mcp/src/, barwise/packages/vscode/tests/,
barwise/package-lock.json, barwise/scripts/lib/intended.cjs,
+barwise/scripts/lib/external-deps.cjs, barwise/scripts/check-architecture.mjs,
barwise/scripts/tests/gates.test.mjs, barwise/scripts/tests/expected-counts.json,
barwise/parity.manifest.json, CLAUDE.md,
barwise/docs/adr/connector-packages.md, barwise/docs/adr/package-graph-authority.md,
barwise/docs/adr/must-agree-copies.md, barwise/docs/adr/probes.json,
barwise/docs/ARCHITECTURE.md, .beads/issues.jsonl
Plan-reviewed: c4003177 (code-review, pr-review)

## Principle

**Orthogonality**, and the owner's decision of 2026-11-06 (adr-refactor
WS1, row 1): every interop format is its own format, with one interface
and one implementation approach. Today four are split in half. Core holds
`renderDdl`, `renderOpenApi`, `renderAvro` and `renderDbt` (1,309 lines in
`core/src/mapping/renderers/`, with the population renderers in
`core/src/export/populationRenderer.ts`), and the connector holds a thin
descriptor that calls back into core. A change to the DDL format edits two
packages, core exports format-specific text writers no part of core uses,
and the split forced two must-agree copies the parity manifest has to hold
together (`pascal-case-avro`, `pascal-case-openapi`). A third,
`sql-quote-ident`, has both members in core (`ddl.ts` and
`populationRenderer.ts`); both move to formats and are shared there.

The same split runs through SQL parsing. `@barwise/formats` and
`@barwise/dbt` each carry a `SqlglotBridge.ts` identical below its header,
held by the `sqlglot-bridge` parity set (`ignore: leading-docblock`),
because a connector could not import another. The owner's direction (row
24): share by composition, a function both sides call, wherever sharing
couples nothing that should stay apart; a parity check only where sharing
would.

## What stays in core (resolved: the relational core)

- **`RelationalMapper`** and the relational schema types. ORM is a
  relational technology (owner, 2026-11-06), the mapping is core domain,
  and it has consumers that are no format: `barwise schema` in the CLI
  imports it directly (it reaches renderers only through `getExporter`),
  as does dbt's `exportedColumns`.
- **The SQL dialect types and value predicates** in `core/sql`:
  `SqlDialect` and `SQL_DIALECTS` (`types.ts`), and `parseValuePredicate`
  and `renderValuePredicate` (`valuePredicate.ts`). Core's own mapping
  uses them (`dialectCapabilities.ts` the dialect type,
  `constraintRouting.ts` the predicate renderer), and the CLI and MCP read
  `SQL_DIALECTS`.
- **The export annotation collector**
  (`annotation/ExportAnnotationCollector.ts`), which is format-neutral;
  only its dbt rendering moves.

**Not the SQL parser.** Measured 2026-11-06 in plan review: nothing in
`core/src` outside `core/src/sql` calls `parseSqlFile`,
`SqlCascadeParser`, `extractSqlPatterns` or `parseSqlDataType`; their
callers are the formats and dbt importers. With dbt depending on formats,
the parser, the pattern extractor and the type mapping move to
`@barwise/formats` beside the sqlglot bridge, which cannot be in core
because it runs a subprocess. This settles the question adr-refactor row 1
left to this spec.

## Scope

In scope:

- The DDL, OpenAPI and Avro renderers, `names.ts`, and both population
  renderers move into `@barwise/formats` beside their descriptors, and
  `@barwise/core/mapping` stops exporting them.
- `renderDbt`, `DBT_KEY_TEST`, `dbtKeyTestColumns` and
  `annotateDbtExport` move into `@barwise/dbt`.
- `@barwise/dbt` depends on `@barwise/formats` (`INTENDED`, the root
  `CLAUDE.md` block and dbt's `package.json` in one commit, per
  `package-graph-authority`). The SQL parser modules move from `core/sql`
  to `formats/src/sql`. `@barwise/formats` exports one function,
  `parseSqlPatterns(sql, sourcePath, dialect)`: the sqlglot bridge with the
  regex fallback, normalized as both importers do today. Both importers
  call it, and dbt's copy of the bridge is deleted.
- The parity sets the moves make shareable are shared and their manifest
  entries removed: `pascal-case-avro`, `pascal-case-openapi`,
  `sql-quote-ident`, `sqlglot-bridge`.
- When code moves, the tests that exercise it move with it. A core test
  that rendered DDL only to observe the mapping asserts on the
  `RelationalSchema` instead; a test whose point is the rendered text
  moves to the connector. No test is deleted to make a move pass, and each
  PR reconciles per-package test counts before and after.
- Each ADR edit lands in the PR whose code makes it true, with its
  enforcer, so no ADR states a rule the tree breaks.

Out of scope: the dialect types and value predicates, which core's
mapping uses; the remaining must-agree copies, CLI and MCP included
(barwise-ym8.gc9.e76); format extensions (barwise-83g).

## Inventory

| Code today                                                   | Destination                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------- |
| `core/src/mapping/renderers/ddl.ts`                          | `formats/src/ddl/renderDdl.ts`                             |
| `core/src/mapping/renderers/openapi.ts`                      | `formats/src/openapi/renderOpenApi.ts`                     |
| `core/src/mapping/renderers/avro.ts`, `names.ts`             | `formats/src/avro/`, merged with `avroNames.ts`            |
| `core/src/export/populationRenderer.ts`                      | `formats/src/population/`                                  |
| `core/src/mapping/renderers/dbt.ts`, `DbtExportAnnotator.ts` | `dbt/src/render/`                                          |
| `core/src/sql/` parser, extractor, type mapping              | `formats/src/sql/`                                         |
| `dbt/src/sql/SqlglotBridge.ts`                               | deleted; `formats/src/sql/parseSqlPatterns.ts` is the path |
| `core/src/export/types.ts`'s `ExportAnnotation` import       | from `annotation/ExportAnnotationCollector.ts` directly    |

Callers to repoint, measured 2026-11-06 with a grep for every moved
symbol:

- `formats/src/{ddl,openapi,avro}/*ExportFormat.ts`, `avroNames.ts`, and
  `ddl/DdlImportFormat.ts` (`parseSqlDataType`);
- `dbt/src/DbtExportFormat.ts`, `DbtImportFormat.ts`,
  `DbtDialectDetector.ts`, and `dbtMapping/analyze.ts`, `compositeKeys.ts`,
  `naming.ts`, `sqlPatterns.ts`;
- tests in core: `mapping/ddl|openapi|avro|dbt|DbtExportAnnotator.test.ts`,
  `export/populationRenderer.test.ts`, the parser tests under
  `tests/sql/`, 14 `renderDdl` calls across `RelationalMapper`,
  `objectifiedMapping`, `subtypeMapping`, `integration/fullPipeline` and
  `integration/multiFileProject`, and `externalPreferredIdentifier`'s use
  of `renderPopulationAsOpenApiExamples`;
- tests in cli (`characterization/formatDefects.ts`,
  `commands/schema.test.ts`, `compositeForeignKeyRoundTrip.test.ts`), in
  formats (`roundtrip`, `NormaXmlImporter`, the export format tests), in
  dbt (`DbtExportFormat.test.ts`, the bridge tests) and in vscode
  (`unit/exportDdlCommand.test.ts`).

Core's tests cannot import a connector even as a dev dependency: Turborepo
would see a cycle, since core's tests would need formats built and formats
needs core built.

## Workstreams

### 1. DDL, OpenAPI and Avro renderers into `@barwise/formats`

Move the files, export the renderers from `@barwise/formats`, drop them
from `@barwise/core/mapping`, repoint every caller and move the tests.
Share `toPascalCase` and `quoteIdent` and remove the
`pascal-case-avro`, `pascal-case-openapi` and `sql-quote-ident` sets.

`connector-packages` decision 3 is rewritten in this PR, with dbt's
renderer and the SQL parser recorded in Consequences as the two pieces
still to move (WS2, WS3), so the ADR and the tree agree at every merge.
Decision 1, `core-no-interop`, gets its enforcer here: a core test pins
the names `@barwise/core` and each subpath export against a reviewed list
beside it (an allowlist, so a renderer cannot return under a new name),
and fails on a value in `core/src` implementing `ImportFormat` or
`ExportFormatAdapter`. It is a `tests` entry, so its plant (a renderer
export added back to core) goes in the PR body, as `adr-writing.md` says
for tests; `probes.json` replays only `npm` entries. barwise-ym8.paz
closes.

Each file moves with its import paths rewritten in the same commit (git
still records the rename at high similarity), so every commit builds and
the hooks pass.

### 2. The dbt renderer into `@barwise/dbt`

Move `dbt.ts` and `DbtExportAnnotator.ts`, repoint `DbtExportFormat`,
`analyze.ts` and `compositeKeys.ts`, and import `ExportAnnotation` in
`core/src/export/types.ts` from the collector. dbt already depends on
`yaml`. The Consequences note for the dbt renderer comes off decision 3.

### 3. dbt composes formats' SQL parser

- Add the `dbt -> formats` edge: `INTENDED`, the root `CLAUDE.md` block,
  dbt's `package.json` and the lockfile.
- Move the parser modules from `core/sql` to `formats/src/sql`, and add
  `parseSqlPatterns` there as the bridge-then-regex cascade both importers
  inline today. Both call it.
- Delete `dbt/src/sql/SqlglotBridge.ts` and the dbt bridge tests that
  formats already has (the three ambient-uv ones). Move
  `SqlglotBridge.mocked.test.ts` to formats and point it at formats'
  bridge: its 8 tests mock `node:child_process`, formats has none like
  them, and they keep the one bridge covered whether or not uv answers in
  time.
- Remove the `sqlglot-bridge` parity set, and repoint the `probes.json`
  row for `must-agree-copies#registered-sets-identical` (its plant
  edits dbt's bridge) to a member of a set that remains.
- Update `dbt/CLAUDE.md` and the bridge's header, which say dbt owns its
  sqlglot subprocess.
- The Consequences note for the SQL parser comes off
  `connector-packages` decision 3. `must-agree-copies` decision 2,
  `{#check-first}`, becomes `{#share-by-composition}` (owner, row 24):
  "A new copy that must agree is shared by composition wherever the
  package graph lets both sides reach one owner; a parity check is for
  copies whose sharing would couple packages `INTENDED` keeps apart." The
  sets the manifest holds today that sharing could remove (the CLI and MCP
  copies, the test builders) are listed in Consequences as known
  violations under barwise-ym8.gc9.e76, which classifies each, so the
  decision does not claim the tree already holds it. barwise-ym8.3tg is
  narrowed to that classification.

### 4. Core's external dependencies are listed and checked

`package-graph-authority` gains `{#core-external-deps}`: "Core's runtime
dependencies are only those `external-deps.cjs` lists" (today `ajv`,
`effect`, `yaml`). The list is a separate file,
`barwise/scripts/lib/external-deps.cjs`, because `intended.cjs`'s export
is the package map itself and every consumer reads each key as a package.
`check:architecture` extends `runtime-deps-within` to external packages
for core, with a `probes.json` row planting `z3-solver` in core's
`package.json`. An import in core that its `package.json` does not declare
is already caught by `npm run knip` in CI (its `unlisted` check,
measured in plan review with a planted `fast-xml-parser` import), so the
decision declares knip beside `check:architecture` instead of adding a
dependency-cruiser rule, which cannot see external edges under the
config's `includeOnly`.

## Order and PRs

One PR per workstream, in order. Each carries the ADR edits its code
makes true (decision ids, `Date:`, regenerated `ARCHITECTURE.md`) and its
enforcers: a `probes.json` row for each new `npm` gate, a PR-body plant
line for each new `tests` entry.

## Open decisions (for review)

1. **Where the moved code is exported.** Recommended: from the package
   roots of `@barwise/formats` and `@barwise/dbt`, so tests and callers
   import from one place. Alternative: a `@barwise/formats/render`
   subpath. Nothing outside the repository imports these.
2. **The core export allowlist's granularity.** Recommended: per subpath,
   names only, types included (a type is surface too), in a JSON list
   beside the test, so a reviewer sees one line per new export.

## Risks and testing

- **A moved test silently stops running.** Package suites have no count
  ratchet, so each PR states per-package test counts before and after,
  and they must reconcile.
- **The vscode bundle.** esbuild bundles formats and dbt. The bundle is
  built and its tests run in each PR.
- **A behaviour change hiding in a move.** Each file's move commit
  changes only its import paths; edits to shared helpers follow in a
  separate commit.
