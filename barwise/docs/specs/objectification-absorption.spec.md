# An objectifying entity's table carries the whole fact type it objectifies

Status: Implemented -- the one workstream landed with this spec
Created: 2026-10-07
Last-updated: 2026-10-07
Tracking: barwise-c65; found by `ddl-round-trip-fixed-point.spec.md`,
workstream 5

In one sentence: when an entity objectifies a fact type, the relational
mapper gave its table a column for each entity role only, dropping every
value role, and keyed the table on those entity columns whatever the
fact type's uniqueness said -- so six of the twelve trial kernels
exported a table that both lost a fact and stated the wrong key.

## Principle

**Composability, applied to one decision made twice.** The mapper turns
a whole fact type into columns of one table in two places: an
associative table (`createAssociativeTable`) and an objectifying
entity's table (`settleObjectifiedKey`). barwise-kgh taught the first
to give value roles a column and to key the table on the fact type's
uniqueness. The second copy never learned either, and nothing tied the
two together. The fix is one owner for "a fact type as columns", used
by both.

The cost is measured, and it is worse than a missing column:

| Kernel | Objectifying entity | Declared uniqueness         | Key exported               |
| ------ | ------------------- | --------------------------- | -------------------------- |
| C01    | Admission           | Patient, AdmissionDateTime  | patient, facility          |
| C08    | IntervalReading     | Meter, IntervalTimestamp    | meter                      |
| C09    | ProtocolAmendment   | Protocol, AmendmentNumber   | protocol                   |
| C12    | BenefitIssuance     | Case, Benefit, BenefitMonth | case, benefit              |
| C04    | OrderLine           | Order, ProductVariant       | order, product_variant: ok |
| C07    | OrderItem           | ProductOrder, Offering      | both entity roles: ok      |

In C01 a patient could be admitted to a facility only once; in C08 a
meter could record one reading, ever. Every one of the six also lost
its value column.

The key rule was wrong for objectifications with no value role too, in
the other direction. C05's "Material is produced at Plant in Batch" is
unique on the batch alone, C06's "Shipper books Shipment with Carrier"
on the shipment alone, and C09's "Subject receives Dose of Treatment"
on two of its three roles; each was keyed on all its entity columns,
which allows two rows for one batch or one shipment. A scan of every
kernel and example finds 12 (five of them in the auction example) objectified fact types whose chosen
uniqueness spans fewer roles than the fact type has.

## Scope

In scope:

- When an entity objectifies a fact type with a value role, the mapper
  shall give the entity's table a NOT NULL column for that role, as an
  associative table does.
- When an entity's table absorbs an objectified fact type, the mapper
  shall key it on the fact type's preferred internal uniqueness, else
  its first, else all of its roles -- the rule `associativeKey` already
  applies to an n-ary table.
- When a DDL table's annotation declares that its entity objectifies a
  fact type, the DDL import shall read it as objectifying even when its
  primary key includes a plain column; the relationship builder already
  checks that the key falls on whole roles.

Out of scope:

- An objectified fact type with no entity role is still not absorbed
  (`absorbsAKey`): the entity keeps its own key. Unchanged.
- An objectified binary keyed on one role (a 1:1) now takes that role's
  key rather than both entity columns. No kernel or example has one
  (all 12 found above are ternary); it follows from using one rule.

## Inventory

| Module                                        | Before                                                     | After                                                                   |
| --------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------- |
| `core/src/mapping/RelationalMapper.ts`        | two role-to-column loops; the objectified one skips values | `addRoleColumns` owns the loop; both callers use it                     |
| `core/src/mapping/RelationalMapper.ts`        | `settleObjectifiedKey` keys on entity-role columns         | keys on `associativeKey` over the absorbed columns                      |
| `formats/src/ddl/DdlImportFormat.ts`          | objectifying only when the key is all foreign keys         | also when the table's line declares `objectifies`                       |
| `core/tests/mapping/RelationalMapper.test.ts` | asserted the value role gets no column                     | asserts the column, the key from uniqueness, and the all-roles fallback |

The test that stood in `RelationalMapper.test.ts` asserted the defect
("The value-type role contributes no column"): a limitation pinned as
correct, which is the class `assertion-audit` describes.

## Alternatives considered

- **Add value columns, keep the entity-role key.** The smallest patch
  for the missing data, and wrong for four of the six kernels: the key
  would still forbid what the model allows.
- **Key on every absorbed column.** Never too strong, often too weak:
  C04's order line would accept two rows for one order and product that
  differ only in quantity.

## Workstreams

### 1. One owner for a fact type's columns

`addRoleColumns` takes the loop out of `createAssociativeTable`, adds an
optional `sourceConstraintId` the objectified foreign keys carry, and
`settleObjectifiedKey` calls it and keys on `associativeKey`. The DDL
import counts a declared `objectifies` line. Three mapper tests replace
the one that pinned the defect; each fails against the old key or the
old column rule. The formats corpus test already checks that every
`objectifies` line reads back as its relationship, which is what caught
the import half.

Acceptance: when an entity objectifies a fact type, its table has a
column for every role and a key equal to the fact type's chosen
uniqueness; the DDL round trip of each kernel reads every such entity
back as objectifying its own fact type.

## API and migration impact

- No public API change.
- Every relational export of a model with such an objectification
  changes: DDL, dbt, and anything else built on `RelationalMapper`. A
  table that references the objectifying entity now references its new
  key. The CLI goldens are unchanged: none of their fixtures has one.

## Implementation notes

- **Measured over the 12 kernels' DDL round trip:** 520 deltas to 491,
  and all six objectifying entities read back as objectifying their own
  fact type. Before, four came back objectifying a guessed relationship
  (C01, C04, C07, C12) and two not objectifying at all (C08 and C09,
  whose wrong key was a single foreign key).
- **The import half was found by the formats corpus test,** not
  planned: the auction example's `WonItemHasSoldPriceAtTimestamp` is
  keyed on `(won_item_id, price)`, and the import read only a key made
  of foreign keys as objectifying, so the annotation was never
  consulted.
