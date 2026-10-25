# A mandatory role the mapping does not enforce is reported

Status: Draft

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-plq
Touches: barwise/packages/core/src/mapping/constraintRouting.ts,
barwise/packages/core/tests/mapping/ConstraintRouting.test.ts,
barwise/packages/core/tests/mapping/unreportedConstraintSpecs.test.ts,
barwise/packages/cli/tests/characterization/golden/clinic-appointments.ddl.txt,
barwise/docs/specs/schema-export-constraint-specs.spec.md,
barwise/docs/IMPORT_EXPORT.md

When the relational mapping does not enforce a mandatory role, the
constraint router shall spill it, with a reason naming the shape and at
the table that holds the role's fact, so DDL comments it and every
export report names it. Today the router treats every mandatory as
realized (`case "mandatory": break`), so "each Deal has some Term" or
"each Deal governs some ConsignmentAsset" vanishes from DDL, OpenAPI,
Avro and dbt without a word.

## Principle

Explicit over implicit. A constraint is enforced, recorded, or
reported; never silently dropped. The mapper enforces a mandatory role
by one structure: a NOT NULL column for the role in its own player's
table. Every other shape leaves the rule to something DDL does not
write (an assertion, a trigger, a check over a flag), so it is a spill
like every other rule SQL DDL cannot express. One case in the router
covers DDL and, through `unreportedConstraintSpecs`, the three schema
exports. The case reads the same "role's columns in its own player's
table" test the one-to-one uniqueness rule reads, so the two agree on
where a role's fact lives.

## Observed today (at 4a812272)

Over every tracked `.orm.yaml` that loads and maps, 1,101 internal
mandatory constraints:

| Shape                                                                           | Count | Enforced |
| ------------------------------------------------------------------------------- | ----- | -------- |
| A NOT NULL column for the role in its own player's table                        | 1,060 | yes      |
| A role of an objectified fact type (columns in the objectifying entity's table) | 15    | no       |
| A role of a binary stored in an associative table                               | 15    | no       |
| A role of an n-ary fact type                                                    | 7     | no       |
| The "one" side of a one-to-many (no column of its own)                          | 4     | no       |

The associative binaries are many-to-many fact types and one-to-ones
with both or neither role mandatory. The corpus has no mandatory unary,
no mandatory on a value role, and no fact type between two value types;
those shapes are not enforced either, since the mapper writes a unary as
a nullable flag (`mapUnaryFactType`) and a value type has no table.
Nineteen of the 1,101 are deontic: 15 sit on NOT NULL columns and 4 are
among the unenforced.

## Scope

- When a mandatory constraint's role has columns in its own player's
  table and none is nullable, the router shall treat it as realized, as
  today.
- Otherwise it shall spill it, with the reason for its shape, at the
  table holding the role's columns where there is one, else the role
  player's table, else the fact type's:

| Shape                                    | Reason                                                                      |
| ---------------------------------------- | --------------------------------------------------------------------------- |
| unary (nullable flag)                    | a unary fact maps to a nullable flag, which no column constraint makes true |
| other nullable own column                | the role's column is nullable                                               |
| value role (the value type has no table) | a value type has no table in which to require the role                      |
| fact stored in another table, or none    | each instance must appear in another table, which no column can require     |

- DDL structure does not change; each spill adds a comment and a
  `ConstraintSpec`, and the schema exports report it.
- `schema-export-constraint-specs.spec.md` and `IMPORT_EXPORT.md` stop
  listing barwise-plq as an open gap.

Out of scope: enforcing them (an assertion, a trigger, `CHECK (flag)`
for a unary, a dbt test of the "every parent has a child" form), which
the report makes visible first; and the mapper's choices behind some
shapes (a one-to-one with both roles mandatory stored associatively,
deontic mandatories written NOT NULL).

## Workstreams

### 1. The router case

`ownTableColumns` (shared with the one-to-one uniqueness rule) and
`mandatoryGap` in `constraintRouting.ts`, read in the `mandatory` case.
Acceptance, each pinned by a test asserting the reason and, where
placement is the point, the table: a role absorbed as a NOT NULL column
routes nothing; the "one" side of a one-to-many, a many-to-many role and
an n-ary role spill with the another-table reason; an objectified
role's spill sits at the objectifying entity's table; a mandatory unary
and a value-role mandatory spill with their own reasons;
`unreportedConstraintSpecs` reports an unenforced mandatory; the corpus
effect is recorded here.

## Open decisions

1. **Where the spill sits.** (a) The table holding the role's columns,
   else the player's table, else the fact type's (recommended): the
   comment lands beside the data a reader would add the check over, and
   an objectified fact type's columns are in its entity's table, which
   the fact-type lookup cannot find. (b) Always the fact type's table:
   one rule, but it misplaces every objectified fact type (15 of the 41).
   Recommend (a).
2. **One reason or one per shape.** (a) One per shape (recommended): a
   unary needs a check over a flag and a value role has no table at all,
   so one sentence about "another table" would be false for them. (b)
   One reason: simpler, and wrong for the shapes the corpus lacks.
   Recommend (a).
3. **A mandatory unary.** (a) Spill it (recommended): the router has a
   CHECK channel, but `CHECK (flag)` on a nullable flag is a mapping
   decision (should the flag be NOT NULL and true?) that belongs with
   the mapper, and no tracked model has one. (b) Route `CHECK (flag IS
   TRUE)`: enforces it now, and makes the router decide a column's
   meaning. Recommend (a).
4. **Modality.** (a) Route deontic like alethic (recommended): the
   router reports what the schema does not enforce; whether a deontic
   rule should be enforced at all is the mapper's question, and it
   writes 15 of them NOT NULL today. (b) Never count a deontic mandatory
   as realized: reports obligations the schema hard-enforces as "not
   enforced", which is false. Recommend (a).

## Risks and testing

Measured on a prototype over every tracked `.orm.yaml`: 41 new spills in
postgres DDL across 16 files, each a comment with the another-table
reason; no non-comment line of any DDL changes. The OpenAPI, Avro and
dbt reports grow by the same 41 (402 to 443 specs, now in 55 of the 84
models). One CLI golden gains its comment line.

A reported mandatory on the second role of a binary whose only reading
runs from the first role verbalizes backwards ("Each Customer is placed
by at least one Order"); that is a verbalizer defect older than this
change, which this makes more visible. Filed as barwise-wsl.
