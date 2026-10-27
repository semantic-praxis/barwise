# The dbt export tests a key over several columns

Status: Draft -- no workstream implemented

Created: 2026-10-27
Last-updated: 2026-10-27
Tracking: barwise-lqj
Touches: barwise/packages/core/src/mapping/renderers/dbt.ts,
barwise/packages/core/src/mapping/renderers/DbtExportAnnotator.ts,
barwise/packages/core/src/mapping/index.ts,
barwise/packages/core/src/annotation/ExportAnnotationCollector.ts,
barwise/packages/dbt/src/dbtMapping/compositeKeys.ts,
barwise/packages/core/tests/mapping/dbt.test.ts,
barwise/packages/core/tests/mapping/DbtExportAnnotator.test.ts,
+barwise/packages/dbt/tests/compositeKeyExport.test.ts,
barwise/packages/dbt/tests/compositeKeys.test.ts,
barwise/packages/cli/tests/characterization/golden/,
barwise/docs/specs/schema-export-constraint-specs.spec.md,
barwise/docs/IMPORT_EXPORT.md

When a table's primary key spans several columns, the dbt exporter shall
test it on the model with `dbt_utils.unique_combination_of_columns`, as
it tests a single-column key with `unique` on the column. Today a
composite key gets no test at all. Of the 84 tracked models that load,
161 tables are affected: every associative table of a many-to-many and
every key over several roles. The dbt importer already reads the
combination test as a composite key (`composite-key-tables.spec.md`).
So after this change, 150 of the 161 keys round-trip through dbt. The
other 11 depend on a reference test the exporter cannot yet write
(barwise-ivl).

## Principle

Explicit over implicit. A key is a rule the model states. A dbt project
enforces rules through tests, so a key with no test is a rule the export
drops without a word. The fix writes the test the importer already reads,
so the two packages agree on one spelling of a composite key, held as
one constant.

## Observed today (at 2f3376e2)

- `buildColumnTests` (`core/src/mapping/renderers/dbt.ts`) writes
  `unique` only when the key is a single column. No model-level test is
  written for any table. Column tests go under `tests`.
- `dbt/src/dbtMapping/compositeKeys.ts` reads a model-level
  `dbt_utils.unique_combination_of_columns` as a composite key. It needs
  two or more columns, each `not_null`, and at least one with a
  `relationships` test. Every other key column is read as a value role.
  It reads `combination_of_columns` only at the top level of the test's
  arguments, though dbt 1.10 moves arguments under `arguments:`.
- The renderer writes `relationships` only for a single-column foreign
  key (`findForeignKeyForColumn`), and only when
  `generateRelationshipTests` is on, which is the default.
- The export writes model SQL files, `schema.yml` and seeds, and no
  `packages.yml`.
- The shared export annotation collector notes every composite key as
  "Individual unique tests are not generated". That note appears in DDL,
  OpenAPI and Avro output as well as dbt.
- Avro writes `doc: "Primary key"` on each key column, so a composite key
  is carried as information. OpenAPI writes only the first key column
  into the item path (barwise-pki), so it does not carry a composite key.

## Scope

- When a table's key has two or more columns, the dbt renderer shall add
  `tests: [{ dbt_utils.unique_combination_of_columns:
  { combination_of_columns: <key columns in key order> } }]` to the
  model's `schema.yml` entry. A single-column key is unchanged.
- The test name shall be one constant, `DBT_KEY_TEST`, exported from
  `@barwise/core/mapping`. The dbt importer's `KEY_TEST` shall be that
  constant.
- The importer shall read `combination_of_columns` from the top level or
  from an `arguments:` block.
- The dbt export shall note each composite-key model: "Key tested with
  dbt_utils.unique_combination_of_columns: the project must declare the
  dbt_utils package."
- The shared composite-key note shall read "unique as a combination; no
  single column is unique". That holds for every format, and the old
  wording became misleading once dbt tests the key.
- Avro and OpenAPI report no key as a constraint spec (Open decision 2).

Out of scope:

- The OpenAPI item path for a composite key (barwise-pki).
- `relationships` tests for a composite foreign key (barwise-ivl).
- Writing a `packages.yml`, and an option to turn the key test off.

## Workstreams

### 1. The model-level key test

The changes above. Each of the following is pinned by a test:

- A many-to-many table gets the model-level test over its key columns,
  in key order. A table with a single-column key gets none.
- Exporting a many-to-many model to dbt and importing the `schema.yml`
  gives back one uniqueness spanning both roles, and no "Cannot determine
  primary identifier".
- The importer reads the key from an `arguments:` block.
- The dbt export carries the `dbt_utils` note for a composite-key model.

These are measured and recorded here rather than pinned by a test:

- The corpus effect.
- The doc edits in `schema-export-constraint-specs.spec.md` and
  `IMPORT_EXPORT.md`.

## Open decisions

1. **Which dbt test.**
   - (a) `dbt_utils.unique_combination_of_columns` (recommended): the
     test the importer reads, and the common idiom.
   - (b) A singular SQL test under `tests/` grouping by the key columns:
     needs no package, but the importer does not read it, and it adds a
     file per table.
   - (c) `unique` over a concatenated expression: needs no package, but
     concatenation can collide, and nothing reads it back.

   Recommend (a). Its cost is that the user's project must declare
   `dbt_utils`. A project without it fails at `dbt compile`, naming the
   missing macro, where before the key went untested. The note on each
   affected model says so.
2. **Avro and OpenAPI keys.**
   - (a) No constraint spec for a key (recommended): Avro writes the key
     on its columns, and OpenAPI's missing key columns are a defect in its
     paths, fixed there (barwise-pki).
   - (b) Report each key as a spec: a spec for every table in every Avro
     and OpenAPI report, for a rule Avro already writes down and OpenAPI
     should write down.

   Recommend (a).
3. **The 11 keys whose references are untested.**
   - (a) Write the key test for them too (recommended): the test is
     correct, and dbt enforces it.
   - (b) Skip it where a key column belongs to a composite foreign key:
     keeps their re-import failure loud, but leaves the key unenforced in
     dbt.

   Recommend (a). In 9 of the 11, some but not all reference columns have
   a `relationships` test. The importer then accepts the key and reads
   each untested column as a value type, losing that reference silently,
   where before it reported the model. That is barwise-ivl's to fix, by
   testing the composite reference.
4. **`tests` or `data_tests` for the key test.**
   - (a) `tests` (recommended), as the renderer already writes column
     tests: one spelling per file.
   - (b) `data_tests`, dbt 1.8's name: mixes two spellings in one file
     until the column tests move.

   Recommend (a). The importer reads both, and with this change reads
   dbt 1.10's `arguments:` too.

## Risks and testing

Measured on a prototype over the 84 of 119 tracked `.orm.yaml` files that
load. No export or import threw.

- 52 of the 84 `schema.yml` files change, and only in their 161
  composite-key models. Each gains the key test and the `dbt_utils`
  note, and its composite-key note is reworded. No other line changes.
- Of the 161 keys, 150 have every reference column tested and re-import
  as the fact type they key.
- 9 re-import with an untested reference column read as a value.
- 2 have no tested reference column and still report "Cannot determine
  primary identifier".
- Six CLI goldens change by the reworded composite-key note, one line
  each.

A project without `dbt_utils` that runs `dbt build` on the export now
fails at compile time. With `generateRelationshipTests` off, the key test
is written but the importer cannot read it back.
