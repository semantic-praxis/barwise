# OpenAPI, Avro and dbt exports report the constraints they drop

Status: Implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-u8y
Plan-reviewed: b62f11b3 (code-review, pr-review)
Touches: +barwise/packages/core/src/mapping/constraintRouting.ts,
+barwise/packages/core/src/mapping/dialectCapabilities.ts,
+barwise/packages/core/src/annotation/constraintSpec.ts,
+barwise/packages/core/src/sql/valuePredicate.ts,
+barwise/packages/core/src/model/roleLookup.ts,
barwise/packages/core/src/mapping/index.ts,
barwise/packages/core/src/annotation/index.ts,
barwise/packages/core/src/sql/index.ts,
barwise/packages/core/CLAUDE.md,
barwise/packages/formats/src/ddl/DdlExportFormat.ts,
barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/src/ossie/writeOssie.ts,
barwise/packages/formats/src/openapi/OpenApiExportFormat.ts,
barwise/packages/formats/src/avro/AvroExportFormat.ts,
barwise/packages/formats/CLAUDE.md,
barwise/packages/dbt/src/DbtExportFormat.ts,
+barwise/packages/core/tests/mapping/ConstraintRouting.test.ts,
+barwise/packages/core/tests/mapping/unreportedConstraintSpecs.test.ts,
+barwise/packages/core/tests/sql/valuePredicate.test.ts,
barwise/packages/formats/tests/DdlDialectExport.test.ts,
barwise/packages/formats/tests/constraintsAcrossFactTypes.test.ts,
barwise/packages/formats/tests/OpenApiExportFormat.test.ts,
barwise/packages/formats/tests/AvroExportFormat.test.ts,
barwise/packages/dbt/tests/DbtExportFormat.test.ts,
barwise/audit-baseline.json,
barwise/review-tiers.json,
barwise/docs/specs/external-preferred-identifier.spec.md,
barwise/docs/specs/ossie-ontology-format.spec.md,
barwise/docs/specs/join-ring-constraint.spec.md,
barwise/docs/IMPORT_EXPORT.md,
barwise/docs/CLI.md,
barwise/docs/MCP.md,
barwise/packages/formats/src/constraintReport.ts,
barwise/packages/formats/tests/constraintReport.test.ts,
barwise/packages/formats/src/ossie/OssieExportFormat.ts,
barwise/packages/cli/tests/commands/exportConstraintReport.test.ts,
+barwise/packages/formats/tests/helpers/unreportedFixture.ts

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
the schema did not carry, by its own rule. So the three formats share the
router's judgement instead of defining "realized" a second time, and one
core function owns that reduction so the three adapters cannot drift.

Everything that moves is pure, so it can live in core, each piece in the
module it belongs to: the router and the dialect profiles in
`@barwise/core/mapping`, beside `RelationalMapper` and `renderDdl`; the
spec builder in `@barwise/core/annotation`, the module that already
describes export losses, since it reads no schema and the Ossie writer
uses it too; and the CHECK predicate renderer and parser in
`@barwise/core/sql`, beside `SqlDialect`. `@barwise/dbt` depends on
`core` only, so this is what lets it report at all; `@barwise/formats`
keeps the DDL and Ossie descriptors and calls back into core, as it
already does for `renderDdl`.

## Observed today (at a6e4929b)

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
  when the profile marks the capability `absent`, so a profile with
  `unique` and `check` absent turns every clause the router would add
  into a spill and leaves the realized-structurally skips as they are.
  Measured over the 84 tracked `.orm.yaml` files that load and map: that
  profile returns no clauses, and in every model as many spills as the
  postgres profile's spills and clauses together; 363 specs in all,
  which is what the three formats would report over the corpus (script:
  `routeConstraints` with each profile, per model). That equality is not
  an invariant: the router dedupes spills by table and verbalization and
  clauses by table and SQL, so two constraints that verbalize alike in
  one table are two clauses but one spill. A report must not merge them,
  so `unreportedConstraintSpecs` dedupes by constraint instead (see
  Implementation notes).
- **The spill reason does not reach the report.** `ConstraintSpec`
  carries only `verbalization`, `pseudocode` and `example`
  (`core/src/export/types.ts`); the reason ("CHECK is not supported by
  postgres") is written only into DDL's SQL comments. So the three
  formats need no format-shaped reason.
- **Dependencies.** `buildConstraintSpec` (`formats/src/constraintSpec.ts`)
  needs only core, its counterexample and verbalization subpaths, and
  the file's own `findRole`, a lookup of a role's fact type that tries a
  given fact type first. The router adds `valuePredicate.ts` (which
  `DdlImportFormat` also reads, for `parseValuePredicate`) and
  `dialectCapabilities.ts`. `@barwise/dbt` depends on `core` only
  (`scripts/lib/intended.cjs`, `"dbt": ["core"]`).
- **Notes the three formats already write.** `collectExportAnnotations`
  notes a composite primary key and a value type's own value constraint,
  for all three; dbt writes them as YAML comments through
  `annotateDbtExport`. Neither is a `ConstraintSpec`, and neither
  survives an export with annotations off.

## Scope

- When the OpenAPI, Avro or dbt exporter writes a model, it shall return
  the specs of every constraint the router spills under a profile with
  UNIQUE and CHECK absent, from one core function, and no
  `constraintSpecs` field when there are none.
- When the DDL exporter writes a model in any dialect, its text and its
  `constraintSpecs` shall not change.
- When the Ossie exporter writes a model, its output shall not change.

What this does not report. Each is a gap the router already has for
DDL, made no worse here, and each is filed:

- **A constraint over subtypes** (barwise-lwy). The router skips it; DDL
  carries it in the barwise annotation; the spec builder has no roles to
  label for it. The three formats carry it nowhere. Since fixed: the
  router spills it at the supertype's table, and the spec builder names
  the supertype and subtypes (`schema-export-subtype-constraints.spec.md`).
- **A mandatory role the mapping did not enforce** (barwise-plq). The
  router counts every mandatory as realized, but the mapper writes NOT
  NULL only for a role whose column sits on its own player's table. A
  mandatory on the other role of a one-to-many binary ("each Customer
  places some Order"), on either role of a many-to-many or associatively
  mapped one-to-one, or on the value role of an entity-value binary is
  enforced nowhere and reported nowhere. Since fixed: the router spills
  each one with the reason for its shape (`mandatory-role-routing.spec.md`).
- **The second uniqueness of a one-to-one entity binary** (barwise-hjy).
  The mapper absorbs it as a foreign key column; "each Customer places at
  most one Order" needs UNIQUE on that column, and the router routes
  UNIQUE only for an entity-value binary's value column, so it is lost
  without a word. Since fixed: the router routes it as UNIQUE, and the
  DDL import reads it back (`one-to-one-entity-uniqueness.spec.md`).
- **A key's uniqueness where the format has no keys** (barwise-lqj).
  Avro writes a primary key as a `doc` line, OpenAPI as a path
  parameter, and dbt tests only a single-column key with `unique`; a
  composite key gets no test (161 tables over the corpus). The router
  counts the uniqueness realized by the primary key. Open decision 2.
  Since decided: dbt tests a composite key with
  `dbt_utils.unique_combination_of_columns`, Avro and OpenAPI report no
  key, and OpenAPI's item path for a composite key is barwise-pki
  (`dbt-composite-key-tests.spec.md`).

## Workstreams

### 1. The pieces move to core

- `constraintRouting.ts` and `dialectCapabilities.ts` move to
  `core/src/mapping`, exported from `@barwise/core/mapping`, with
  `unreportedConstraintSpecs(model, schema): ConstraintSpec[]`, which
  routes under a module-level profile with UNIQUE and CHECK absent and
  returns one spec per spilled constraint. The profile is the postgres one with
  `unique` and `check` set to `absent` (primary and foreign keys stay
  native, which is what the schema carries); it is not exported, so
  nothing else restates it. Its own test pins the six-kind report by content,
  the per-constraint dedupe and the empty result.
- `buildConstraintSpec` moves to `core/src/annotation/constraintSpec.ts`,
  exported from `@barwise/core/annotation`. `findRole`, which the builder
  and the router both use, moves to `core/src/model/roleLookup.ts`,
  internal to core, and resolves through `OrmModel.factTypesHolding`
  with the preferred fact type first, so it adds no scan of its own.
- `valuePredicate.ts` moves to `core/src/sql`, exported from
  `@barwise/core/sql`.
- The four formats files are deleted; `DdlExportFormat`,
  `DdlImportFormat` and `writeOssie` import from core.
- Tests follow the code: `ConstraintRouting` and `valuePredicate` move to
  `core/tests` mirroring the new paths, and count toward core's coverage
  floors. `DdlDialectExport` exercises the DDL descriptor and
  `constraintsAcrossFactTypes` the NORMA importer, both in formats, so
  both stay there with their imports updated.
- The gates that name paths move with them, in the same commit:
  `audit-baseline.json`'s row for the `Record<SqlDialect, ...>` union in
  `dialectCapabilities.ts` is re-keyed to the new path (the detector
  hashes the path into the id); this spec's Touches and the Touches of
  `external-preferred-identifier`, `ossie-ontology-format` and
  `join-ring-constraint` replace the deleted paths with the new ones
  (`check:spec-touches` has no marker for a deleted file); both package
  CLAUDE.md layouts are updated.

Acceptance: DDL export of every tracked `.orm.yaml` in every dialect is
byte-identical before and after, with the same `constraintSpecs`; the
Ossie export of every tracked model is byte-identical; the moved tests
pass unchanged apart from their import paths; `check:spec-touches` and
`audit:duplication --check` pass.

### 2. dbt, OpenAPI and Avro report

Each adapter sets `constraintSpecs` from `unreportedConstraintSpecs`
when it is non-empty. `docs/CLI.md` and `docs/IMPORT_EXPORT.md` stop
listing DDL and Ossie as the only formats that report. Acceptance: a
test model holding a secondary uniqueness, a role value constraint, a
value type's own value constraint, a value comparison, a ring and a
subset, with distinct players and values so no two verbalizations
coincide, reports all six by content and no mandatory, pinned once in
core (`unreportedConstraintSpecs.test.ts`), since all three formats call
the one function; each adapter's test pins that it passes its rendered
schema through (a constraint reported, a carried one not, no field when
nothing drops); a CLI export of each format shows its report on stderr
through the existing `formatConstraintReport` path; the counts over the
tracked models are recorded here.

## Implementation notes

- WS1: the plan moved `constraintsAcrossFactTypes.test.ts` to core with
  the router. It also round-trips NORMA files through formats' importer
  and writer, which core cannot import, so it stays in formats and reads
  the router from `@barwise/core/mapping`.
- WS1, implementation review: the router dedupes spills by table and
  verbalization, which merged distinct constraints in a report (two role
  value constraints with the same values) and kept one column's check
  for a value type's own constraint on two columns. `routeConstraints`
  keeps that dedupe, so DDL is unchanged; `unreportedConstraintSpecs`
  reads the undeduped spills and keeps one per constraint, so a value
  type's own constraint is reported once per column it fills, each spec
  naming its role. `DIALECT_PROFILES` is no longer exported (its one
  outside reader was a test, now in core), and the moved `constraintSpec.ts`
  is routed high-risk again in `review-tiers.json`.
- WS1, measured: DDL export of every tracked `.orm.yaml` that loads, in
  every dialect, with and without annotations, and Ossie export of each,
  is byte-identical before and after the move, `constraintSpecs`
  included (1,428 outputs, compared as one JSON file).
- WS2: the three adapters set `constraintSpecs` through one core helper,
  `withConstraintSpecs`, which leaves the field out when the list is
  empty; DDL and Ossie now use it too, so the rule has one home. Measured over the 84
  tracked models that load: each of OpenAPI, Avro and dbt reports 366
  specs, in 54 models. That is 3 more than the router-level 363 above,
  which are the distinct constraints the router's per-table dedupe had
  merged. Each adapter's test pins the wiring (a ring reported, a
  NOT NULL mandatory not, no field when nothing drops); content is
  pinned once, in core. Implementation review found the shared report
  (`formatConstraintReport`) groups by verbalization and kept the first
  spec of each group, which in the MCP detail block dropped the
  pseudocode of a value type's second column. The heading still counts
  rules and the CLI line still reads `(xN)`, but the detail block now
  lists every distinct pseudocode in a group.

## Open decisions

1. **How `@barwise/dbt` reaches the router.** (a) Move it to core
   (recommended): pure, beside the mapper and DDL renderer it reads, and
   reachable from every package without a new edge. (b) Give
   `@barwise/dbt` a dependency on `@barwise/formats`: no move, but the
   first connector-to-connector edge, and dbt carries formats' whole
   surface for one function. (c) A copy in dbt: two routers that must
   agree; a byte-identical copy could be registered in
   `parity.manifest.json`, but every router change would then be made
   twice. Recommend (a).
2. **A key's uniqueness where the format has no keys.** Avro and OpenAPI
   enforce no key, and dbt tests a composite key with nothing. (a) Leave
   it out of this change, filed as barwise-lqj (recommended): reporting
   it needs the router to say which uniqueness a key realized, which it
   does not record today, and it adds one entry per entity to every Avro
   and OpenAPI report. (b) Report it now: needs that new router output in
   workstream 1. Recommend (a).

## Risks and testing

Workstream 1 is a move of a working router; the byte-identical DDL and
Ossie corpus diffs are its gate. Workstream 2 is the user-visible change,
pinned per format by the six-kind test. The four gaps above are named,
and filed, so a reader does not take the new reports for a complete
account of what a schema export loses.
