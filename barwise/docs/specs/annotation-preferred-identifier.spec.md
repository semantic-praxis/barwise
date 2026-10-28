# A DDL round trip keeps each entity's preferred identifier

Status: Implemented

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-4l0
Plan-reviewed: fce47336 (code-review, pr-review)
Touches: barwise/packages/formats/src/ddl/barwiseAnnotation.ts,
barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/src/ddl/DdlExportFormat.ts,
barwise/packages/formats/tests/,
barwise/packages/cli/tests/uniquenessParity.test.ts,
barwise/docs/release-notes/unreleased.md

When barwise exports a model to annotated DDL and imports it back, every
entity shall keep the preferred identifier it stored. Today 42 entities
in the tracked models lose theirs. Two rules fix it. The import makes
the uniqueness the table's primary key reads as the entity's preferred
identifier, whatever the key's width; today it does so only for a key of
one column. Where the identifier is not the key, the table line names
its columns in a new `identifiedBy` field.

## Principle

Explicit over implicit, and one rule for every key shape. The import
already reads a one-column primary key as the entity's preferred
identifier (`createKeyIdentifier`). Since barwise-alg, the mapper keys a
table on its entity's preferred identifier of any kind: a value binary,
an objectified relationship's uniqueness, an external uniqueness. The
one exception is an objectifier whose relationship gives the key
(`objectificationGivesKey`), which is keyed on the relationship's roles
whatever its identifier. So a primary key over several columns states
the identifier as plainly as one column does, outside that exception,
and the import shall read it the same way, for annotated and plain DDL
alike.

Only an identifier the key does not state needs the annotation. An
objectifier keyed on its relationship's roles but identified by a value
of its own is one example. A subtype whose key is its supertype link is
another. Guessing that identifier from the table line's `referenceMode`
was tried for barwise-i3r and dropped. The export names the column after
the value type, so the reference mode is often not a column name
(objectified-key-identifier.spec.md).

## Observed today (at 7e84074c)

Measured with the scratchpad `pi.mjs` over the 119 tracked models: for
every entity, the kind of its stored preferred identifier before and
after an annotated DDL round trip.

| Stored before                                    | After | Entities | The key states it |
| ------------------------------------------------ | ----- | -------- | ----------------- |
| the objectified fact type's uniqueness (2 roles) | none  | 22       | yes               |
| an external uniqueness (`Room`, two fixtures)    | none  | 2        | yes               |
| a value binary's uniqueness, on an objectifier   | none  | 16       | no                |
| a value binary's uniqueness, on a subtype (nqd)  | none  | 2        | no                |
| a value binary's uniqueness                      | kept  | 336      | yes, one column   |
| none                                             | a key | 153      | (out of scope)    |
| none                                             | none  | 104      |                   |

- The import stores a preferred identifier only in `createKeyIdentifier`,
  for a table keyed on one column.
- The 22: the table is keyed on the relationship's two role columns.
  Step 1b builds the relationship and its uniqueness over those roles,
  and nothing marks it preferred.
- The 2: `room` is keyed on `(building_code, room_nr)`. Step 3b imports
  the key as an external uniqueness and warns that "an external
  uniqueness cannot yet be preferred (barwise-ezn)". That claim is stale:
  barwise-alg made it preferable.
- The 16: for example, C05's `work_order` is keyed on `batch_number`,
  from its relationship, and identified by `work_order_number`, which is
  written as a UNIQUE. The column builds "WorkOrder has WorkOrderNumber"
  and its uniqueness, and nothing marks that uniqueness preferred.
- The 2 subtypes: `purchase_order_item` is keyed on
  `purchase_order_item_id`, which is also its identifying link to
  `operation`. Step 2 sees the declared link identify the entity and
  skips `createKeyIdentifier`. Step 3 then skips the column as a key and
  link column, so no binary for it exists at all.
- The 153 that gain a stored identifier stored none before. The import
  makes their one-column key preferred. That is an addition, not a loss.

## Scope

### The key's uniqueness is preferred

- When a table's key has several columns and every one reads as a role
  (`consumed` from step 1b, or `binaries`), and a
  uniqueness covers exactly those roles, the import shall make that
  uniqueness the entity's preferred identifier. It does so only if
  `resolvePreferredIdentifier` accepts it for the entity, and only if
  none is stored yet. The roles are read through step 3b's `partOf`, so
  the columns of one composite foreign key read as its one reference.
- The external uniqueness step 3b imports from a composite primary key
  becomes preferred by this rule. Plain DDL reaches step 3b only when the
  composite reading declines the table: an unannotated `room`, keyed on
  a foreign key and a value, reads as an objectified "Building and RoomNr
  room", and the rule then prefers that fact type's uniqueness, which is
  consistent with the reading and re-exports the same table. Its warning shall say so, in place of
  the barwise-ezn text.

### The annotation names an identifier the key does not state

- `TableAnnotation` shall gain `identifiedBy?: string[]`: the columns
  that the roles of the entity's stored preferred identifier map to. A
  role maps to the columns the mapper wrote for it (`sourceRoleId`). The
  far role of a binary whose other role the entity plays maps to that
  other role's columns, since the mapper tags a value column and a
  foreign key column with the entity's own role.
- The export shall write the field only when all three hold:
  - every role maps to a column of the table;
  - the columns are not the table's primary key;
  - the dialect wrote them as a UNIQUE clause (`routing.clauses`).

  On a dialect with no UNIQUE (BigQuery, Databricks), the uniqueness is
  already reported as spilled, and naming columns the import cannot read
  as one would only produce a second, misleading warning.
- When the reader finds a malformed `identifiedBy`, it shall drop that
  field with a warning and keep the rest of the line. A malformed field
  is one that is not a non-empty list of distinct names. A bad optional
  field should not cost the entity's name, definition and supertypes.
- After step 3b, for a table with `identifiedBy`, the import shall read
  the columns as roles through step 3b's `partOf`. A column refused by
  step 3b's `unexpressible` gets that refusal: part of a composite
  foreign key, or shared by two foreign keys. The import then takes the
  first uniqueness over exactly those roles that
  `resolvePreferredIdentifier` accepts for the entity: internal ones
  first, then external, each in model order. It makes that uniqueness
  preferred, replacing what the key rule or step 2 set. When the columns
  read as no such uniqueness, the import shall warn that it found none
  and keep what it had.
- When `identifiedBy` names the table's one key column and step 2 built
  no identifier for it, because a declared supertype link identifies the
  entity, step 2 shall build the key identifier as well
  (`createKeyIdentifier`). The source model stored both, and the export
  wrote this table from both.
- An unannotated import, and a line without the field, are read with the
  key rule alone.

### Out of scope

- A table keyed on two or more whole foreign keys, with no `objectifies`
  on its line, is still read as an objectified relationship (step 1's
  `foreignKeysOfKey`). An entity externally identified by two references
  would therefore come back as an objectifier. No tracked model has one.
  Filed as a follow-up.
- An annotated table keyed on several columns, and not an objectifier,
  takes an inferred reference mode, not the line's. Filed as a
  follow-up.

### Checks

- A formats test runs every tracked model through an annotated DDL round
  trip. It requires every entity's stored preferred identifier to come
  back, described by its fact type's players and constrained roles. It
  fails today on the 42.
- Unit tests pin:
  - the key rule for an objectifier, and for an external key over value
    columns only (which the composite reading declines), over plain DDL;
  - the writer for an objectifier's value identifier, for the subtype
    case, and for the dialect with no UNIQUE (no field);
  - the reader dropping a malformed field;
  - a field naming part of a composite foreign key (refused);
  - the warning when the columns match no uniqueness;
  - a field naming a uniqueness that does not identify the entity (kept
    out).
- The tests that pin the barwise-ezn warning move to the new text.
- The release note says a DDL round trip keeps each entity's preferred
  identifier, and that a composite primary key now imports as one.

## Implementation notes

- Measured with the scratchpad `pi.mjs`: all 42 entities keep their
  preferred identifier through an annotated round trip, and no entity
  loses one. Ten objectifiers that stored none now gain their key's (7
  binary, 3 ternary), as the 153 one-column keys already did. Red check:
  on the unfixed source, the round-trip test fails on the 18 model files
  holding the 42, and every unit case fails.
- Changed scope: the writer also names a one-column key that is an
  identifying supertype link (the nqd subtype). The Scope's "not the
  table's primary key" contradicted its own step-2 bullet, which needs the
  line to name that key; the plan review missed it, the implementation
  review caught it. A wider link key is not named, since the import builds
  a key identifier for one column only.
- Changed scope: the key rule skips a key that is one composite foreign
  key. The export keys that table on an invented column beside the
  reference's one-to-one, so preferring the one-to-one would disagree with
  the key the next export writes (implementation review).
- The composite-key warning says what the import did: preferred, not
  identifying alone, or overridden by the line.
- `cli/tests/uniquenessParity.test.ts` now compares every uniqueness,
  preferred or not. It left preferred ones out as "the key", so the DDL
  importer preferring a composite key's uniqueness read as a uniqueness
  the dbt importer had and DDL lacked. The dbt importer does not apply
  the key rule yet: barwise-fuo.
- Follow-ups filed: barwise-xgu (a key of two whole foreign keys on a line
  without `objectifies` reads as an objectifier) and barwise-9zm (the
  line's reference mode is ignored for a composite key).

## Risks and testing

- A table line gains one field, written on few tables. An older barwise
  reads a line with an unknown field as today, since the readers check
  only the fields they know.
- A plain import of a table keyed on several columns now stores a
  preferred identifier where it stored none. The mapper keys on it, so
  the re-exported table is unchanged.
- A model imported before this change keeps its missing identifiers
  until it is imported again.
