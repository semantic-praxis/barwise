# @barwise/dbt

dbt connector for ORM models. Imports a dbt project (schema YAML + SQL
models) into an ORM model and exports an ORM model as dbt schema YAML.
This is a connector package: it owns its filesystem and subprocess I/O
and plugs into `@barwise/core` through the `FormatDescriptor` registry,
the same pattern as `@barwise/code-analysis`. Core ships no dbt format.

## Dependency Rule

This package depends on `@barwise/core` for model types, the
`ImportFormat` / `ExportFormatAdapter` interfaces, the format registry,
the SQL cascade parser (`parseSqlFile`), and the dbt rendering
capability (`renderDbt`, `annotateDbtExport`). It does NOT depend on any
editor or tool package.

Allowed runtime dependencies: `@barwise/core`, `yaml`. No others without
discussion. The package uses `node:fs` for project discovery and
`node:child_process` (via `DbtSqlCompiler`) for `dbt compile`.

## Package Layout

```
src/
  index.ts              Public API
  registration.ts       createDbtFormat() + registerDbtFormats()
  DbtImportFormat.ts     ImportFormat: scans a dbt project directory
  DbtProjectImporter.ts  Pure: schema YAML contents -> OrmModel
  DbtSchemaParser.ts     Pure: parse dbt schema YAML
  DbtSchemaTypes.ts      dbt schema YAML types
  DbtToOrmMapper.ts      Pure: dbt schema -> ORM model + report
  DbtImportReport.ts     Inference report builder
  DbtYamlAnnotator.ts    Annotate dbt YAML with import findings
  DbtDialectDetector.ts  Resolve SQL dialect from profiles.yml/options
  DbtSqlCompiler.ts      Compile SQL models (dbt compile / stub Jinja)
  DbtExportFormat.ts     ExportFormatAdapter: ORM model -> dbt schema YAML
tests/
  helpers/ModelBuilder.ts  Fluent model builder (test-only)
  *.test.ts                Mirrors src/
```

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check only
```

Lint is run from the repo root: `npm run lint`.

## Key Conventions

- The importer follows the `ImportFormat` interface from `@barwise/core`
  (`inputKind: "directory"`; `parseAsync` scans the project).
- The exporter follows the `ExportFormatAdapter` interface and wraps
  core's `renderDbt` -- the rendering capability stays in core; this
  package owns only the descriptor.
- Format registration uses `registerDbtFormats()` called at tool
  startup, alongside `registerBuiltinFormats()` and
  `registerCodeFormats()`.

## Dependencies

| Direction | Package         | What is used                                                        |
| --------- | --------------- | ------------------------------------------------------------------ |
| Upstream  | `@barwise/core` | Model types, ImportFormat/ExportFormatAdapter, registry, renderDbt |
