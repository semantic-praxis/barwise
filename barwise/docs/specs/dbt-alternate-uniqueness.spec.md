# The dbt export keeps every uniqueness the DDL export writes

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-go4
Plan-reviewed: addd6d6d (code-review, pr-review)
Touches: barwise/packages/core/src/mapping/constraintRouting.ts,
barwise/packages/core/src/mapping/index.ts,
barwise/packages/core/src/mapping/renderers/dbt.ts,
barwise/packages/core/src/mapping/renderers/DbtExportAnnotator.ts,
barwise/packages/core/tests/mapping/,
barwise/packages/dbt/src/,
barwise/packages/dbt/tests/,
+barwise/packages/cli/tests/dbtUniquenessRoundTrip.test.ts,
+barwise/packages/cli/tests/uniquenessParity.test.ts,
barwise/docs/IMPORT_EXPORT.md,
barwise/docs/release-notes/unreleased.md

When barwise exports a model to dbt and imports it back, every uniqueness
the DDL export writes as a UNIQUE clause shall come back. Today none does.
The dbt export writes a test only for each table's key, so a secondary
unique column, a one-to-one reference and a second key of a relationship
table are all reported as dropped. The importer never sees them.

## Principle

One decision in one place, and explicit over implicit. The constraint
router already decides each UNIQUE the DDL export writes. The dbt export
shall write the same ones, read from the router, not decided again.
Writing them makes a second rule necessary: the dbt importer takes any
column with `unique` and `not_null` to be the key. So the export also
states which uniqueness is the key, with dbt's own model-level
`primary_key` constraint, and the importer reads that before it guesses.

## Observed today (at 9cfa96e6)

Measured with the scratchpad `go4-measure.mjs` and `go4-count.mjs` over
the 84 tracked models that load.

- The router writes 107 UNIQUE clauses in 24 models: 62 over one column
  and 45 over several. 38 sit on a table with a composite key.
  - 29 single-column ones are on a NOT NULL column that the importer's
    rule would take as the key: the table has a composite key, or the
    column comes before the key column.
  - 29 single-column ones are on a foreign key column (a one-to-one
    reference), and 7 multi-column ones are exactly a foreign key.
- Per model, the multiset of UNIQUE widths (each with its table's key
  width) after a round trip:

  | Round trip              | Models kept | Models that differ  |
  | ----------------------- | ----------- | ------------------- |
  | DDL without annotations | 24          | 0                   |
  | DDL with annotations    | 20          | 4 (each gains one)  |
  | dbt                     | 0           | 24 (each loses all) |

  The annotated DDL gain is a separate defect, filed as barwise-i3r. Column names can change on re-import (a relationship's column
  is renamed for its player), so names are not compared.
- `renderDbt` writes `unique` only on a single-column key and
  `dbt_utils.unique_combination_of_columns` only for a multi-column key.
  `DbtExportFormat` reports every other uniqueness through
  `unreportedConstraintSpecs`, which routes with UNIQUE and CHECK absent.
- `routeAll` (`constraintRouting.ts`) records a UNIQUE as a clause:
  `{ tableName, sql, channel }`, with the columns only inside the SQL.
- The dbt importer:
  - takes the first column with `unique` and `not_null` as the key
    (`analyzeModels`);
  - reads `unique` on a non-key value column as the value role's
    uniqueness (`buildConstraints`), and ignores it on a `relationships`
    column;
  - reads a second combination test as "manual review needed", except
    one over exactly a foreign key (barwise-ivl);
  - reports "none is marked preferred" when two combination tests could
    each be the key.
- The DDL importer reads a UNIQUE as: a value role's uniqueness; a
  reference's one-to-one; an external uniqueness over the columns'
  binaries (step 3b); or, in a relationship table, a uniqueness over the
  fact type's whole roles (step 1b, `uniqueOver`). A UNIQUE over part of
  a role is refused with a warning.
- dbt's constraints reference (docs repository): a model-level
  `constraints: [{ type: primary_key, columns }]` is supported from dbt
  1.5. dbt applies constraints only when the model enforces a contract,
  so without one it is metadata, with no warning.

## Scope

### Workstream 1: the router names a UNIQUE's columns

- A UNIQUE clause the router writes shall carry its columns,
  `RoutedClause.columns`, so no caller parses the SQL.
- A new core function, `routeUniqueOnly(model, schema)`, shall route as
  `unreportedConstraintSpecs` does, but with UNIQUE present and CHECK
  absent. It returns `{ uniques: { tableName, columns }[], constraintSpecs }`:
  the UNIQUEs the DDL export would write, once per table and column set
  (two constraints can write the same clause, and dbt refuses two tests
  of one name), and the specs of every other constraint, deduplicated as
  `unreportedConstraintSpecs` deduplicates them. The DDL clause list is
  unchanged.

### Workstream 2: the dbt export writes them, and the key

- `renderDbt` shall take an option `uniques` (default none) and write
  each one: a single column as a `unique` column test, several as a
  model-level `dbt_utils.unique_combination_of_columns` test after the
  key's.
  - dbt's `unique` test skips NULLs, as SQL UNIQUE does. The combination
    test does not: two rows with matching NULLs count as duplicates. So a
    combination over any nullable column carries
    `config: { where: "<each column> is not null" }`, which constrains
    exactly the rows a SQL UNIQUE constrains.
- `renderDbt` shall write `constraints: [{ type: primary_key, columns }]`
  on every model, with the table's key columns, before any `foreign_key`
  constraint (Open decision 1).
- `DbtExportFormat` shall pass `routeUniqueOnly`'s uniques to
  `renderDbt`, and report its `constraintSpecs` in place of
  `unreportedConstraintSpecs`. A written UNIQUE is no longer reported as
  dropped.
- `annotateDbtExport` shall take the same uniques, and note the
  dbt_utils dependency whenever a combination test is written, not only
  for a multi-column key. It is given them, not routing again.

### Workstream 3: the dbt importer reads them

- `DbtSchemaParser` shall read a model-level `primary_key` constraint into
  `DbtModel.primaryKey: string[] | undefined`.
- When a model declares a primary key, it is the key, decided in one
  place so every phase agrees:
  - one column: `analyzeModels` takes it as the key column, whatever
    other columns are `unique`;
  - several: `compositeKeyOf` returns it when `candidateKeysOf` would
    accept it as a key, whatever other combination tests qualify, so
    `analyzeModels`, `analyzeComposites` and the "manual review"
    check read the same key;
  - several that are exactly one foreign key: the reference-keyed entity,
    as today (barwise-ivl);
  - several that are values only: no key, as today (barwise-alg's dbt
    side, out of scope).

  A declared key naming a column the model does not have is reported and
  ignored. Without a declared key the importer guesses as today.
- Every other uniqueness shall be read as the DDL importer reads the same
  UNIQUE (steps 1b and 3b):
  - `unique` on a value column: the value role's uniqueness (as today);
  - `unique` on a single-column `relationships` column: the reference's
    one-to-one;
  - a combination test over exactly a foreign key's columns: its
    one-to-one (as today, barwise-ivl);
  - on a composite-key model, a `unique` or combination test whose
    columns all belong to its fact type's roles: a uniqueness over those
    roles when it falls on whole roles;
  - any other combination test: an external uniqueness over the far roles
    of its columns: a value column's value role, a reference's
    referenced-entity role, the identifier's value role, or a composite
    role itself, as DDL step 3b reads `farRoleId`. This covers a UNIQUE
    that spans a relationship's roles and its objectifier's attributes.
  - anything else (part of a role or reference, a column read as no fact
    type): the "manual review needed" warning, as today.
- The mapper records each column's far role (`farRoleIdMap`) where it
  builds the column's fact type, and a new phase after `createFactTypes`,
  `createUniqueness`, builds the uniquenesses above from it. Without the
  map the far role cannot be found: `columnRoleIdMap` holds the
  entity-side role.

### Checks

- `dbtUniquenessRoundTrip.test.ts` (cli) takes the 24 tracked models
  through `DbtExportFormat` and the dbt importer. Per model, it compares
  the routed UNIQUEs before and after, each described without names: per
  column, whether it is a key column, a foreign key column and the table
  it references, or a value column and its data type; and its table's
  key width. A uniqueness read back on the wrong column or the wrong side
  of a reference changes the description. It fails today on all 24.
- `uniquenessParity.test.ts` (cli) gives the DDL and dbt importers the
  same tables and requires the same uniquenesses, by players and roles,
  one case per rule above. The dbt reading is a second copy of DDL steps
  1b and 3b, and this is its check, as `compositeKeyParity.test.ts` is
  for composite keys.
- Unit tests pin each rule: the router's columns; the rendered YAML (key
  constraint, column test, combination test, order); the parser; each
  importer rule; a declared key beating a column the guess would take.
  Each fails on today's code.
- `IMPORT_EXPORT.md` (dbt) says the export writes every uniqueness, and
  states each model's key as a `primary_key` constraint (dbt 1.5 and
  later, metadata without a contract).

Out of scope: CHECK clauses, which dbt can state only through a test
package; the annotated DDL gain above.

## Implementation notes

- Measured with the scratchpad `go4-count.mjs`, now comparing each
  UNIQUE's description as the round-trip test does: through
  `DbtExportFormat` and the dbt importer, all 24 models keep every
  UNIQUE. All 84 tracked models re-import without throwing, and none has
  more validation errors than its plain DDL round trip. The composite
  foreign key count (barwise-ivl) is unchanged: 21 kept, 0 tables differ.
- Red check: the round-trip test names `routeUniqueOnly`, so on the
  unfixed source it fails on the missing function rather than the
  behaviour. The behaviour is the measurement above: every one of the 24
  models came back with no UNIQUE.
- The plan missed one case, which the measurement found: a combination
  test over exactly one foreign key that is a role of the composite fact
  type. It is read as that role's uniqueness. Without it, the four models
  with a relationship keyed on two multi-column foreign keys lost both
  one-to-ones.
- Implementation review, fixed:
  - A combination test resolving to one role (one column, or a repeat) is
    that role's uniqueness. Read as an external uniqueness over one role,
    it failed validation.
  - A combination test filtered to some rows, by any `where` but the
    export's own null filter, is named for review. It holds for those rows
    only, and is no uniqueness of the model.
  - A declared key over several columns that is neither a composite key
    nor one foreign key (values alone, barwise-alg) leaves the key to the
    tests, with a warning, rather than dropping the model. One
    `declaredKeyOf` decides which declared key counts.
  - A column of two references is refused, as DDL refuses it. A key
    column with a `relationships` test keeps its identifier's role.
  - The report says when the key was declared. An empty combination test
    is reported. The column-level `primary_key` form is read too.
- Implementation review, kept: `renderDbt` and `annotateDbtExport` each
  take the uniques, rather than the renderer reporting which models need
  dbt_utils. Their one caller passes the same list to both, three lines
  apart, and the note is advice, not a gate.

## Open decisions

1. **Write the `primary_key` constraint on every model, or only where
   another uniqueness makes the key ambiguous?**
   - (a) Every model (recommended). One rule, so every barwise-written
     model states its key and the importer never guesses for one. Every
     model's YAML gains three lines on the next export.
   - (b) Only where needed. Fewer changed lines, but a second rule in the
     renderer, and the key stays a guess on most models.

   Recommend (a).

## Risks and testing

- Every regenerated `schema.yml` changes: a `primary_key` constraint per
  model, and new `unique` and combination tests. dbt runs the new tests,
  so a warehouse whose data breaks a uniqueness the model states now
  fails `dbt test`. That is the point of stating it. The release note
  says both.
- A project whose only key was single-column, and that gains a
  multi-column UNIQUE, now needs the dbt_utils package, as a project with
  a composite key already does. The annotation and the release note say
  so.
- A hand-written dbt project without `primary_key` keeps today's key
  guess, but its `unique` on a `relationships` column and its extra
  combination tests now import as constraints rather than as a "manual
  review" warning. That is the same reading the DDL importer gives.
