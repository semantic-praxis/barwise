# @barwise/formats

Standard interop format descriptors for ORM models: DDL, OpenAPI, Avro,
NORMA, and SQL. These are the formats core used to ship as "builtins".
They now register from outside core through the `FormatDescriptor`
registry, the same connector convention as `@barwise/code-analysis` and
`@barwise/dbt`, so `@barwise/core` ships no interop format -- only the
registry, the format interfaces, and the native `.orm.yaml`.

## Dependency Rule

This package depends on `@barwise/core` for model types, the
`ImportFormat` / `ExportFormatAdapter` interfaces, the format registry,
and the capabilities the descriptors wrap: `RelationalMapper`, the
renderers (`renderDdl`, `renderOpenApi`, `renderAvro`),
`renderPopulationAsSql`, and the SQL cascade parser (`parseSqlFile`). It
does NOT depend on any editor or tool package.

Allowed runtime dependencies: `@barwise/core`, `yaml`, `fast-xml-parser`.
No others without discussion. The SQL importer uses `node:fs` for its
directory-scan path and spawns an optional short-lived `python3`
subprocess for the sqlglot structural tier (allowed outside core; the
cascade degrades to core's pure regex tier when python3 or sqlglot is
absent).

## Package Layout

```
src/
  index.ts                       Public API
  registration.ts                The 5 descriptors + registerStandardFormats()
  ddl/DdlImportFormat.ts         SQL DDL -> ORM
  ddl/DdlExportFormat.ts         ORM -> SQL DDL (wraps renderDdl; applies the
                                 dialect constraint routing as a text pass)
  ddl/dialectCapabilities.ts     Per-dialect constraint capability profiles
                                 (native / informational / absent)
  ddl/constraintRouting.ts       Routes model constraints to UNIQUE/CHECK
                                 clauses or the ConstraintSpec spillway
  openapi/OpenApiImportFormat.ts OpenAPI 3.x -> ORM
  openapi/OpenApiExportFormat.ts ORM -> OpenAPI JSON (wraps renderOpenApi)
  avro/AvroExportFormat.ts       ORM -> Avro schema (wraps renderAvro)
  sql/SqlImportFormat.ts         Raw SQL files -> ORM (text + directory scan)
  sql/SqlglotBridge.ts           Optional sqlglot sidecar: structural SQL tier
                                 + sourceText normalization
  norma/NormaImportFormat.ts     NORMA .orm XML -> ORM
  norma/NormaExportFormat.ts     ORM -> NORMA .orm XML
  norma/NormaXmlImporter.ts      NORMA import facade
  norma/NormaXmlParser.ts        NORMA XML parsing (fast-xml-parser)
  norma/NormaToOrmMapper.ts      NORMA document -> ORM model
  norma/NormaXmlTypes.ts         NORMA XML types
tests/
  helpers/ModelBuilder.ts  Fluent model builder (test-only)
  fixtures/*.orm           NORMA XML fixtures
  *.test.ts                Mirrors src/
```

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check only
```

Lint is run from the repo root: `npm run lint`.

## Key Conventions

- Importers follow the `ImportFormat` interface; exporters follow
  `ExportFormatAdapter`. The export descriptors are thin shells: the
  rendering capability stays in core and the descriptor calls back into
  it.
- Format registration uses `registerStandardFormats()`, called at tool
  startup alongside `registerDbtFormats()` and `registerCodeFormats()`.

## Dependencies

| Direction | Package         | What is used                                                       |
| --------- | --------------- | ------------------------------------------------------------------ |
| Upstream  | `@barwise/core` | Model types, ImportFormat/ExportFormatAdapter, registry, renderers |
