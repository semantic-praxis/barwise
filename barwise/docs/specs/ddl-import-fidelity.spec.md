# DDL import keeps every column, its type, and its constraints on the right role

Status: Implemented -- all three steps of the single workstream, landed with this spec

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1058 (follow-ups filed during grounding: barwise-1076, barwise-1077)

`barwise import model schema.sql --format ddl` loses most of what a
`CREATE TABLE` says. It drops the primary key's type, which barwise-1058
records, and grounding found three more losses in the same file: it
silently drops any column whose type is more than one word or that has
a `DEFAULT`; it drops every type's length; and it attaches `NOT NULL`
and uniqueness to the value's role instead of the entity's, so a round
trip turns `NOT NULL` into nullable and adds `UNIQUE` to columns that
never had it. After this change a single-column-key schema survives
import and re-export: every column, its type with length and scale, its
nullability, its uniqueness, and a typed key.

## Principle

**Explicit over implicit.** A `CREATE TABLE` states each column's type,
nullability and uniqueness. The importer discards most of that and the
exporter then guesses, so every downstream step reports a gap the user
did not leave -- the same failure `dbt-key-type-fidelity.spec.md` fixed
for dbt. Where the parser cannot read a column, it must say so, not
drop it.

**Composability.** The dbt importer already solved two of these
problems: a key imported as a typed identifier value type in a preferred
identifying binary, and a rule for when two columns may share a value
type. The DDL importer should use the same solutions, not a third
variant.

## What the user sees (measured 2026-09-26, on main at b7b8c424)

Input:

```sql
CREATE TABLE customers (
  customer_id INTEGER PRIMARY KEY,
  name VARCHAR(50) NOT NULL,
  email VARCHAR(100),
  UNIQUE (email)
);
CREATE TABLE orders (
  order_id BIGINT NOT NULL,
  customer_id INTEGER NOT NULL,
  placed_at TIMESTAMP,
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
);
```

`barwise import model in.sql --format ddl --output m.orm.yaml`, then
`barwise export m.orm.yaml --format ddl`, gives (comments removed):

```sql
CREATE TABLE customers (
  customer_id TEXT NOT NULL,     -- was INTEGER
  name TEXT,                     -- was VARCHAR(50) NOT NULL
  email TEXT,                    -- was UNIQUE
  PRIMARY KEY (customer_id),
  UNIQUE (name)                  -- invented
);
CREATE TABLE orders (
  order_id TEXT NOT NULL,        -- was BIGINT
  customer_id TEXT NOT NULL,     -- was INTEGER
  placed_at TIMESTAMP,
  PRIMARY KEY (order_id),
  FOREIGN KEY (customer_id) REFERENCES customers (customer_id),
  UNIQUE (placed_at)             -- invented
);
```

`barwise verbalize` shows why the constraints moved: "Each Name has at
least one Customers", "Each Name has at most one Customers". The
importer builds `Entity has Value` with the value's role first, puts
the mandatory and the uniqueness on that role, and labels it with the
reading `{0} has {1}`, so the model states the reverse of the table.

A second input, parsed with `DdlImportFormat` directly:

```sql
CREATE TABLE t (
  id INTEGER PRIMARY KEY,
  a DOUBLE PRECISION,
  b TIMESTAMP WITH TIME ZONE,
  c CHARACTER VARYING(20),
  d VARCHAR(10) UNIQUE,
  e INTEGER DEFAULT 0
);
```

imports one value type, `D`, and no warning. Columns `a`, `b`, `c` and
`e` do not match the column regex, which returns `null`, and the loop
skips them. The inline `UNIQUE` on `d` is parsed and then ignored.

The existing tests did not catch any of this. `DdlImportFormat.test.ts`
asserts that some mandatory constraint exists (`toBeGreaterThan(0)`),
never which role it is on, and `roundtrip.test.ts` asserts that the
re-exported DDL contains `PRIMARY KEY` and `FOREIGN KEY`.

## Requirements

- **R1.** When a column definition cannot be parsed, the importer shall
  emit a warning naming the table and column text, rather than drop the
  column silently.
- **R2.** When a column's type is one or more words, with or without a
  parenthesized length or scale (`DOUBLE PRECISION`,
  `TIMESTAMP WITH TIME ZONE`, `CHARACTER VARYING(20)`,
  `DECIMAL(10,2)`), followed by any of `NOT NULL`, `NULL`,
  `PRIMARY KEY`, `UNIQUE`, `DEFAULT <expr>` or `REFERENCES t (c)`, the
  importer shall import the column with its type's length and scale.
- **R3.** When an ordinary column is imported, its fact type shall read
  `<Entity> has <Value>` with the entity's role first; uniqueness shall
  sit on the entity's role; `NOT NULL` shall make the entity's role
  mandatory; and a single-column `UNIQUE`, table-level or inline, shall
  add uniqueness on the value's role.
- **R4.** When a table has a single-column primary key, the importer
  shall create an identifier value type carrying the key column's type
  and a preferred identifying binary to it, the shape the dbt importer
  writes, so the key and every foreign key referencing it export with
  that type.
- **R5.** When two columns would create value types with the same name,
  the importer shall share one only under the rule the dbt importer
  uses (same declared type, a value type, not already played by this
  entity), and otherwise create `<Entity><Name>` and warn.
- **R6.** When a column carries an inline `REFERENCES t (c)`, the
  importer shall import it as a foreign key, as it does the table-level
  form.

Acceptance: the first input above round-trips to the same columns,
types, lengths, nullability, uniqueness and keys, and the second
imports all six columns with no drop.

## Scope

Out of scope, each filed:

- **Composite primary keys** (barwise-1077). The importer replaces them
  with an invented `<table>_id`. The faithful shape is an external
  uniqueness over the key columns' binaries, which is a design of its
  own. A multi-column `UNIQUE` needs the same mechanism, so under this
  spec it gets a warning instead of the per-column uniqueness it gets
  today, which over-constrains every column in it.
- **The OpenAPI importer's identical constraint defect** (barwise-1076).
  Same fix, different file and fixtures.
- **Column comments** (`COMMENT ON COLUMN`). The DDL export's
  "No column description" TODO stays true for a DDL import, because the
  source had none.
- **Foreign-key readings.** The foreign-key fact type's reading also
  lists the referenced entity first ("Customers customer Orders"), but
  its constraints are on the right role, so the export is correct. It
  stays as is.

## Inventory

| Site                                             | Today                                                                                    | Change                                                                                            |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `formats/src/ddl/DdlImportFormat.ts`             | One-word types, no length; unparsed columns skipped; key columns skipped; roles reversed | WS1 parser, WS2 roles and constraints, WS3 key identifier                                         |
| `core/src/sql/typeMapping.ts`                    | `mapSqlTypeToConceptual`: name only                                                      | WS1: `parseSqlDataType(raw)` returns name, length and scale                                       |
| `dbt/src/dbtMapping/naming.ts` `resolveDataType` | The same length and scale parse, in dbt                                                  | WS1: delegates to `parseSqlDataType`                                                              |
| `dbt/src/dbtMapping/columnTypes.ts`              | `claimValueType`: the sharing rule, over `DbtMapperContext`                              | WS3: the rule moves to core as `claimValueTypeName`; dbt keeps its wrapper and its report wording |
| `core/src/import/`                               | Import format types only                                                                 | WS3: gains `claimValueTypeName`                                                                   |
| `formats/tests/DdlImportFormat.test.ts`          | Asserts a constraint exists, not which role holds it                                     | Assertions on the role; new cases per requirement                                                 |
| `formats/tests/roundtrip.test.ts`                | Asserts keywords in the re-export                                                        | The first input above, compared column by column                                                  |

`cli/tests/importerIds.test.ts` runs the DDL importer over a fixture and
must stay green: the new identifier binaries mint their ids through
`generateId()`.

## Should the shared rules move into core? (resolved: yes)

Two rules now have two callers each. `resolveDataType`'s length parse
is a pure function of a string, and core already owns the SQL type
mapping it sits on (`mapSqlTypeToConceptual`, which barwise-865 moved
to core for exactly this reason). The value-type sharing rule is a pure
function of an `OrmModel` and a candidate. Both are deterministic, so
core can hold them.

Keeping a copy in each importer would be the parallel code CLAUDE.md
allows when sharing would couple packages. Here it would not: both
importers already depend on core and nothing else. The copies would
also have to agree, or the same schema would share value types
differently by path, which would need a drift test to guard. Sharing
is cheaper than guarding.

Only the decision moves. Naming (`toPascalCase` differs: dbt strips
`stg_` and similar prefixes) and report wording stay in each importer,
because they are not the same decision.

## Target architecture

```ts
// @barwise/core/sql -- typeMapping.ts, beside mapSqlTypeToConceptual
export function parseSqlDataType(raw: string): DataTypeDef | undefined;

// @barwise/core -- import/claimValueType.ts
export type ValueTypeClaim =
  | { readonly kind: "share"; readonly valueType: ObjectType; }
  | {
    readonly kind: "create";
    readonly name: string;
    readonly displaced?: ObjectType;
  };
export function claimValueTypeName(
  model: OrmModel,
  entityId: string,
  entityName: string,
  candidate: string,
  dataType: DataTypeDef | undefined,
  role: "key" | "attribute",
): ValueTypeClaim;
```

DDL import after this change, per table:

```
CREATE TABLE ... (col TYPE[(n[,s])] [NOT NULL|NULL|PRIMARY KEY|UNIQUE|DEFAULT x|REFERENCES t (c)]*)
  entity <Table>              reference_mode: <pk col>
  <Table> has <PkCol>         preferred UC on <PkCol>'s role, UC + mandatory on <Table>'s role   (WS3)
  <Table> has <Col>           UC on <Table>'s role; mandatory if NOT NULL; UC on <Col>'s role if UNIQUE   (WS2)
  <Table> <verb> <Ref>        unchanged
```

## Alternatives considered

- **Fix only the key type, as barwise-1058 asked.** A round-trip test
  of the key would still fail on the reversed constraints, and a key
  column typed `CHARACTER VARYING(20)` would still vanish before the
  fix could see it. The four defects share one parser and one fact-type
  builder.
- **Replace the regex parser with a SQL grammar** (`sqlglot`, which the
  SQL importer already bridges to). It would parse every dialect. It
  adds a Python subprocess to an importer that is pure today, and every
  surface would inherit that dependency. A column parser that reads
  "type words until the first constraint keyword" covers the forms
  `renderDdl` emits and the common hand-written ones, and R1 makes
  every other form visible.
- **Keep putting constraints on the value's role and fix the reading
  instead.** Relabelling the reading as `{0} is of {1}` would make the
  verbalization agree with the constraints, but the constraints would
  still say each value belongs to at most one entity. That is not what
  a column means, and the exporter would still emit `UNIQUE` on every
  column.

## Workstreams

One PR. The three steps touch the same two functions, and the
acceptance round trip needs all three.

1. **Column parser.** A column definition is a name, type words up to
   the first constraint keyword, an optional parenthesized length and
   scale, then any sequence of the clauses in R2. `parseSqlDataType`
   lands in core, and dbt's `resolveDataType` delegates to it. A
   definition that still does not parse produces an R1 warning.
2. **Roles and constraints.** Ordinary-column fact types take the dbt
   shape: `[entity "has", value "is of"]`, readings `{0} has {1}` and
   `{1} is of {0}`, with constraints per R3. A multi-column `UNIQUE`
   produces a warning naming barwise-1077.
3. **Key identifier.** A single-column primary key gets an identifier
   value type and preferred identifying binary per R4, named through
   `claimValueTypeName` (R5). The rule moves from dbt's `claimValueType`
   to core in the same change, and dbt's wrapper calls it. Inline
   `REFERENCES` joins the table-level foreign keys (R6).

## API and migration impact

- Core gains two exports, `parseSqlDataType` (from `@barwise/core/sql`)
  and `claimValueTypeName` with `ValueTypeClaim` (from `@barwise/core`).
  Nothing is removed.
- dbt behaviour is unchanged. Its tests are the check that the moved
  rule and parse still decide the same.
- Models already imported from DDL keep their reversed constraints
  until re-imported. They load and validate as before.

## Risks and testing

- **Golden or characterization churn.** Grounding found no golden built
  from a DDL import, and `roundtrip.test.ts` asserts keywords only. If
  a golden moves, it moves toward the source DDL, and the PR says so.
- **Value types that were shared are now split** when two tables
  declare the same-named column with different types (R5). That is the
  intended result: each column exports with its own type.
- Every new test is seen failing through `scripts/mutate.mjs` before it
  counts as evidence.

## Open decisions (for review)

- **D1. Should a key's identifier value type be shared across tables**
  when two tables have a same-named key of the same type (two `id
  INTEGER` keys)? **Recommendation:** yes, as dbt's D1 decided: sharing
  loses nothing, and one rule for both importers is the point of R5.
  The alternative, a per-entity `<Table>Id` always, renames every such
  key column on export.

## Implementation notes

Landed as specified. D1 took its recommended default: same-named keys of
the same type share one identifier value type.

- **The conceptual types are coarser than SQL.** `BIGINT` re-exports as
  `INTEGER`, `DOUBLE PRECISION` as `FLOAT`, and `TIMESTAMP WITH TIME
  ZONE` as `TIMESTAMP`, because the model has one conceptual type for
  each family. Length and scale survive. This is the model's vocabulary,
  not an import loss, and it is out of scope here.
- **`UNIQUE` comes from the export format, not the renderer.** The first
  version of the round-trip test called `renderDdl` directly and saw no
  `UNIQUE (email)`: the clause is added by `DdlExportFormat`'s
  constraint routing, which is what `barwise export` runs. The test now
  goes through `DdlExportFormat`.
- **Two parser details the draft did not name.** A table-level
  `CONSTRAINT <name>` prefix is stripped, because otherwise the parser
  read `CONSTRAINT` as a column name. A table-level `CHECK (...)`,
  `INDEX name (...)` or `KEY name (...)` is reported as not imported;
  the test for it requires the parenthesized shape, so a column named
  `key` or `index` still imports.
- **One old test could not fail.** `DdlImportFormat.test.ts` asserted
  `warnings.length >= 0` for a `GENERATED ALWAYS AS` column. It now
  asserts the one warning the change produces.
- **Mutation checks, through `scripts/mutate.mjs`.** Each mutation below
  was caught (exit 0). Formats mutations ran
  `npx vitest run tests/DdlImportFidelity.test.ts tests/roundtrip.test.ts
  tests/DdlImportFormat.test.ts` from `packages/formats`; core mutations
  ran `npx vitest run tests/import/claimValueType.test.ts` from
  `packages/core`.

  | Requirement | Mutation                                                                     |
  | ----------- | ---------------------------------------------------------------------------- |
  | R3          | the column fact type's uniqueness on `valueRoleId` instead of `entityRoleId` |
  | R3          | `NOT NULL`'s mandatory on `valueRoleId`                                      |
  | R3          | the single-column `UNIQUE` constraint removed                                |
  | R4          | `createKeyIdentifier` never called                                           |
  | R2          | the length stripped before `parseSqlDataType`                                |
  | R1          | an unknown clause ends the parse without a warning                           |
  | R6          | an inline `REFERENCES` ignored                                               |
  | Scope       | a multi-column `UNIQUE` applied to each of its columns (the old behaviour)   |
  | R5          | `sameDataType` comparing names only (core)                                   |
  | R5          | the already-played check removed (core)                                      |
