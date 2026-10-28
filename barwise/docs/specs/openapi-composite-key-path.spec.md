# The OpenAPI item path names every key column

Status: Proposed

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-pki
Touches: barwise/packages/core/src/mapping/renderers/openapi.ts,
barwise/packages/core/tests/mapping/openapi.test.ts,
barwise/packages/cli/tests/characterization/golden/,
barwise/examples/transcripts/clinic-appointments.openapi.json,
barwise/examples/transcripts/pii-redaction.openapi.json,
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
  `table.primaryKey.columnNames[0] ?? "id"`.
- `renderOpenApi` builds `${resourcePath}/{${primaryKeyParam(table)}}`,
  and `renderItemPaths` gives `get`, `put` and `delete` one shared path
  parameter.
- The OpenAPI importer (`formats/src/openapi/`) reads no `paths`, so the
  change has no effect on import.
- `formatDefects.ts` does not list this defect, so no test pins today's
  behaviour.
- Committed outputs with a composite-key table: the CLI goldens
  `clinic-appointments.openapi.txt` (two tables) and
  `constraints-showcase.openapi.txt` (one), and the example outputs under
  `examples/transcripts/`.
- `IMPORT_EXPORT.md` names the gap as barwise-pki.

## Scope

- When a table's primary key has several columns, the item path shall
  end in one `{column}` segment per key column, in key order, and each
  item operation shall declare one required string path parameter per
  key column, in the same order.
- When the key has one column, or none, the path is unchanged: one
  `{column}` segment, or `{id}`.
- `IMPORT_EXPORT.md` drops its barwise-pki sentence.

Out of scope:

- Parameter types. They stay `string`, as today's single parameter is.
- The collection path, which is unchanged.

## Workstreams

### 1. One segment per key column

The changes above. Each item below is pinned by a test:

- A many-to-many table's item path has both key columns, in key order,
  and its `get` operation lists both as required path parameters.
- A single-column key's path and parameter are unchanged.
- With the fix removed, the first test fails.

Measured, not pinned: the CLI goldens and example outputs regenerate,
and only composite-key item paths and their parameters change.

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

Consumers of the generated OpenAPI see a changed path for composite-key
resources, one segment longer. That is the fix. Single-column resources
are unchanged.
