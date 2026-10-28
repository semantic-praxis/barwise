# The OpenAPI item path names every key column

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-pki
Plan-reviewed: 783aafc7 (code-review, pr-review)
Touches: barwise/packages/core/src/mapping/renderers/openapi.ts,
barwise/packages/core/tests/mapping/openapi.test.ts,
barwise/packages/cli/tests/characterization/golden/,
barwise/docs/IMPORT_EXPORT.md

When a table's primary key spans several columns, the OpenAPI export
shall write its item path with one path parameter per key column, in key
order: `/student-enrolls-in-course/{student_id}/{course_id}`. Today the
path names only the first column, `/student-enrolls-in-course/{student_id}`,
which addresses many rows, not one. 161 tables across the 84 tracked
models that load have a key over several columns
(`dbt-composite-key-tests.spec.md`), and each one gets a wrong item path.

## Principle

Explicit over implicit. An item path is how an API client addresses one
row, so it has to carry the whole key. A path that carries part of it
claims an identity the model does not state.

## Observed today (at cf334d86)

- `primaryKeyParam` (`core/src/mapping/renderers/openapi.ts:410`) returns
  `table.primaryKey.columnNames[0] ?? "id"`. `renderOpenApi` calls it
  twice: once for the path string (line 117) and once for
  `renderItemPaths` (line 120), which gives `get`, `put` and `delete` one
  shared path parameter.
- The OpenAPI importer (`formats/src/openapi/`) reads only
  `components.schemas`, never `paths`. No tool, MCP, editor or lineage
  code reads item paths either.
- The CLI golden test compares bytes, so it pins today's first-column
  paths. Two goldens have a composite-key table:
  - `clinic-appointments.openapi.txt`:
    `doctor_is_assigned_to_exam_room_on_appointment_date`, keyed on
    `(provider_id, appointment_date)`. Its other n-ary table is keyed on
    one column, `confirmation_number`, so it keeps its path;
  - `constraints-showcase.openapi.txt`: `person_is_parent_of_person`.

  In `external-uniqueness.openapi.txt` the composite key is a UNIQUE
  constraint, not the primary key, so that golden is unaffected.
- The committed `examples/transcripts/*.openapi.json` are already out of
  date with the exporter, by 187 lines for `clinic-appointments`. Nothing
  regenerates them. That is barwise-om4, and they are left alone here.
- `IMPORT_EXPORT.md` names this gap as barwise-pki.

## Scope

- `primaryKeyParams(table)` shall return the key's column names in key
  order, or `["id"]` when the key is empty, as today's fallback does. The
  path and every item operation's parameters shall both be built from
  that one list, so they cannot disagree.
- When a table's primary key has several columns, the item path shall
  end in one `{column}` segment per key column, in key order. `get`,
  `put` and `delete` shall each declare one required string path
  parameter per key column, in the same order.
- When the key has one column, the path and its parameter are unchanged.
- `IMPORT_EXPORT.md`: the barwise-pki sentence becomes "OpenAPI writes
  it as the item path's parameters." That is the reason the OpenAPI
  export reports no key spec.

Out of scope:

- Reading the key back on import. The importer reads no paths for any
  key, single or composite.
- Parameter names that are not valid template variables, such as a
  column named `(ambiguous)` (barwise-9g3).
- Parameter types. They stay `string`, as today.
- The stale example outputs (barwise-om4).

## Workstreams

### 1. One segment per key column

The changes above. Each item below is pinned by a test:

- A table keyed on three columns gets an item path with all three, in
  key order, and `get`, `put` and `delete` each list all three as
  required path parameters, in the same order.
- A single-column key's path and parameter are unchanged.
- With the fix removed, the first test fails.

Not pinned by a new test: the two CLI goldens are regenerated with
`UPDATE_GOLDEN=1`, after which the golden test pins the new paths. The
regeneration is expected to change only each composite-key table's item
path and its three parameter lists, and the PR shows that diff for
review.

## Implementation notes

- As planned in the revised plan. The first draft said the clinic golden
  had two composite-key tables and planned to regenerate the example
  outputs. The high plan review showed it has one, and that the examples
  are already 187 lines out of date (barwise-om4). The examples are left
  alone.
- `primaryKeyParams` replaces `primaryKeyParam` and feeds both the path
  and `renderItemPaths`.
- The new test fails with the fix removed. Regenerating the goldens
  changed 2 files, 50 lines added and 2 removed: each composite-key
  table's item path, plus one added parameter on each of its three
  operations.

## API and migration impact

For a composite-key resource, the item path gains one segment per key
column after the first, and each item operation gains the matching
parameters. A client generated from an earlier export calls the old,
shorter path, which addressed many rows. Single-column resources are
unchanged.

## Open decisions

1. **Segments, or one parameter holding the key?**
   - (a) One path segment per key column (recommended). This is the
     common REST shape for a nested key, and each parameter is a plain
     value.
   - (b) One parameter holding the columns joined by a separator. That
     needs an encoding the model does not define.
   - (c) No item path for a composite-key table. That is correct, but it
     drops the API's way to address a row.

   Recommend (a).

## Risks and testing

A client generated from an earlier export breaks on composite-key
resources, as the API section says. The path it called addressed many
rows, so it was already wrong, but it changes without a version signal.
The release notes for the version that ships this should name it.
