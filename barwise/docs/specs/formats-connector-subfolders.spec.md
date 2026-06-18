# Per-connector subfolders in @barwise/formats

Status: Approved (user-directed 2026-06-18) -- structural refactor,
implemented alongside the NORMA exporter
Created: 2026-06-18
Last-updated: 2026-06-18
Tracking: barwise-h3f, docs/specs/norma-export.spec.md, barwise-8kh,
docs/specs/refactor-metamodel-consolidation.spec.md (Lane B*)

## Principle

`@barwise/formats` bundles five unrelated interop connectors (DDL,
OpenAPI, Avro, SQL, NORMA) as a flat directory of fifteen files. That
flatness blurs the one-concern-per-module boundary the design favours:
the five NORMA files (importer, parser, mapper, types) read as a
subsystem, not as peers of `SqlImportFormat.ts`. Giving each connector
its own subfolder makes the package's internal structure mirror its
actual composition -- one folder per format -- and gives the NORMA
connector a single home for both its importer and the new exporter.

This is orthogonality applied to file layout: each connector's files sit
together, and a reader (or a connector-specific change like the metamodel
thread's NORMA edits) touches one folder. The change is a pure relocation
-- no behaviour change, no public-API change, identical registry wiring.

## Scope

In scope: move each connector's implementation files in
`packages/formats/src/` into a per-format subfolder (`avro/`, `ddl/`,
`openapi/`, `sql/`, `norma/`); update the relative imports in `index.ts`,
`registration.ts`, and the test files; keep `index.ts` and
`registration.ts` at the package root as the unchanged public surface and
registry wiring.

Out of scope: the NORMA exporter itself (`norma-export.spec.md`, the next
commit, lands into the new `norma/` folder). Any change to what the
connectors do, to the `FormatDescriptor` registry, or to the public
exports. `@barwise/dbt` and `@barwise/code-analysis` are already separate
connector packages and are not touched.

## Inventory

| File                     | From           | To                         |
| ------------------------ | -------------- | -------------------------- |
| `AvroExportFormat.ts`    | `formats/src/` | `formats/src/avro/`        |
| `DdlExportFormat.ts`     | `formats/src/` | `formats/src/ddl/`         |
| `DdlImportFormat.ts`     | `formats/src/` | `formats/src/ddl/`         |
| `OpenApiExportFormat.ts` | `formats/src/` | `formats/src/openapi/`     |
| `OpenApiImportFormat.ts` | `formats/src/` | `formats/src/openapi/`     |
| `SqlImportFormat.ts`     | `formats/src/` | `formats/src/sql/`         |
| `NormaImportFormat.ts`   | `formats/src/` | `formats/src/norma/`       |
| `NormaXmlImporter.ts`    | `formats/src/` | `formats/src/norma/`       |
| `NormaXmlParser.ts`      | `formats/src/` | `formats/src/norma/`       |
| `NormaToOrmMapper.ts`    | `formats/src/` | `formats/src/norma/`       |
| `NormaXmlTypes.ts`       | `formats/src/` | `formats/src/norma/`       |
| `index.ts`               | `formats/src/` | `formats/src/` (unchanged) |
| `registration.ts`        | `formats/src/` | `formats/src/` (unchanged) |

The NORMA cluster's cross-imports are all within the cluster
(`NormaImportFormat -> NormaXmlImporter -> {NormaToOrmMapper,
NormaXmlParser} -> NormaXmlTypes`), so they move together and their
relative specifiers do not change. The Avro/DDL/OpenAPI/SQL files import
only `@barwise/core` (bare) -- no intra-package relative imports to
rewrite.

## Target architecture

```
packages/formats/src/
  index.ts            public exports (unchanged symbols)
  registration.ts     FormatDescriptors + registerStandardFormats()
  avro/    AvroExportFormat.ts
  ddl/     DdlExportFormat.ts   DdlImportFormat.ts
  openapi/ OpenApiExportFormat.ts   OpenApiImportFormat.ts
  sql/     SqlImportFormat.ts
  norma/   NormaImportFormat.ts   NormaXmlImporter.ts   NormaXmlParser.ts
           NormaToOrmMapper.ts   NormaXmlTypes.ts
           (+ NormaXmlWriter.ts  NormaXmlSerializer.ts  NormaExportFormat.ts
              arrive with norma-export.spec.md)
```

## Workstreams (each independently shippable)

### 1. Relocate connectors into per-format subfolders

`git mv` each file per the inventory; update the import specifiers in
`index.ts` (`./AvroExportFormat.js` -> `./avro/AvroExportFormat.js`,
etc.), in `registration.ts` (same), and in each test
(`../src/X.js` -> `../src/<folder>/X.js`). Run the formats suite plus the
full downstream build (`@barwise/cli`, `@barwise/mcp`, `barwise-vscode`)
to confirm the relocation is behaviour-preserving.

## API and migration impact

- No public-API change: `index.ts` re-exports the same symbols from new
  paths, so `@barwise/cli` and `@barwise/mcp` (which import the package
  index, never deep paths) are unaffected. A repo-wide check confirmed no
  consumer imports a deep `@barwise/formats/...` path.
- The `FormatDescriptor` registry wiring is identical; only the import
  specifiers in `registration.ts` change.
- Test imports use relative `../src/...` paths and update with the moves.

## Risks and testing

- A pure relocation; the risk is a missed import specifier, which the
  TypeScript build (NodeNext, explicit `.js` extensions) catches
  immediately. Guard: `npm run build`, `npm run test`, `npm run lint`,
  `npm run depcruise` from `barwise/`, plus `tsc --noEmit` for formats.
- The NORMA importer files are on the metamodel thread's conflict surface
  (`refactor-metamodel-consolidation.spec.md`, Lane B). Moving them now is
  a deliberate override of that hold (user decision, barwise-h3f): the
  metamodel thread rebases its in-flight `NormaToOrmMapper` edits over the
  relocation. The move is content-free (`git mv`), so the rebase is a path
  change, not a logic conflict.

## Non-goals

- No behaviour change, no new capability -- the exporter is a separate
  commit under `norma-export.spec.md`.
- No `FormatDescriptor` registry or public-export change.
- No move of `@barwise/dbt` or `@barwise/code-analysis`; they are already
  their own connector packages.
