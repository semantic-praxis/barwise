# A one-to-one between two entities keeps both uniqueness constraints

Status: Draft

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-hjy
Touches: barwise/packages/core/src/mapping/constraintRouting.ts,
barwise/packages/core/tests/mapping/ConstraintRouting.test.ts

When a single-role uniqueness on a binary fact type between two entities
is not realized by the relational mapping, the constraint router shall
route it as `UNIQUE` on the columns that store the fact, as it already
does for the value side of an entity-value binary. Today both
uniqueness constraints of a one-to-one stored in an associative table,
and the partner's uniqueness of a one-to-one absorbed as a foreign key,
are lost from DDL without a clause or a spill: "each Customer places at
most one Order" leaves no trace in the artifact.

## Principle

Determinism and explicit over implicit. A uniqueness constraint is a
statement the model makes; the DDL either enforces it, records it as an
informational clause, or reports it as a spill. Silence is not one of
the outcomes, and it is the outcome here. The router already owns "what
the mapping realized" for every exporter (`schema-export-constraint-specs.spec.md`),
so the fix is one more case in it, and OpenAPI, Avro and dbt report the
same constraints through `unreportedConstraintSpecs` with no change of
their own.

## Observed today (at 5a6381ba)

A probe model, Customer places Order, both roles unique, run through
`RelationalMapper` and `routeConstraints` under the postgres profile:

| Mandatory roles | Where the mapper stores the fact                                   | Clauses today |
| --------------- | ------------------------------------------------------------------ | ------------- |
| none            | associative table, primary key (customer id, order nr)             | none          |
| Order's role    | `order.id`, a foreign key to customer, tagged with Order's role    | none          |
| Customer's role | `customer.nr`, a foreign key to order, tagged with Customer's role | none          |
| both            | associative table, primary key (customer id, order nr)             | none          |

In the associative table the key spans both columns, so neither "at
most one" holds. In the absorbed shapes the column on the absorbing
side is single-valued, which is that role's uniqueness; the other
role's uniqueness ("each Customer places at most one Order") needs
UNIQUE on the column and has none. `routeConstraints` handles a
single-role internal uniqueness only through `valueColumnForUniqueness`,
which returns nothing unless the constrained role's player is a value
type, and through the n-ary branch, which needs arity above two.

## Scope

- When a single-role uniqueness on a binary between two entities has its
  role's own columns in the role's player's table, the router shall
  treat it as realized (the column is single-valued).
- When the role's own columns sit in another table (an associative
  table), the router shall route UNIQUE on them unless they are that
  table's whole primary key.
- When the role has no column and the partner role's columns sit in the
  partner's player's table (the fact absorbed on the other side), the
  router shall route UNIQUE on the partner's columns unless they are
  that table's whole primary key.
- A dialect without UNIQUE spills it, as for every routed UNIQUE, so the
  schema exports report it.

Out of scope: the mapper's choice of an associative table for a
one-to-one with no mandatory or with both; the mandatory gaps
(barwise-plq).

## Workstreams

### 1. The router case

`entityBinaryUniqueColumns` beside `valueColumnForUniqueness`, called
from the internal-uniqueness branch. Acceptance: the four probe shapes
route two, one, one and two UNIQUE clauses, in the table's order;
a one-to-many binary between entities routes nothing new; a one-to-one
ring (one entity type in both roles) routes as the two-entity case;
the suites pass; the corpus effect is recorded here.

## Risks and testing

Every new clause is a constraint the DDL now enforces natively in
dialects with UNIQUE, so an existing database built from an earlier
export can reject data it accepted before: that data broke a rule the
model states. The corpus measurement below names how many clauses that
is. Measured on a prototype over every tracked `.orm.yaml`: 36 new
UNIQUE clauses in postgres DDL across 14 files, no clause removed
(the other changed lines are earlier lines gaining a trailing comma);
one sample is the one-to-one ring "Bid responds to Bid" in
`docs/auction.orm.yaml`, whose associative table now has `UNIQUE
(bid_id)` and `UNIQUE (..._bid_id)`. The OpenAPI, Avro and dbt reports
grow by the same 36, from 366 to 402 specs.
