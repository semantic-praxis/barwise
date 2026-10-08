# The trial's DDL generator states what the kernel states: one table per objectification, one name per column

Status: Implemented -- the one workstream landed with this spec
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-rlv (decided by the requester on 2026-10-08: key the
objectified table on its roles; declare reading-worded checks
not_expressible for ddl)

In one sentence: `relationalView`, the relational ground truth both
trial generators (DDL and dbt) build from a kernel, writes each
objectified fact type as one table keyed on its uniqueness, names a
column after its role wherever two columns of a table would share a
name, and refuses a file that creates a table name twice, so a skinned
artifact is valid DDL that states the kernel's structure.

## Principle

**An instrument must be able to report the state it was asked about.**
The acceptance rows grade whether an import recovers a customer's model
from the customer's schema. Where the generator writes a schema that
does not contain the model, a failure measures the generator, and a pass
can measure nothing: C10's sis-dba passed over a file that creates
`SPRIDEN` twice (PR #611 review). Three defects make the artifact state
less than the kernel, and every one of the 12 customers has at least one.

## Inventory

Measured over the small tier on main after #611.

| Defect                                               | Where                                                                                                                                                                                                                                   | Effect on the artifact                                                                                           |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| An objectified fact type is two unlinked tables      | all 12 kernels (17 objectifications)                                                                                                                                                                                                    | the entity table has a surrogate key and no role columns; the fact table has the roles and no link to the entity |
| A column is named after its player                   | 14 kernel tables in 10 customers: 12 self-references (C03 `pc_policy_period`, C10 `SCBCRSE_IS_PREREQUISITE_OF_SCB`, ...), two roles with one player (C06 `leg`: two `port_id`), an inherited key beside a reference (C01 `OUT_PAT_ENC`) | the CREATE TABLE declares one column twice: invalid DDL, and the roles cannot be told apart                      |
| A skin's extra table shares a generated table's name | C10 only: `SPRIDEN`, `SFRSTCR`, `STVTERM`                                                                                                                                                                                               | the file creates each twice; the import keeps the first                                                          |

## How is an objectified fact type written? (resolved: one table keyed on the roles)

**The objectifying entity's table absorbs the fact type's role columns
and is keyed on the fact type's preferred (else first) uniqueness.**
This is what barwise's own exporter settled on in #600, and it is the
only shape in which the artifact states both the entity and the
relationship it objectifies: C10's registrar checks for a fact type
connecting Student and CourseSection, which exists in the kernel only as
the objectified "Student enrolls in CourseSection for Term". The DDL
importer reads a table keyed on two or more foreign keys as objectified
(ddl-round-trip-fixed-point workstream 5), so the shape is also one the
import can recover.

Refinements:

- The entity's own preferred identifier, where it has one (C03's
  PolicyPeriodId, C08's AgreementNumber), stays a column and becomes a
  single-column `UNIQUE`: it is still an identifier, just not the key.
- A table that references an objectified entity carries one foreign-key
  column per key column, as a composite `FOREIGN KEY`. C12's
  Determination is referenced five times and references itself, so this
  is real work in the generator, not an edge case.
- An objectification whose player is itself objectified (C04's
  Fulfillment over OrderLine) is settled after the one it depends on.
- A uniqueness that spans one role (C05's WorkOrder, C06's Booking)
  keys the table on one foreign key. That is the shape barwise-1078 and
  barwise-2z1 already describe on the import side; the generator writes
  it as the kernel says.

Rejected: a surrogate key with a `UNIQUE` on the role columns. It is
smaller (single-column foreign keys only) and common in vendor schemas,
but the import then sees an entity with three relationships, not an
objectification, and C10's Student-CourseSection check would newly fail.

## How is a repeated column named? (resolved: after its role)

**When two columns of one table would share a name, each one that came
from a role is renamed `<role name>_<column>`; an inherited key keeps
its name.** For a fact table that is the column's own role ("Course is
prerequisite of Course" gives `is_prerequisite_of_course_id` and
`requires_course_id`); for a column absorbed into an entity's table it
is the role the entity plays ("Leg departs from Port" gives
`departs_from_port_id`). The rule is general because the defect is:
self-references are 12 of the 14 tables, and the other two are a
different cause with the same symptom.

A self-reference is named after its role even with no clash:
`determination_case_id` inside Determination's own table would read as
its key.

The skin's naming can still make two names one after this: C12 cuts
every identifier to 8 characters, so the three
`supersedes_determination_*` columns all become `SUPERSED`.
`generateDdl` numbers the tail (`SUPERSED`, `SUPERSE2`, `SUPERSE3`),
as a mainframe schema tool does, and settles every table's identifiers
before writing any, so a foreign key in another table names the same
columns.

## How are colliding extra tables handled? (resolved: refused, and C10's replaced)

`generateDdl` throws when a skin's extra table has the name of a
generated table. C10's three colliding extras are replaced with real
Banner tables that do not collide (`SPBPERS`, `SFRSTCA`, `SOBTERM`), so
the skin keeps its hand-written irregularity. The grader's
`declaredTwice` guard (#611) stays: it costs nothing and answers for a
collision the generator did not write.

## Should reading-worded checks keep failing? (resolved: no, they are not_expressible for ddl)

A vendor DDL states table and column names and never a predicate
reading; the import names a foreign-key-keyed table's relationship
"{0}, {1} and {2} have sfrstcr". So no generator change lets "Enrollment
is where Student enrolls in CourseSection for Term." pass, and the four
checks worded around a reading are declared `not_expressible` for `ddl`,
with that reason. It is a format limit, which is the only thing
`not_expressible` may record:

| Customer | Persona                 | Check                                                                                                        |
| -------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ |
| C10      | ir-analyst              | Enrollment is where Student enrolls in CourseSection for Term.                                               |
| C10      | registrar-data-steward  | Each combination of Student, CourseSection and Term is unique in Student enrolls in CourseSection for Term.  |
| C12      | modernization-architect | Determination is where Case is determined for Program in CertificationPeriod.                                |
| C12      | policy-analyst          | Each combination of Case, Program and CertificationPeriod is unique in Case is determined for Program in ... |

## Scope

In scope:

- When the kernel objectifies a fact type, `relationalView` shall emit
  no separate table for it, add its role columns to the objectifying
  entity's table, and key that table on the fact type's preferred (else
  first) internal uniqueness.
- When a table references an entity whose key has more than one
  column, the generators shall write one column per key column and one
  composite foreign key (DDL), and one relationships test per column
  (dbt).
- When two columns of one table would share a name, the one from a
  role shall be named after that role.
- When the skin's naming makes two column identifiers of one table
  alike, `generateDdl` shall number them apart within the identifier
  limit.
- When a skin's extra table has a generated table's name,
  `generateDdl` shall throw.
- C10's skin shall carry extra tables that collide with nothing.
- The four checks above shall be declared `not_expressible` for `ddl`.

Out of scope:

- The import side. Composite foreign keys may import badly; a subtype
  table still imports without its reference (barwise-1078); an
  all-role table keyed on part of its roles still imports as an entity
  (barwise-2z1). Each failure that remains is reclassified to its own
  cause, and a new importer defect gets its own issue.
- Other internal uniquenesses of an objectified or n-ary fact type
  beyond the one that keys its table.

## Workstreams

One workstream: the generator, the C10 skin and the declarations land
together, since the trial grades them together and a partial change
would reclassify rows twice.

Tests in `trial/tests/generators.test.mjs`: an objectification becomes
one table keyed on its roles with the own identifier `UNIQUE`; a
reference to it is a composite foreign key; a self-reference and a
two-role player are named after their roles; names truncation makes
alike are numbered apart and references follow; a colliding extra table
throws; dbt states a key of several columns as one model test.

Acceptance: over the regenerated small tier, no generated table declares
a column twice and no file creates a table twice; the six barwise-rlv
rows pass or fail only on a cause that is not the generator's, and each
is reclassified to that cause; barwise-rlv's class and findings
directory are removed.

## Implementation notes

Measured over the regenerated small tier, 2026-10-08.

- **Five of the six barwise-rlv rows pass**: C03 policy-admin-dba, C10
  registrar-data-steward and sis-dba, C12 modernization-architect and
  policy-analyst. C10's ir-analyst fails one check, "GraduateStudent is a
  subtype of Student.", which is barwise-1078 (a primary key that is also
  a foreign key) and is reclassified there. No other step newly fails.
- **The truncation refusal fired before the numbering existed.** The
  first version threw when an emitted table declared a column twice, on
  the reasoning that a generator should refuse what it cannot write
  validly. C12's generation threw at once, on `SUPERSED`. A real
  mainframe tool does not refuse; it numbers, so the generator does too,
  and the throw went: numbering leaves no case for it to catch.
- **dbt had the same defect one layer over, and fixing it exposed an
  importer gap.** The dbt generator built from the same view and tested
  every column of a composite key as `unique` by itself, a constraint
  the kernel never states. Removing that and writing the key as one
  `dbt_utils.unique_combination_of_columns` test, as a dbt project does,
  turned three dbt imports (C03, C04, C11) from PASS to REFUSED: the dbt
  importer identifies a model's key only from a column with both
  `unique` and `not_null`, so a composite-key model is skipped and named
  on stderr. The earlier passes rested on the false per-column tests,
  which made the importer take the first key column as the whole key.
  That is the composite-key gap barwise-nkn already tracks.
