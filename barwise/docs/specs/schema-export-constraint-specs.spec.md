# OpenAPI, Avro and dbt exports report the constraints they drop

Status: Draft

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-u8y
Touches: +barwise/packages/core/src/mapping/constraintRouting.ts,
+barwise/packages/core/src/mapping/constraintSpec.ts,
+barwise/packages/core/src/mapping/dialectCapabilities.ts,
+barwise/packages/core/src/mapping/valuePredicate.ts,
barwise/packages/core/src/mapping/index.ts,
barwise/packages/core/CLAUDE.md,
barwise/packages/formats/src/constraintSpec.ts,
barwise/packages/formats/src/ddl/constraintRouting.ts,
barwise/packages/formats/src/ddl/dialectCapabilities.ts,
barwise/packages/formats/src/ddl/valuePredicate.ts,
barwise/packages/formats/src/ddl/DdlExportFormat.ts,
barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/src/openapi/OpenApiExportFormat.ts,
barwise/packages/formats/src/avro/AvroExportFormat.ts,
barwise/packages/formats/CLAUDE.md,
barwise/packages/dbt/src/DbtExportFormat.ts,
barwise/packages/formats/tests/DdlDialectExport.test.ts,
barwise/packages/formats/tests/valuePredicate.test.ts,
barwise/packages/formats/tests/ConstraintRouting.test.ts,
barwise/packages/formats/tests/constraintsAcrossFactTypes.test.ts,
barwise/packages/formats/tests/OpenApiExportFormat.test.ts,
barwise/packages/formats/tests/AvroExportFormat.test.ts,
barwise/packages/dbt/tests/DbtExportFormat.test.ts,
barwise/docs/IMPORT_EXPORT.md

When the OpenAPI, Avro or dbt exporter writes a model, each constraint
the DDL router would spill if the target had neither UNIQUE nor CHECK
shall appear in `ExportResult.constraintSpecs`, as DDL and Ossie
constraints already do. Today those three formats report nothing, and
the export report (`export-constraint-specs.spec.md`) prints no losses
for them: a silence that reads as "nothing lost" when most of a model's
non-structural constraints are lost.

## Principle

Composability and orthogonality. All three exporters render the
`RelationalSchema` that `RelationalMapper` builds, which carries columns,
nullability, primary keys and foreign keys and nothing else. The DDL
router (`routeConstraints`) already decides, constraint by constraint,
what that schema realized and what needs an extra UNIQUE or CHECK clause
or must spill. A format with no UNIQUE and no CHECK clause is a dialect
whose profile marks both absent, and the router then spills exactly what
the schema did not carry. So the three formats reuse the router's
judgement with that profile instead of defining "realized" a second time.

The router, its dialect profiles, its value predicate and the spec
builder are pure functions of the model, the schema and the profile.
They move into `@barwise/core/mapping`, beside `RelationalMapper` and
`renderDdl`, which already live there, so `@barwise/dbt`, which depends
on `core` only, can call them. `@barwise/formats` keeps the DDL format
descriptor and calls them back, as it already does for `renderDdl`.

## Observed today (at c330c792)

- **Input.** OpenAPI (`OpenApiExportFormat.ts:49-69`), Avro
  (`AvroExportFormat.ts:56-70`) and dbt (`DbtExportFormat.ts:56-71`) map
  the model and pass only the schema to `renderOpenApi`, `renderAvro` and
  `renderDbt`. None reads a constraint or sets `constraintSpecs`.
- **The router's rule for "realized".** `routeConstraints`
  (`formats/src/ddl/constraintRouting.ts`) skips every mandatory as
  realized (`case "mandatory": break`); skips an internal uniqueness
  unless it is a secondary unique value column or a second key of an
  n-ary table, which it routes as UNIQUE; routes a value constraint or a
  same-table value comparison as CHECK; routes an external uniqueness
  with one table's columns as UNIQUE unless it is the whole primary key;
  spills everything else; and returns early, with no spill, for a
  constraint over subtypes. A second loop routes a value type's own
  value constraint as a CHECK on each role it plays.
- **A profile with both clauses absent spills both.** `route()` spills
  with "UNIQUE is not supported by <dialect>" or "CHECK is not supported
  by <dialect>" when the profile says `absent`. So
  `{ unique: "absent", check: "absent" }` turns every clause the router
  would add into a spill, and leaves the realized-structurally skips as
  they are. Measured over the 84 tracked `.orm.yaml` files that load and
  map: with that profile the router returns no clauses and, in every
  model, as many spills as the postgres profile's spills and clauses
  together; 363 specs in all, which is what the three formats would
  report over the corpus (script:
  `routeConstraints(model, schema, profile)` both ways per model).
- **Dependencies.** `buildConstraintSpec` (`formats/src/constraintSpec.ts`)
  needs only core, its counterexample and its verbalization subpaths,
  plus the file's own `findRole`. The router adds `valuePredicate.ts`
  (which `DdlImportFormat` also reads, for `parseValuePredicate`) and
  `dialectCapabilities.ts`. `@barwise/dbt` depends on `core` only
  (`scripts/lib/intended.cjs`, `"dbt": ["core"]`), so today it can reach
  none of them.
- **Notes the three formats already write.** `collectExportAnnotations`
  notes a composite primary key and a value type's own value constraint
  (as a suggestion for an `accepted_values` test), for all three; dbt
  writes them as YAML comments through `annotateDbtExport`. Neither is a
  `ConstraintSpec`, and neither survives an export with annotations off.

## Scope

- When the OpenAPI, Avro or dbt exporter writes a model, it shall run
  the router with `{ unique: "absent", check: "absent" }` over the schema
  it rendered and return the spilled constraints' specs as
  `constraintSpecs`, and no `constraintSpecs` field when none spill.
- When the DDL exporter writes a model in any dialect, its text and its
  `constraintSpecs` shall not change.
- When the Ossie exporter writes a model, its output shall not change.

What this does not report, each a gap the router already has for DDL and
none made worse here:

- A constraint over subtypes. The router skips it, and DDL carries it in
  the barwise annotation instead; the spec builder has no roles to label
  for it. The three formats carry it nowhere. Filed as barwise-lwy.
- A mandatory role the mapping did not enforce. The router counts every
  mandatory as realized, but a mandatory on a role of a many-to-many fact
  type ("each Person speaks some Language") becomes a key column of an
  associative table, which says nothing about every Person having a row.
  DDL is silent on it today. Filed as barwise-plq.
- A key's uniqueness in a format with no keys (Avro, OpenAPI). The
  router counts it realized by the primary key, which Avro and OpenAPI
  do not enforce. Open decision 2.

## Workstreams

### 1. The router and the spec builder move to core

`constraintRouting.ts`, `dialectCapabilities.ts`, `valuePredicate.ts`
and `constraintSpec.ts` move from `formats/src` to `core/src/mapping`,
exported from `@barwise/core/mapping`. `findRole` (a role and its fact
type, the given fact type first) moves with them and stays internal to
the module: both of its callers move too, so core gains no second public
role lookup beside `OrmModel.findRole`. The formats files go;
`DdlExportFormat`, `DdlImportFormat` (which reads
`parseValuePredicate`) and `writeOssie` import from core, and the four
formats tests that import the moved files (`DdlDialectExport`,
`valuePredicate`, `ConstraintRouting`, `constraintsAcrossFactTypes`)
import them from `@barwise/core/mapping` and stay in formats, beside
the DDL descriptor they exercise. Both package
CLAUDE.md layouts are updated. Acceptance: the formats and dbt suites
pass unchanged, and DDL export of every tracked `.orm.yaml` in every
dialect is byte-identical before and after, with the same
`constraintSpecs`.

### 2. dbt, OpenAPI and Avro report

Each adapter calls `routeConstraints(model, schema, NO_CLAUSES, name)`
and returns its spilled specs. Acceptance: for each format, a test model
holding a secondary uniqueness, a role value constraint, a value type
value constraint, a value comparison, a ring and a subset reports all
six and no mandatory; the CLI, MCP and editor reports show them through
the existing `formatConstraintReport` path with no surface change; the
counts over the tracked models are recorded here.

The router's spill reason ("CHECK is not supported by openapi") does
not reach the report: `ConstraintSpec` carries only the verbalization,
pseudocode and example, and the reason is written only into DDL's SQL
comments. So the three formats need no format-shaped reason.

## Open decisions

1. **How `@barwise/dbt` reaches the router.** (a) Move it to
   `@barwise/core/mapping` (recommended): pure, beside the mapper and
   DDL renderer it reads, and reachable from every package without a new
   edge. (b) Give `@barwise/dbt` a dependency on `@barwise/formats`: no
   move, but the first connector-to-connector edge, and dbt carries
   formats' whole surface for one function. (c) A copy in dbt: two
   routers that must agree, which a byte-identical copy could register
   in `parity.manifest.json` but which then must change in lockstep.
   Recommend (a).
2. **A key's uniqueness in Avro and OpenAPI.** Avro writes a primary key
   as a `doc` line, OpenAPI as a path parameter; neither enforces
   uniqueness. (a) Leave it out of this change and file it
   (recommended): reporting it needs the router to say which uniqueness
   a key realized, which it does not record today, and it adds one entry
   per entity to every Avro and OpenAPI report. (b) Report it now: needs
   that new router output in workstream 1. Recommend (a), filed as
   barwise-lqj in the same commit as this spec.

## Risks and testing

Workstream 1 is a move of a working router; the byte-identical DDL
corpus diff across dialects is its gate. Workstream 2 is the
user-visible change, pinned per format by the six-kind test. The three
gaps above are named so a reader does not take the new reports for a
complete account.
