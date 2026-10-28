# A warehouse export option gives a multi-column-keyed table a generated key

Status: Draft

Created: 2026-10-28
Last-updated: 2026-10-28
Tracking: barwise-td6
Plan-reviewed: f62f224f (code-review, pr-review)
Touches: barwise/packages/core/src/mapping/,
barwise/packages/core/src/annotation/,
barwise/packages/core/src/export/types.ts,
barwise/packages/core/src/format/types.ts,
barwise/packages/core/tests/,
barwise/packages/formats/src/ddl/DdlExportFormat.ts,
barwise/packages/formats/src/registration.ts,
barwise/packages/formats/tests/,
barwise/packages/dbt/src/,
barwise/packages/dbt/tests/,
barwise/packages/cli/src/commands/export.ts,
barwise/packages/cli/tests/,
barwise/packages/mcp/src/tools/exportModel.ts,
barwise/packages/mcp/tests/,
barwise/docs/CLI.md,
CLAUDE.md,
barwise/docs/release-notes/unreleased.md

When a user exports DDL or dbt with `--surrogate-keys`, every table
whose key spans several columns shall get one generated key column, the
hash of its natural key. Every foreign key to such a table shall become
one column, hashed from the natural foreign key columns it keeps beside
it. The natural key shall stay enforced as a uniqueness. Without the
option, every export is unchanged.

## Principle

Composability and determinism in core. The relational mapper decides
the logical tables from the model. A generated key is a physical design
choice the model does not make, so it is one pure function over the
mapped schema, `withSurrogateKeys(schema)`, not a new rule in the mapper.

What that function changes, the schema states. A generated column
records the columns it hashes (`Column.generatedFrom`), and a table
records its natural key (`Table.naturalKey`). The readers that need
those facts read them from the schema rather than re-deriving them from
the model:

- routing writes the natural key's uniqueness;
- the dbt renderer writes the hash;
- the annotation collector describes the column.

Explicit over implicit, at two levels:

- A user asks for the option on each export; it is never inferred from
  the model.
- A format says whether it takes the option, on its `FormatDescriptor`,
  and both the CLI and MCP read that declaration rather than keeping
  their own lists (the `extension` precedent, barwise-867).

## Observed today (at 36df88a6)

- **Which tables have multi-column keys.** A table's key spans several
  columns when:
  - its entity is identified by an external uniqueness (since
    barwise-alg);
  - it objectifies a fact type keyed on its roles;
  - it is an associative table.
- **Five sites build foreign keys** to a table's whole key in
  `RelationalMapper`: references, external keys, associative roles,
  objectified keys, and `settleSubtypeKey`, where a shared-key subtype's
  primary key is itself the foreign key to its supertype.
- **Routing writes no UNIQUE for a binary's spanning uniqueness.** It
  handles a multi-role internal uniqueness only for `arity > 2`
  (`constraintRouting.ts`). A many-to-many table keyed on its two roles
  would therefore lose its only uniqueness if a generated key replaced
  the natural one. So the natural key cannot be left for routing to
  rediscover from the model.
- **dbt writes model SQL too.** `renderDbt` writes a model file per
  table, selecting every column from the source
  (`CAST(col AS type) AS col FROM {{ source(...) }}`). A generated
  column must therefore be computed in that SELECT, from columns the
  source has.
- **Populations skip columns without a role.** DDL `INSERT`s and dbt
  seeds render only columns with a `sourceRoleId`. A generated column has
  none, so its `INSERT` would leave a NOT NULL key empty.
- **The column-naming rule is private.** `pushColumn` (the free-name
  rule) is private to `RelationalMapper.ts`.

## Scope

### The schema states generated keys (core, mapping)

- `Column` shall gain `generatedFrom?: readonly string[]`: for a
  generated column, the columns of the same table it hashes, in order.
- `Table` shall gain `naturalKey?: readonly string[]`: the key the table
  had before a generated key replaced it.
- The free-name rule moves from `pushColumn` into a shared
  `freeColumnName(columns, name, alternative?)` that both
  `RelationalMapper` and `withSurrogateKeys` call. The mapper's output
  is unchanged.

### `withSurrogateKeys` (core, mapping)

- `withSurrogateKeys(schema)` shall return a new schema and leave its
  input unmodified.
- **Order.** Tables are settled in dependency order: a table after every
  table its key references through a foreign key. A key-reference cycle
  can only come from an invalid model. Its tables are settled in
  declaration order, and a foreign key to a table not yet settled is
  left as it is.
- **The reference rewrite.** Each foreign key to a table that got a
  generated key becomes a reference through one new column:
  - named after the replaced columns' common role prefix, then
    `<referenced table>_key`; so `origin_building_code, origin_room_nr`
    become `origin_room_key`, and with no prefix the name is
    `<referenced table>_key`;
  - given a free name if that one is taken;
  - with `generatedFrom` set to the replaced columns;
  - nullable as they were;
  - with no `sourceRoleId`.

  The replaced columns stay, so the hash can be computed from them.
  Where the table's own key names the replaced columns, the key names
  the new column in their place. A shared-key subtype keyed on its
  supertype link therefore ends keyed on the one new column, and is
  still a shared-key subtype.
- **The generated key.** A table whose key still spans several columns
  after its references are rewritten gets a generated key:
  - a column named `<table>_key`, or a free variant;
  - placed first in the table;
  - typed `VARCHAR(32)`;
  - not nullable, with `dataTypeDefaulted: false`;
  - with no `sourceRoleId`;
  - with `generatedFrom` set to the key's columns.

  That column becomes the primary key, and `naturalKey` records the old
  key.
- **Applying it.** When `RelationalMapperOptions.surrogateKeys` is set,
  `RelationalMapper.map` applies the function last.
  `ExportOptions.surrogateKeys` passes the option through, as
  `preferredIdentifierStrategy` does.

### Readers

- **Routing.** For each table with a `naturalKey`, routing shall write
  a uniqueness over those columns: `UNIQUE` in DDL,
  `unique_combination_of_columns` in dbt. If an existing clause over the
  same columns is already written, it is not written twice.
- **dbt model SQL.** For a column with `generatedFrom`, the dbt model
  SQL shall select
  `{{ dbt_utils.generate_surrogate_key([...]) }} AS <column>` over
  those columns instead of a cast from the source.
- **The annotation collector.** A column with `generatedFrom` shall be
  described as "Generated key: a hash of (...)", in place of the "no
  column description" and "data type was not declared" TODOs.
- **Populations.** Under the option, the DDL and dbt exports shall
  write no population `INSERT`s or seeds, and shall warn why: barwise
  computes no hash, and a row without its key would violate the table.

### Formats and surfaces

- `FormatDescriptor` shall gain `surrogateKeys?: true`, set on `ddl` and
  `dbt`.
- **Exporters.** Those two exporters pass the option to the mapper.
- **CLI.** `barwise export --surrogate-keys` refuses, with a message,
  any format whose descriptor does not declare the option.
- **MCP.** `export_model` gains a boolean `surrogateKeys`, refused the
  same way, from the same declaration. Its option bag otherwise accepts
  any key and ignores it.
- **Docs.** `docs/CLI.md` documents the flag. The capability matrix
  gains a row for it (open decision 2 covers VS Code).

### Out of scope

- **OpenAPI and Avro.** A hash computed in the warehouse is not an
  identifier an API client can derive, and the reason for the option is
  warehouse practice.
- **Imports.** An import of an export made with the option is not
  expected to reproduce the model; the option is a one-way physical
  choice.
- **The model-level route** the issue mentions: a review rule that
  suggests giving an entity its own identifier. Filed as a follow-up.

### Checks

- Core unit tests pin:
  - an externally identified table gaining a key, and a reference to it
    becoming one column that keeps its natural columns;
  - a role-prefixed reference, and a self-reference;
  - a many-to-many table, whose natural key is routed as a UNIQUE;
  - a shared-key subtype of a table that gained a key, which ends keyed
    on its one link column;
  - a chain of two tables;
  - the input schema left unchanged;
  - a cycle;
  - a name collision.
- A dbt test: a generated column's model SQL is the
  `generate_surrogate_key` call over its columns, and its natural key
  has the combination test.
- A formats test over the tracked models, with the option:
  - no foreign key spans several columns;
  - every table that was keyed on several columns has a one-column key;
  - every `naturalKey` is written as a UNIQUE.
- A corpus test without the option: the DDL and dbt exports are
  byte-identical to today's.
- A CLI test of the flag and its refusal, and an MCP test of the
  parameter and its refusal. The tool list is unchanged.
- The release note names the option.

## Open decisions

1. **The column's type.**
   - Recommended: `VARCHAR(32)`, the MD5 hex digest that
     `generate_surrogate_key` returns.
   - Alternative: a dialect's native hash type, narrower but different
     per dialect and from what dbt users compute.
2. **VS Code.**
   - Recommended: no option in this change, marked deliberate pending
     barwise-0wa. The editor's export command takes no per-export
     options, and its language-model export tool is pinned to its own
     schema.
   - Alternative: add the parameter to that tool now.
3. **A project setting.**
   - Recommended: not now. A generated key is a choice per target
     warehouse, so it is a per-export option.
   - Alternative: also read it from `.orm-project.yaml`, as
     `preferredIdentifierStrategy` is.
4. **Populations.**
   - Recommended: withhold them under the option, with a warning.
   - Alternative: compute the hash per dialect in each `INSERT`
     (`MD5(...)`). That puts dialect SQL in the population renderer for
     a combination nobody has asked for.

## Risks and testing

- Without the option nothing changes. The byte-identical corpus check
  pins that.
- With it, the natural foreign key columns stay beside each new
  reference column, so a table is wider than one designed by hand with
  generated keys only. Dropping them would leave dbt nothing to hash.
