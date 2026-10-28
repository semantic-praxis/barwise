# A multi-column foreign key round-trips as one reference

Status: Draft

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-ivl
Plan-reviewed: ad6f7a0a (code-review, pr-review)
Touches: barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/src/ddl/barwiseAnnotation.ts,
barwise/packages/core/src/mapping/renderers/dbt.ts,
barwise/packages/dbt/src/DbtSchemaTypes.ts,
barwise/packages/dbt/src/DbtSchemaParser.ts,
barwise/packages/dbt/src/dbtMapping/,
barwise/packages/core/tests/mapping/,
barwise/packages/formats/tests/,
barwise/packages/dbt/tests/,
barwise/packages/cli/tests/compositeKeyParity.test.ts,
+barwise/packages/cli/tests/compositeForeignKeyRoundTrip.test.ts,
barwise/docs/IMPORT_EXPORT.md,
barwise/docs/release-notes/unreleased.md

When a table references another table through a foreign key over several
columns, exporting the model to DDL or dbt and importing it back shall
give one reference to that table: not one per column, and not none.
Today neither format does this:

- The DDL importer reads a multi-column foreign key column by column
  wherever its composite-key rule does not take it, and builds one
  reference per column. `claim (policy_id, term_number)` comes back with
  two references to `policy_period`.
- The dbt export writes no test for a multi-column foreign key. dbt's
  built-in `relationships` test takes one column, so every such
  reference is lost.

The user chose to fix both importers together (option a, 2026-10-28).

## Principle

Explicit over implicit, and the importers agree. A foreign key is one
statement: these columns together reference that table's key. Reading
it column by column turns one fact into several. The dbt export can
state it, because dbt 1.9 added a model-level `foreign_key` constraint
over several columns. Both importers shall read a foreign key as the
unit, never its columns: one rule, "each foreign key is one reference",
replaces the per-column lookup in both, so no shape needs a case of its
own. A parity test holds the two importers together, as it does for
composite keys today.

## Observed today (at 7ffe4434)

Measured with the scratchpad `ivl-count.mjs` over the 84 tracked models
that load. For each model and referenced table, it counts the
multi-column foreign keys the mapper makes, before and after the round
trip. Names can change on re-import (a relationship table comes back as
`<a>_and_<b>_<fact>`), so the count per referenced table is the measure.

| Round trip                   | Kept | Tables that differ           |
| ---------------------------- | ---- | ---------------------------- |
| DDL with barwise annotations | 4    | 5 (all gain references)      |
| DDL without annotations      | 4    | 5 (all gain references)      |
| dbt                          | 0    | 9 (all lose every reference) |

There are 21 multi-column foreign keys in 8 models: C01, C03, C04, C07,
C09, C12, and the two barwise-rkm findings.

DDL importer (`DdlImportFormat.ts`):

- `compositeReading` reads a key made of two or more foreign keys and
  plain columns as a fact type. A multi-column foreign key there is one
  role (`Binary.roleColumns`). It declines (returns undefined) a key
  with a foreign key only partly inside it, two foreign keys sharing a
  column, or a key that is exactly one foreign key.
- Step 3 walks every column not taken by step 1b. That includes every
  column of a declined key (`compositeKey` is then true). For each it
  takes the first foreign key naming the column
  (`table.foreignKeys.find`) and calls `createForeignKeyFactType`, which
  builds its own binary. So a multi-column foreign key outside the key,
  or in a declined key, gives one reference per column, and a column in
  two foreign keys gives a reference only to the first-declared.
  The reviewer's probe of C03's `pp_detail` (a key that is one foreign
  key) gives two references.
- `compositeReading`'s extra role must be one column, so a key plus one
  remaining NOT NULL multi-column foreign key is objectified as a
  two-role fact type with a separate reference. C03's
  `coverage_applies_to_risk_under_policy_period` comes back that way.
- `farUnique` in `createForeignKeyFactType` holds only for a
  single-column foreign key; its comment says a composite one is read by
  step 3b.
- Step 3b reads each multi-column UNIQUE as an external uniqueness over
  the far roles of its columns' binaries, and refuses one that covers
  part of a multi-column role (`unexpressible`). It skips single-column
  UNIQUEs.
- The barwise annotation writes no line for a column of a multi-column
  role (`barwiseAnnotation.ts`), because the importer would build the
  fact type once per column.

dbt export and importer:

- `renderDbt` writes a `relationships` test only for a single-column
  foreign key (`findForeignKeyForColumn`), and only when
  `generateRelationshipTests` is not false. It writes a
  `unique_combination_of_columns` test for a multi-column primary key,
  and no test at all for a non-key UNIQUE, single- or multi-column.
- The importer finds references only through per-column `relationships`
  tests (`findRelationshipTest`, `ctx.relMap`, one `RelationshipInfo`
  per column). A column covered only by a multi-column foreign key reads
  as a value. A key whose only references are such a foreign key fails
  `candidateKeysOf` and reports "Cannot determine primary identifier".
  The referenced model is not in the `referenced` set
  (`analyzeComposites`), so it can be read unobjectified.
- `analyzeComposites` makes each key column its own role, and
  `createCompositeFactTypes` reads `info.roles` one column per role
  (`for (const [colName] of info.roles)`).
- `reportColumnRenames` maps each role to one exported column name, so a
  role spread over several columns would warn falsely.
- A model keyed only by a combination of values (no `relationships`
  column) gets no key and no entity (`candidateKeysOf`), where the DDL
  importer builds an entity (barwise-1077).
- dbt's constraints reference (docs repository): from dbt 1.9 a model
  can declare
  `constraints: [{ type: foreign_key, columns: [...], to: ref('m'), to_columns: [...] }]`.
  dbt applies constraints only when the model enforces a contract. On
  Snowflake a foreign key is recorded, not enforced.
- `cli/tests/compositeKeyParity.test.ts` compares the two importers'
  readings of composite-key tables. It has no multi-column foreign key
  case.

## Scope

### Workstream 1: the DDL importer reads each foreign key once

- Step 3 shall build references per foreign key, not per column. For
  each foreign key of the table whose columns step 1b did not take, and
  whose referenced table is an entity, the importer shall build one
  binary between the table's entity and the referenced entity. When the
  foreign key has several columns, the binary carries
  `roleColumns` (all of them). A column covered by any such foreign key
  is never read as a value.
  - This covers a foreign key outside the key and one in a key
    `compositeReading` declined, with no separate case.
  - Two foreign keys sharing a column give two references, one each.
  - Two foreign keys stay outside the loop, as today's per-column
    `continue`s keep them: one over the table's single-column key, which
    stays the typed key with barwise-1078's warning (a reference too would
    export a second key column), and one that is a declared subtype link,
    which is the subtype fact.
  - A foreign key whose referenced table is not an entity keeps today's
    reading of its columns (a value each, with the inferred-reference
    warning where it applies), so nothing is dropped.
- The referencing role is unique, as today. It is mandatory when every
  column of the foreign key is NOT NULL. The referenced role is unique
  when the foreign key's columns are, as a set, a UNIQUE of the table or
  its whole primary key.
- The reading verb comes from the foreign key's first column, as for a
  single-column one (Open decision 2). The annotation for the binary is
  looked up on the foreign key's columns in order, the first one found
  winning.
- `compositeReading`'s extra role may be a whole multi-column foreign
  key: when exactly one unit remains outside the key (a column, or all
  the columns of one foreign key), every column NOT NULL and not unique
  alone, it is the extra role. A foreign key only partly outside the key
  is still declined. This applies to tables without an annotation; an
  annotated table takes its reading from the annotation, as today
  (`compositeReading` is skipped for it).
- Step 3b, which maps each column to the binary that reads it:
  - A combination (UNIQUE or the declined key) whose columns are exactly
    one foreign key's columns is the referenced role's uniqueness above,
    not an external uniqueness. It adds no constraint of its own, and the
    composite-key warning for such a key says so rather than "imported as
    an external uniqueness".
  - A combination covering part of a multi-column role is refused with
    today's warning. This now also applies to a single-column UNIQUE on
    one column of a multi-column foreign key, which today is dropped
    without a word.
  - A combination naming a column in two foreign keys is refused, with
    the reason "names a column of two foreign keys".
  - The `farUnique` comment and the step 3b comment say the new rule.
- `barwiseAnnotation.ts` shall write the line for a multi-column role on
  its first column, now that the importer builds it once. Its comment
  says why the other columns carry none.

### Workstream 2: the dbt export writes the foreign key

- For each foreign key over several columns, `renderDbt` shall write a
  model-level constraint:
  `{ type: foreign_key, columns, to: ref('<table>'), to_columns }`.
  The single-column `relationships` tests are unchanged.
- `generateRelationshipTests: false` suppresses these constraints too.
  The option means "write no references", and a constraint is one.
- It writes no contract. The constraint states the reference for
  readers and for barwise's own re-import. dbt applies it only under an
  enforced contract (Open decision 1).

### Workstream 3: the dbt importer reads it

- `DbtSchemaParser` shall read a model's `constraints:` entries of type
  `foreign_key` with two or more columns into `DbtModel.foreignKeys`:
  `{ columns, to, toColumns }`, with `to` taken from `ref('...')` as for
  `relationships`. Another constraint type, or one column, is ignored,
  as today.
- `RelationshipInfo` shall become one reference over one or more
  columns: `{ columns, targetModelName, targetFields }`. `analyzeModels`
  adds one per `relationships` column and one per `foreignKeys` entry.
  Every reader asks "is this column in a reference" through it, so a
  multi-column foreign key is one reference wherever a `relationships`
  column is one today:
  - `candidateKeysOf` counts a column of a foreign key as a reference
    column;
  - `analyzeComposites` groups a key's columns into roles as
    `compositeReading` does, a foreign key's columns one role at its
    first key column, and declines the same shapes;
  - its extra-role rule takes a whole foreign key as one unit, as WS1;
  - `unreachable`, `targets` and the `referenced` set read references,
    not columns;
  - `createCompositeFactTypes` builds a multi-column role once, its
    player the referenced entity, and records the role for each of its
    columns;
  - `createFactTypes` builds one binary per reference outside the key,
    mandatory when every column is `not_null`;
  - `createValueTypes` skips every column of a reference.
- A model-level `unique_combination_of_columns` test whose columns are,
  as a set, exactly one foreign key's columns is that reference's
  referenced-role uniqueness, as WS1, and not a candidate key. Without
  this rule it would be a second candidate key and the model would lose
  its identifier.
- `reportColumnRenames` compares a role's columns as a set: it warns
  for a dbt column of a multi-column role only when the column is not
  among the role's exported columns.
- A reference whose target has no entity keeps today's reading of its
  columns as values, with today's gap for the reference.

Out of scope:

- The dbt export writes no non-key UNIQUE (barwise-ivl does not change
  that), so a one-to-one multi-column reference loses its referenced-role
  uniqueness on the dbt round trip, as a one-to-one single-column one
  does today. A follow-up issue is filed when this spec lands.
- A dbt model keyed by a combination of values gets no entity
  (barwise-alg's dbt side). A multi-column reference to one keeps the
  reading above. If a tracked model needs it to pass the round-trip
  test, this spec is revised before implementing, not the test.

### Checks

- `compositeKeyParity.test.ts` gains three cases, the same tables in DDL
  and dbt, read alike by both importers:
  - a multi-column foreign key inside a key, C03's
    `policy_period_supersedes_policy_period` shape;
  - one as the extra role, C03's
    `coverage_applies_to_risk_under_policy_period` shape;
  - one outside the key, C03's `claim` shape.
- `compositeForeignKeyRoundTrip.test.ts` (cli) runs the 8 tracked models
  above through annotated DDL, plain DDL and dbt. Per model, it compares
  the multiset of multi-column foreign keys, each described by
  referenced table, column count, whether all columns are NOT NULL, and
  (DDL only, see Out of scope) whether the reference is one-to-one. The
  schema's `Table` holds no UNIQUE, so the last is read from the model:
  the fact type behind the columns' `sourceRoleId` has a uniqueness on
  the referenced entity's role. It
  requires them equal. It fails today on all three.
- Unit tests pin each rule, and each fails on today's code:
  - DDL: the single-column key and the subtype link still build no
    reference; a foreign key in a declined key (one foreign key; two sharing
    a column); one outside the key, NOT NULL and nullable; two foreign
    keys sharing a column; the referenced-role uniqueness from a UNIQUE
    and from the key; a UNIQUE over part of a foreign key, one column
    and several; the annotated import writing and reading the line on
    the first column.
  - dbt export: the constraint's exact YAML, and none under
    `generateRelationshipTests: false`.
  - dbt importer: parsing `constraints:`; each mapping rule above; the
    combination test equal to a foreign key; no rename warning for a
    multi-column role.
- The guide (`IMPORT_EXPORT.md`, dbt section) says the export writes a
  `foreign_key` constraint for a multi-column reference, which needs dbt
  1.9 or later, and that dbt applies it only under an enforced contract.

## Open decisions

1. **Enforce a contract on the dbt models?**
   - (a) No (recommended). The constraint is written for readers and for
     re-import. Enforcing a contract changes how every model builds:
     dbt checks each column's type, and the warehouse gets the
     constraints in its DDL.
   - (b) Yes. Snowflake would record the foreign keys, which some BI
     tools read, but every generated model's build changes with it.

   Recommend (a), with (b) as a separate decision if wanted.
2. **The reading of the one binary in DDL, without an annotation.**
   - (a) The verb inferred from the first column, as a single-column
     foreign key gets today (recommended). With an annotation (WS1), the
     line names the reading.
   - (b) A neutral reading such as `{0} has {1}`. That is predictable
     across columns, but a different rule from the single-column case.

   Recommend (a).

## Risks and testing

- Models imported from DDL with a multi-column foreign key outside the
  key change shape: one reference instead of several. That is the fix,
  and the release note says so. A model saved from an earlier import
  keeps its extra references until it is re-imported.
- Some UNIQUE constraints that imported before, over part of a
  multi-column foreign key, are now refused with a warning. They
  constrained a reference that did not exist, so the import was wrong.
- The dbt importer change spans about eight mapping functions. The
  parity test checks that the two importers agree. The round-trip test
  checks that they agree with the export.
