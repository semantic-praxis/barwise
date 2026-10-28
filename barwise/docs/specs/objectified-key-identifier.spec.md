# An objectified relationship's key column gets no second identifier

Status: Draft

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-i3r
Touches: barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/tests/,
barwise/packages/cli/tests/dbtUniquenessRoundTrip.test.ts,
barwise/docs/release-notes/unreleased.md

When the DDL importer reads an annotated table whose entity objectifies a
relationship, and the table's one key column is a role of that
relationship played by an entity, the importer shall give the entity no
typed identifier over that column. Today it does, so the entity gains a
second key: the next export writes an extra column for it and a UNIQUE on
that column. The entity's preferred identifier shall instead be the one
the annotation names through its reference mode.

## Principle

Explicit over implicit, and one decision in one place. The barwise
annotation says the table objectifies a relationship, and step 1b builds
that relationship from the key column. Step 2 then decides the key's
identity again, from the column alone, and disagrees. The rule moves into
one helper that every step-2 path asks.

## Observed today (at fce12983)

Measured with the scratchpad `go4-count.mjs` over the 84 tracked models:
the annotated DDL round trip adds one UNIQUE in four models, C05, C06 and
the two barwise-nqd findings. The plain round trip and the dbt round trip
keep every UNIQUE.

- C05's `work_order` objectifies "Material is produced at Plant in Batch",
  whose uniqueness is on the Batch role alone. The mapper keys the table
  on `batch_number`, the Batch reference it absorbs, and writes
  `UNIQUE (work_order_number)` for the entity's preferred identifier,
  "WorkOrder has WorkOrderNumber".
- On import, step 1b builds the relationship from the annotation, taking
  `batch_number` (`consumed`). Step 2 then reaches the key on one of three
  paths, and none asks whether step 1b took it:
  - with a table line that lists supertypes (the exporter always writes
    `supertypes: []`), `createKeyIdentifier`;
  - otherwise the subtype naming rule, which can add an identifying
    subtype fact;
  - otherwise `createKeyIdentifier` again.
- The result is an extra fact type, "WorkOrder has BatchNumber", stored as
  the entity's preferred identifier. The next export writes it as a
  `has_batch_number` column with a UNIQUE.
- The table line names `referenceMode: work_order_number`, and the column
  line rebuilds "WorkOrder has WorkOrderNumber" with its value-side
  uniqueness. Nothing marks that uniqueness preferred.
- `RelationalMapper` keys an objectified fact type's table on its roles
  only when a role it absorbs is a reference (`absorbsAKey`). For a fact
  type over values only, the typed identifier is what keeps the key
  column, so skipping it there would lose the column.

## Scope

- One helper, `keyIdentifiedByObjectification(table, entity)`, shall say
  whether the entity objectifies a fact type whose role, built in step 1b
  from the table's one key column, is played by an entity type. It reads
  the model, not only `consumed`, so a same-named table in another schema
  that was imported as a plain entity is not caught.
- When it holds, every step-2 path shall skip that table: no typed
  identifier and no subtype naming rule.
- In step 3, when such an entity has no preferred identifier and a column
  named by the table line's `referenceMode` builds a binary with a
  value-side uniqueness, that uniqueness shall be the entity's preferred
  identifier.
- Checks:
  - `dbtUniquenessRoundTrip.test.ts` also takes the 24 models through the
    DDL export and import, with and without annotations, and requires the
    same UNIQUE descriptions and the same preferred identifier, by
    players, for every objectifier. With annotations it fails today on the
    four models above.
  - A formats unit test pins the case the round-trip test cannot reach: an
    objectifying table line without `supertypes`, which takes the other
    branch.
  - A formats unit test pins a fact type over values only keyed on one of
    them: it keeps its typed identifier.
- The release note says an annotated DDL round trip no longer adds a key
  column to such a table, and keeps its preferred identifier.

## Risks and testing

A model imported from annotated DDL before this change keeps its extra
identifier until it is imported again. Only tables whose annotation
objectifies a relationship over a single-column key played by an entity
change.
