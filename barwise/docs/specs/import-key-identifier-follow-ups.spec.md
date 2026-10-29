# The dbt import prefers an objectified composite key, and the DDL import trusts its table line

Status: Draft

Created: 2026-10-29
Last-updated: 2026-10-29
Tracking: barwise-fuo, barwise-xgu, barwise-9zm
Plan-reviewed: 01e4836d (code-review, pr-review)
Touches: barwise/packages/dbt/src/dbtMapping/compositeKeys.ts,
barwise/packages/dbt/tests/,
barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/tests/,
barwise/packages/cli/tests/uniquenessParity.test.ts,
barwise/packages/cli/tests/compositeKeyParity.test.ts,
+barwise/packages/cli/tests/workspace/preferred.ts,
barwise/docs/release-notes/unreleased.md

This spec covers three follow-ups to annotation-preferred-identifier.spec.md:

- **The dbt import, objectified composite keys (barwise-fuo).** When the
  dbt import objectifies a composite-key model, it shall make the key's
  uniqueness the objectifier's preferred identifier, as the DDL import
  now does.
- **The DDL import, objectifiers (barwise-xgu).** When the DDL import
  reads an annotated table, it shall take the table for an objectified
  relationship only if the table line says so.
- **The DDL import, reference mode (barwise-9zm).** When the DDL import
  reads an annotated table, it shall take the reference mode from the
  table line, whatever the key's width.

## Principle

The rule comes first, and explicit over implicit comes second:

- **One rule in two importers.** The DDL and dbt importers keep their own
  code, and parity tests hold them to one reading of the same tables
  (`cli/tests/uniquenessParity.test.ts`, `compositeKeyParity.test.ts`).
  The DDL importer gained a rule that the dbt importer lacks, and #850
  loosened the uniqueness parity test so the two would still agree. This
  change brings the dbt importer up to the rule where it builds the same
  entity, and makes both parity tests compare preferred identifiers.
- **A table line is the export's statement.** The line names the
  entity's reference mode, and names `objectifies` when the entity
  objectifies a fact type whose roles are columns of the table. The DDL
  importer infers both from the key instead, in the cases below, where
  nothing in the DDL calls for the inference.

## Observed today (at 8657c514)

Measured with the scratchpad scripts `fuo.mjs` and `rm9.mjs` over the
tracked models.

- **barwise-fuo.** For 24 entities in 17 model files, a plain DDL round
  trip stores the composite key's uniqueness as the preferred
  identifier, while a dbt round trip stores none. Every one is an
  objectifier. Examples: C08's `ServiceAgreement`, C10's `Enrollment`,
  rkm's `OrderLine`.
  - The dbt import builds an entity with a multi-column key only as an
    objectifier. A model keyed on value columns alone is no key it reads
    (`candidateKeysOf` in `analyze.ts` needs a reference column), and a
    model keyed on one composite foreign key is a shared-key subtype. So
    the DDL rule's external half has no dbt counterpart; making dbt read
    such a key is a new capability, not this follow-up.
  - The objectified key's uniqueness already exists:
    `createCompositeFactTypes` builds it over the key's roles
    (`keyRoleIds`) and stores no preferred identifier.
  - The same measurement shows 38 subtype entities that dbt gives a typed
    identifier and DDL identifies through their supertype. That is the
    dbt import's subtype loss, which barwise-vsp already tracks, and it is
    out of scope.
- **barwise-xgu.** Step 1 sets `objectifies` when the key is made of two
  or more whole foreign keys (`foreignKeysOfKey`), even on an annotated
  table whose line names no `objectifies`. An entity externally
  identified by two references would therefore return as an objectifier
  of an invented fact type. No tracked model has one: all 48 tracked
  objectifiers' lines carry `objectifies`.
- **barwise-9zm.** An annotated table takes its line's `referenceMode`
  only when its key is one column or it objectifies. Otherwise it takes
  an inferred `<table>_id`. That restriction dates from before
  barwise-alg, when such an entity kept an invented key column. No
  tracked model's reference mode changes today: 0 of 635 entities, since
  `Room`'s happens to equal the inferred one.

## Scope

### The dbt import prefers an objectified composite key (barwise-fuo)

- When `createCompositeFactTypes` objectifies a composite-key model's
  fact type, it shall give the key's uniqueness an id and store it as
  the objectifier's preferred identifier, as `identifierTypes.ts` does
  for a one-column key.
- This happens in the existing phase, before `reportColumnRenames`, which
  maps the model and keys each table on its stored preferred identifier,
  so the rename report reads the identifier the returned model holds.
- `compositeKeyParity.test.ts` and `uniquenessParity.test.ts` shall
  compare each entity's preferred identifier, described by the players of
  its roles, across the DDL and dbt imports. `uniquenessParity` drops the
  comment that excused the difference.

### The DDL import trusts its table line (barwise-xgu, barwise-9zm)

- An annotated table, one whose line names this table's entity and has a
  `supertypes` field, shall be read as objectifying exactly when its
  line names `objectifies`.
  - A line without `supertypes` was written before that field existed,
    by a writer whose rules for `objectifies` this reader cannot check.
    It keeps today's reading, so an older export keyed on foreign keys
    still imports as an objectifier.
- An annotated table shall take its line's `referenceMode`.
- An unannotated table is read as today.

### Checks

- The parity tests fail today on their objectified cases and pass after
  the change.
- A dbt unit test: an objectified composite model's entity has the key's
  uniqueness as its preferred identifier, and `resolvePreferredIdentifier`
  accepts it.
- Formats unit tests, the first and third failing today:
  - an annotated table keyed on two whole foreign keys, with
    `supertypes: []` and no `objectifies`, which imports as an entity
    with an external preferred identifier and no objectification;
  - the same line without `supertypes`, which still objectifies;
  - an annotated composite key table whose line names a reference mode
    other than `<table>_id`, which keeps it.
- The release note names the dbt change.

## Risks and testing

- A dbt import of an objectified composite-key model now stores a
  preferred identifier where it stored none, as the DDL import has done
  since #850. The exported files are unchanged: the mapper already keyed
  the table on the same roles.
- An objectifier whose fact type has a role with no column in its table
  gets a line with no `objectifies` (`relationshipOf`). Keyed on two
  whole foreign keys, such a table imports today as the objectifier of a
  fact type built from the key, not the model's, and after the change as
  a plain entity. Neither keeps the model's objectification, and no
  tracked model has one.
