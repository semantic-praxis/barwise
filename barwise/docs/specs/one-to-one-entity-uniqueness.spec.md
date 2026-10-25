# A one-to-one between two entities keeps both uniqueness constraints

Status: Implemented

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-hjy
Plan-reviewed: 067a9531 (code-review, pr-review)
Touches: barwise/packages/core/src/mapping/constraintRouting.ts,
barwise/packages/core/tests/mapping/ConstraintRouting.test.ts,
barwise/packages/formats/src/ddl/DdlImportFormat.ts,
barwise/packages/formats/tests/DdlRoundTrip.test.ts

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

| Mandatory roles | Where the mapper stores the fact                            | Clauses today |
| --------------- | ----------------------------------------------------------- | ------------- |
| none            | associative table, primary key (customer_id, order_nr)      | none          |
| Order's role    | `order.customer_id`, Customer's key copied as a foreign key | none          |
| Customer's role | `customer.order_nr`, Order's key copied as a foreign key    | none          |
| both            | associative table, primary key (customer_id, order_nr)      | none          |

In the associative table the key spans both columns, so neither "at
most one" holds. In the absorbed shapes the column on the absorbing
side is single-valued, which is that role's uniqueness; the other
role's uniqueness ("each Customer places at most one Order") needs
UNIQUE on the column and has none. `routeConstraints` handles a
single-role internal uniqueness only through `valueColumnForUniqueness`,
which returns nothing unless the constrained role's player is a value
type, and through the n-ary branch, which needs arity above two.

The DDL importer reads a UNIQUE back as a uniqueness in an associative
table (`DdlImportFormat`, the relationship path: `uniqueOver` over each
of `table.uniqueConstraints`), but `createForeignKeyFactType`, which
reads an absorbed foreign key column, never consults
`uniqueConstraints`: it adds only the uniqueness on the row's role. So a
UNIQUE written on an absorbed column would be dropped on import, and the
round trip (`ddl-round-trip-fixed-point.spec.md`: what the exporter
writes, the importer reads) would stop being a fixed point.

## Scope

- When a single-role uniqueness on a binary between two entities has its
  role's own columns in the role's player's table, the router shall
  treat it as realized (the column is single-valued).
- When the role's own columns sit in another table (an associative
  table, or the table of an entity that objectifies the fact type), the
  router shall route UNIQUE on them unless they are that table's whole
  primary key.
- When the role has no column and the partner role's columns sit in the
  partner's player's table (the fact absorbed on the other side), the
  router shall route UNIQUE on the partner's columns unless they are
  that table's whole primary key.
- A dialect without UNIQUE spills it, as for every routed UNIQUE, so the
  schema exports report it.
- When the DDL importer reads a foreign key whose columns are, by
  themselves, a UNIQUE of the table, it shall add the uniqueness on the
  referenced side's role, so the absorbed shape round-trips.

Out of scope: the mapper's choice of an associative table for a
one-to-one with no mandatory or with both; the mandatory gaps
(barwise-plq).

## Workstreams

### 1. The router case

`entityBinaryUniqueColumns` beside `valueColumnForUniqueness`, called
from the internal-uniqueness branch, resolving the role's columns to the
`Table` itself (not a name looked up twice). Acceptance, each pinned by a
test asserting the exact clauses: the four probe shapes route two, one,
one and two UNIQUE clauses (rows of the table above, top to bottom); a
one-to-many binary between entities routes nothing new; a one-to-one
ring stored in one table routes UNIQUE on its foreign key column, and
one stored in an associative table routes two; an objectified
one-to-one routes UNIQUE on the role that is not the objectifying
entity's key; a composite foreign key gets one UNIQUE over all its
columns; a dialect without UNIQUE spills each, and
`unreportedConstraintSpecs` reports it; the corpus effect is recorded
here.

### 2. The import reads it back

`createForeignKeyFactType` adds the far role's uniqueness when the
foreign key's columns are a UNIQUE of the table, in both its annotated
and its inferred branch. Acceptance: exporting each probe shape to DDL
and importing it gives back a model with both uniqueness constraints;
the existing DDL import tests pass.

## Implementation notes

- The round-trip test fails on the four absorbed cases (mandatory on one
  role, with and without annotations) when the importer change is
  removed, and passes with it; the associative cases already read back
  through the relationship path.
- The router resolves the role's columns to their `Table` in one pass, so
  the source-element check reads the table the columns were found in.

- Implementation review: the importer read a UNIQUE over a composite
  foreign key twice, as a far uniqueness on each per-column fact type and
  as step 3b's external uniqueness; it now adds the far uniqueness only
  for a single-column foreign key. And the router returned the same
  "nothing to do" for a realized uniqueness and for one whose roles have
  no column at all; the second now spills ("the roles map to no column")
  rather than vanishing. Over the corpus that spill never fires; each
  dialect with UNIQUE gains exactly the 36 clauses, BigQuery and
  Databricks (no UNIQUE) spill them instead.

## Open decisions

1. **Where "realized" is decided.** (a) The router derives it from where
   the mapper put the role's columns (recommended): one more case in the
   module that already owns the decision for every exporter, and no
   schema change. (b) The mapper records the uniqueness each column
   realizes (a field on `Column`), and the router reads it: more
   explicit, but a new schema field every renderer carries for one
   consumer, and the mapper already records it only for foreign keys
   (`ForeignKey.sourceConstraintId`), which covers one of the three
   places. Recommend (a).
2. **Native or informational.** A new UNIQUE can reject rows an existing
   database built from an earlier export accepted. (a) Route it like
   every other UNIQUE, native where the dialect enforces it
   (recommended): the rows it rejects break a rule the model states, and
   the dialect profile, not this case, decides enforcement. (b) Mark
   these informational: a special case in the router for one kind of
   uniqueness, and a model rule left unenforced by choice. Recommend (a).

Out of scope, noted: dbt could express these as `unique` tests, which
`renderDbt` writes today only for a single-column primary key; with this
change they are reported instead, through barwise-u8y's path.

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
