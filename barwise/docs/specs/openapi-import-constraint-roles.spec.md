# OpenAPI import puts a property's constraints on the entity's role, and imports its id as the key

Status: Implemented -- the single workstream, landed with this spec

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1076

The OpenAPI importer builds each property's fact type with the value's
role first and hangs the uniqueness and `required`'s mandatory on it, the
defect `ddl-import-fidelity.spec.md` fixed in the DDL importer. A
property's fact type now reads `<Entity> has <Value>` with its
constraints on the entity's role, and the property the reference mode
names becomes the entity's preferred identifier, the shape the DDL and
dbt importers write.

## Principle

**Composability.** Three importers turn a column or a property into
`<Entity> has <Value>`. Two of them now build the same shape and share
one value-type sharing rule (`claimValueTypeName` in core). The third
should too, so a schema models the same way whichever format it came
in.

## What the user sees (measured 2026-09-26, on main at 13a82b83)

```json
{
  "Customer": {
    "required": ["id", "name"],
    "properties": {
      "id": { "type": "integer" },
      "name": { "type": "string" },
      "email": { "type": "string" }
    }
  },
  "Order": {
    "required": ["id", "customer"],
    "properties": {
      "id": { "type": "integer" },
      "placedAt": { "type": "string", "format": "date-time" },
      "customer": { "$ref": "#/components/schemas/Customer" }
    }
  }
}
```

`barwise import model api.json --format openapi`, then `barwise verbalize`,
reads "Each Id has at least one Customer" and "Each Name has at most one
Customer". `barwise export --format ddl` gives:

```sql
CREATE TABLE customer (
  id INTEGER NOT NULL,
  belongs_to_id INTEGER,      -- invented
  name TEXT,                  -- was required
  email TEXT,
  PRIMARY KEY (id),
  UNIQUE (name),              -- invented
  UNIQUE (email)              -- invented
);
```

`orders` is the same: a `belongs_to_id` column, and `UNIQUE (placed_at)`.
The `id` property is an ordinary `Id has Customer` fact type, so the
mapper maps it twice: once as the key, whose type it takes from `Id`
by name, and once as the `belongs_to_id` column.

`OpenApiImportFormat.test.ts` passes before and after the fix. It
asserts that a uniqueness or mandatory constraint exists, never which
role holds it, and its comment ("unique on entity side by default") says
the opposite of what the code did.

## Requirements

- **R1.** When a property is imported, its fact type shall read
  `<Entity> has <Value>` and `<Value> is of <Entity>`, with the entity's
  role first, uniqueness on the entity's role, and a mandatory on the
  entity's role when the property is `required`.
- **R2.** When a property is the one the schema's reference mode names
  (`id`, or `<schema>Id`), the importer shall make its fact type the
  entity's preferred identifying binary: preferred uniqueness on the
  value's role, uniqueness and mandatory on the entity's role.
- **R3.** When two properties would create value types with the same
  name, the importer shall share one only under core's
  `claimValueTypeName`, and otherwise create `<Entity><Name>` and warn.

Acceptance: the input above exports as

```sql
CREATE TABLE customer (id INTEGER NOT NULL, name TEXT NOT NULL, email TEXT, PRIMARY KEY (id));
CREATE TABLE order (id INTEGER NOT NULL, placed_at DATETIME, fk_id INTEGER NOT NULL,
  PRIMARY KEY (id), FOREIGN KEY (fk_id) REFERENCES customer (id));
```

and validates with no errors.

## Scope

Out of scope:

- **The `$ref` fact type's reading and the `fk_id` column name.** The
  reference fact type lists the referenced entity first ("Customer
  references Order"), but its constraints are on the right role, so the
  foreign key exports correctly. The column name comes from the mapper.
  The DDL importer's foreign keys have the same reading, and the DDL
  spec left it too.
- **Lengths, formats and value constraints lost on a round trip**
  (barwise-a0h). `maxLength` is still not imported.
- **Two same-named enums with different values** still share one value
  type when their data type agrees; `claimValueTypeName` compares data
  types, not value constraints. Unchanged from before.

## Alternatives considered

- **Fix only the constraint roles, and leave `id` as an ordinary
  property.** The mapper would then map `id` twice, as the key and as an
  `id` attribute column; that is barwise-1074's double mapping, reached
  from a new direction. The identifier shape is what the other two
  importers already write.
- **Skip the reference-mode property, as the DDL importer used to skip
  its key column.** The key's type would be lost, which is barwise-1058
  in a third importer.

## Workstreams

One, in one PR with the spec: `createPropertyFactType` in
`formats/src/openapi/OpenApiImportFormat.ts` changes shape per R1-R3.
Nothing outside that function changes.

## Risks and testing

- Models already imported from OpenAPI keep their reversed constraints
  until re-imported.
- A new test file asserts constraints by the player of the role that
  holds them, as `DdlImportFidelity.test.ts` does, and a round-trip test
  compares the acceptance DDL line by line. Each is seen failing through
  `scripts/mutate.mjs`.

## Implementation notes

Landed as specified. The acceptance DDL above is the exact output, and
the model validates with 0 errors and 1 warning (the `$ref` fact type's
single reading, out of scope).

Mutations through `scripts/mutate.mjs`, against
`npx vitest run tests/OpenApiImportFidelity.test.ts` from
`packages/formats`, each caught (exit 0): the entity-role uniqueness moved
to the value's role (R1); `required`'s mandatory moved to the value's role
(R1); the roles listed value first (R1); `isKey` forced false (R2);
sharing any same-named value type regardless of its type (R3). A control
mutation that changes no behaviour went uncaught (exit 1).
