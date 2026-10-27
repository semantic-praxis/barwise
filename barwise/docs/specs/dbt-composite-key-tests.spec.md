# The dbt export tests a key over several columns

Status: Draft -- no workstream implemented

Created: 2026-10-27
Last-updated: 2026-10-27
Tracking: barwise-lqj
Touches: barwise/packages/core/src/mapping/renderers/dbt.ts,
barwise/packages/core/tests/mapping/dbt.test.ts,
+barwise/packages/dbt/tests/compositeKeyExport.test.ts,
barwise/docs/specs/schema-export-constraint-specs.spec.md,
barwise/docs/IMPORT_EXPORT.md

When a table's primary key spans several columns, the dbt exporter shall
test it on the model with `dbt_utils.unique_combination_of_columns`, as
it tests a single-column key with `unique` on the column. Today a
composite key gets no test at all: 161 tables across the tracked corpus,
every one of them the associative table of a many-to-many or a key
over several roles. Re-importing that export reports each of the 161 as
"Cannot determine primary identifier". The dbt importer already reads
the combination test as a composite key (`composite-key-tables.spec.md`),
so the export now writes what the import reads.

## Principle

Explicit over implicit. A key is a rule the model states. A dbt project
enforces rules through tests, so a key with no test is a rule the export
silently drops. The fix uses the test the importer already
reads, so the round trip closes in one change rather than gaining a
second spelling of the same key.

## Observed today (at 9871b547)

- `buildColumnTests` (`core/src/mapping/renderers/dbt.ts`) writes
  `unique` only when the key is a single column. No model-level test is
  written for any table.
- `dbt/src/dbtMapping/compositeKeys.ts` reads a model-level
  `dbt_utils.unique_combination_of_columns` as a composite key: two or
  more columns, each `not_null`, at least one with a `relationships`
  test.
- `DbtSchemaParser` reads model-level tests from `data_tests` or `tests`.
  The renderer writes column tests under `tests`.
- The export writes model SQL files, `schema.yml` and seeds. It writes no
  `packages.yml`.
- Avro writes `doc: "Primary key"` on each key column, and OpenAPI uses a
  key column as the item path parameter. Each carries the key as
  information; neither format enforces uniqueness, and that is not its
  job.

## Scope

- When a table's key has two or more columns, the dbt renderer shall add
  `tests: [{ dbt_utils.unique_combination_of_columns:
  { combination_of_columns: <key columns in key order> } }]` to the
  model's `schema.yml` entry. A single-column key is unchanged.
- Avro and OpenAPI are unchanged, and report no key as a constraint
  spec: they carry the key as information, and a spec per table would
  report a rule the format already writes down (Open decision 2).

Out of scope:

- The OpenAPI item path, which names only the first column of a
  composite key (barwise-pki).
- `relationships` tests for a composite foreign key (barwise-ivl). For
  that reason 2 of the 161 keys, rings over a composite-keyed type, still
  do not re-import.
- Writing a `packages.yml`.

## Workstreams

### 1. The model-level key test

The renderer change above. Acceptance, each pinned by a test:

- A many-to-many table gets the model-level test over its key columns,
  in key order.
- A table with a single-column key gets no model-level test.
- Exporting the many-to-many model to dbt and importing the `schema.yml`
  gives back the fact type with one uniqueness spanning both roles, and
  no "Cannot determine primary identifier".
- Over the corpus, the 161 composite keys each get the test and nothing
  else in any `schema.yml` changes.
- `schema-export-constraint-specs.spec.md` and `IMPORT_EXPORT.md` record
  the gap as closed for dbt and decided for Avro and OpenAPI.

## Open decisions

1. **Which dbt test.**
   - (a) `dbt_utils.unique_combination_of_columns` (recommended): it is
     the test the importer reads, it is the common idiom, and the round
     trip closes.
   - (b) A singular SQL test under `tests/` grouping by the key columns:
     needs no package, but the importer does not read it, and it adds a
     file per table.
   - (c) `unique` over a concatenated expression: needs no package, but
     concatenation can collide (`a|b` and `a`, `b|`), and it is not
     read back.

   Recommend (a). The cost is that the user's project must declare
   `dbt_utils`. An export into a project without it fails at `dbt
   compile` with a message naming the missing macro.
2. **Avro and OpenAPI keys.**
   - (a) No change (recommended): both write the key, as a doc line or a
     path parameter. Neither format enforces anything, so reporting a key
     as unexpressed would add a spec per table (161 composite keys, and
     every single-column key) for a rule the output already states.
   - (b) Report each key as a spec: maximal, and noise in every Avro
     and OpenAPI report.

   Recommend (a).
3. **`tests` or `data_tests` for the model-level key.**
   - (a) `tests` (recommended), as the renderer already writes column
     tests: one spelling per file, and the importer reads both.
   - (b) `data_tests`, dbt 1.8's name: correct for new projects, but it
     mixes two spellings in one file until the column tests move too.

   Recommend (a).

## Risks and testing

Measured on a prototype over every tracked `.orm.yaml`: 52 of 84
`schema.yml` files change, gaining 161 model-level tests and no other
line. Re-importing the exports reports "Cannot determine primary
identifier" 2 times, down from 161. No existing test changes. A project
without `dbt_utils` that runs `dbt build` on the export now fails at
compile time where it used to pass with the key untested.
