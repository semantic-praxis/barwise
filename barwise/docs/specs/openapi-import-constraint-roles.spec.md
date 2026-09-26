# OpenAPI import puts a property's constraints on the entity's role

Status: Implemented 2026-09-26 -- the single workstream (see Implementation notes)

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-1076

`barwise import model api.json --format openapi` turns each scalar
property into a fact type whose roles are ordered value-first, and puts
the property's uniqueness and, for a `required` property, its
mandatory constraint on the value's role. The model then says the
opposite of the schema: a required `name` on `Customer` verbalizes as
"Each Name has at most one Customer" and "Each Name has at least one
Customer", and a DDL export makes `name` nullable. The DDL importer had
the identical defect and `ddl-import-fidelity.spec.md` (#570) fixed it
there; this applies the same shape and the same sharing rule to the
OpenAPI importer, so a schema imports the same way whichever importer
reads it.

## Principle

**Composability.** #570 moved the value-type sharing decision into
core (`claimValueTypeName`) so every importer answers it the same way.
The OpenAPI importer still answers it on its own -- it reuses whatever
object type holds the name, entity included -- and orders roles its own
way. One shape and one rule for "a record's scalar field" is the whole
point; a third answer would make the importers disagree about the same
schema written two ways.

## What the user sees (measured 2026-09-26, main at 2671c247, fresh bundle)

Input: the trial reproduction then at `trial/findings/barwise-1076/api.json`
(now the `CUSTOMER` fixture in `formats/tests/OpenApiConstraintRoles.test.ts`), one schema `Customer`
with a required `name: string (maxLength 50)`.

```
Name has Customer
  Each Name has at most one Customer.
  Each Name has at least one Customer.
```

DDL export: `name TEXT` -- nullable. (The lost `maxLength` is
barwise-a0h, out of scope.)

In the enterprise trial, the C01 and C07 OpenAPI acceptance rows fail
mostly on the uniqueness and mandatory checks this causes.

## Requirements

- **R1.** When a scalar property is imported, its fact type shall read
  `<Entity> has <Value>` with the entity's role first and the reading
  `{1} is of {0}` as well; uniqueness shall sit on the entity's role;
  and a property listed in the schema's `required` shall make the
  entity's role mandatory. This is `ddl-import-fidelity.spec.md` R3.
- **R2.** When a property's value-type name is already held, the
  importer shall share it only under `claimValueTypeName` (a value
  type, not already played by this entity, no declared type lost, and
  the same enum or none on both sides),
  and otherwise create `<Entity><Name>` and warn. This is
  `ddl-import-fidelity.spec.md` R5.

Acceptance: the input above verbalizes as "Each Customer has at most
one Name" and "Each Customer has at least one Name", and its DDL export
has `name ... NOT NULL` with no `UNIQUE`.

## Scope

Out of scope:

- `$ref` properties. `createRefFactType` already puts uniqueness and
  mandatory on the referencing entity's role; only its reading is
  awkward, which is not this defect.
- `maxLength`, `format` details and value constraints lost on a round
  trip (barwise-a0h).
- An `id` property that is also the inferred reference mode is still
  imported as an ordinary attribute as well; making it a typed
  identifier, as #570 did for a DDL key, is a separate change (the same
  double mapping as barwise-1074).
- OpenAPI has no single-property `unique` keyword, so there is no
  value-side uniqueness to import (DDL's R3 `UNIQUE` clause has no
  counterpart here).

## Workstream (single)

In `formats/src/openapi/OpenApiImportFormat.ts` `createPropertyFactType`:
order the roles entity-first (`has`, `is of`), add the reverse reading,
put uniqueness and `required`'s mandatory on the entity's role, and
claim the value type through `claimValueTypeName` with role
`"attribute"` and the property's conceptual data type, warning on a
displaced name the way the DDL importer does.

Tests assert constraints by the role's player, not by count -- the
existing tests asserted only that some constraint existed, which is how
both importers shipped this defect.

## Risks and testing

- **Models already imported from OpenAPI** keep their reversed
  constraints until re-imported. No migration.
- **Split value types.** Two schemas with a same-named property of
  different types now get two value types and a warning instead of
  silently sharing one -- intended, as in the DDL importer.
- **The trial rows** classified under barwise-1076 may still fail on
  checks OpenAPI cannot express; each row's note says so, and they are
  reclassified rather than closed when that is what remains.
- Gates: `npx vitest run` in `formats`, `npm run build`, the offline
  trial on a fresh bundle, and `ci:local` before push.

## Open decisions

None. R1 and R2 restate decisions `ddl-import-fidelity.spec.md` already
made for the DDL importer.

## Implementation notes

Landed as specified, in `createPropertyFactType` and a new
`claimPropertyValueType` beside it.

- R2 found a worse case than a type clash: a string property named
  like another schema's entity (`Order.customer` next to `Customer`)
  became a fact type played by the `Customer` entity -- an attribute
  imported as a reference. It now gets `OrderCustomer` and a warning.
- The PR #572 review found that sharing ignored the enum: with
  `Customer.status` enum [active] imported first, `Order.status` enum
  [pending] reused `Status` and took the first domain. The value
  constraint is now part of `claimValueTypeName`'s rule, in core, so it
  holds for every importer; dbt and DDL put their value constraints on
  roles rather than value types, so their imports do not change.
- No existing test pinned the old role order, which is the point the
  spec made about asserting by count: the formats suite passed before
  and after, and 6 of the 8 new tests failed before.
- Acceptance, through a freshly built CLI bundle: the reproduction
  verbalizes "Each Customer has at most one Name." and "Each Customer
  has at least one Name.", and exports `name TEXT NOT NULL` with no
  `UNIQUE`.
