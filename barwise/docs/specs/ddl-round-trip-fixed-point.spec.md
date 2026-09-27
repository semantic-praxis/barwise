# A DDL export reads back as the model that wrote it

Status: Accepted -- workstreams 1 and 2 implemented; 3 to 5 not yet

Created: 2026-09-27
Last-updated: 2026-09-27
Tracking: barwise-dnm (workstreams 2 to 4), barwise-kgh (workstream 1),
barwise-1077 (workstream 5); out of scope, tracked separately:
barwise-fly

`barwise export model.orm.yaml --format ddl` followed by
`barwise import model schema.sql --format ddl` should give back the model,
less what DDL cannot say. The enterprise trial runs this on every
customer (`model-roundtrip:ddl`), and it has never passed. Measured
across the 12 trial kernels on main at c6047541, after one fix in
workstream 2, the round trip reports 1,873 deltas. They have seven
causes, and only one of them is a limit of DDL.

## What the round trip loses today

Each kernel is exported, imported and diffed. The counts are summed over
the 12 kernels, measured by a scratch script: export, import,
`barwise diff --format json`, then each removed fact type is classified
by what happened to its players.

| Cause                                                                                                                                                            |                               Deltas | Whose defect                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -----------------------------------: | ------------------------------------------------------------ |
| A comment line above a column glued itself to the column, which the importer then dropped. The column's value type and fact type went with it.                   |      106 value types, 108 fact types | importer (fixed in workstream 2)                             |
| Fact types come back under a name guessed from the column (`Patient has primary Doctor` becomes `Patient provider Doctor`), with guessed readings and role names | 268 fact types renamed, 151 modified | DDL cannot say it; barwise's own comments can (workstream 4) |
| The preferred-identifier mark sits on the entity's role in the kernels and on the value's role in every importer                                                 |                                  177 | a convention, barwise-fly                                    |
| A `CHECK (col IN (...))` the exporter writes is not read back as a value constraint                                                                              |                                  104 | importer (workstream 2)                                      |
| Definitions, aliases, source contexts: the diff reports them, and the trial's grader cannot tell them from real losses                                           | 461 definitions, 59 aliases/contexts | grader (workstream 3); definitions come back in workstream 4 |
| Many-to-many and n-ary fact types come back as entities with an invented key                                                                                     |  37 + 21 fact types, 59 object types | importer, barwise-1077 (workstream 5)                        |
| An n-ary fact type's value roles are not exported at all: `Encounter has Diagnosis at DiagnosisRank` has no `diagnosis_rank` column                              |        every n-ary with a value role | exporter, barwise-kgh (workstream 1)                         |

The first row was the one the issue named ("comments inside the column
list break the importer"), and it was hiding most of the value-type
losses underneath it.

## Principle

**A gate that cannot see its input must not print PASS**, applied to a
grader. The trial's round-trip grader matches a loss-set entry on
element type and change kind only, so a modified object type whose only
change is its definition counts as a finding even though definitions are
declared loss. It also cannot say which of 1,873 deltas are real. The
diff already records each change as data (`ChangeDescription`); the CLI's
JSON output drops it.

**Explicit over implicit.** What the exporter writes, the importer should
read. That covers the DDL it writes (a `CHECK`, the columns of an n-ary
table) and the comments it writes (source element, definition). A
barwise-written DDL file is the one input whose meaning is known exactly.
Guessing names from columns is right for somebody else's DDL, and wrong
when the file itself says what they were.

## Requirements

- **R1. The export carries every role.** An n-ary fact type's table has
  one column per role: foreign-key columns for entity roles, typed value
  columns for value roles. Its primary key is the columns of the
  preferred internal uniqueness constraint, else of the first one. Every
  other internal uniqueness constraint becomes `UNIQUE` (barwise-kgh).
- **R2. The importer reads what the DDL states.** A comment inside a
  column list does not change which columns are read (done). A
  `CHECK (col IN (...))` on one column becomes that value type's value
  constraint. The warning for a `CHECK` the importer cannot read stays.
- **R3. The grader sees what changed.** `barwise diff --format json` also
  emits each delta's `changes` (the structured form `changeDescriptions`
  is rendered from). A loss-set entry may name a `change` kind. A
  modified delta is inside the loss set when every one of its changes is
  covered by an entry. The DDL loss set declares what DDL cannot carry
  and barwise does not annotate: aliases, source context, notes, and a
  data type DDL has no name for (`money`).
- **R4. Barwise reads its own annotations.** The annotated export writes
  one machine-readable comment per table and per column, naming the
  element it came from: the entity type and its reference mode; the fact
  type, its readings and role names; the value type. The importer reads
  them when present and names what it builds from them. Without them
  (`--no-annotate`, or another tool's DDL), it guesses from column names
  as it does today. The existing `-- Definition:` line is read back as the
  definition. The annotation text says nothing about dbt.
- **R5. A table keyed on its foreign keys is a relationship.** A table
  whose primary key is two or more foreign-key columns, and whose other
  columns are value columns, imports as the many-to-many or n-ary fact
  type it maps from, not as an entity with an invented key
  (barwise-1077).

## Scope

In scope:

- `RelationalMapper`'s associative tables (R1).
- `DdlImportFormat` (R2, R4, R5).
- The DDL renderer's annotations (R4).
- `barwise diff`'s JSON output (R3).
- The trial's round-trip grader and DDL loss set (R3).
- The trial rows under barwise-dnm, barwise-kgh and barwise-1077.

Out of scope:

- The preferred-identifier convention (barwise-fly). It changes the
  shipped extraction prompts, so it goes through the prompt-evaluation
  lane, and it gets its own spec. Until it lands, every kernel's round
  trip keeps those deltas, and the `model-roundtrip:ddl` rows are
  reclassified to barwise-fly rather than retired.
- Subtypes and objectification. DDL flattens them, and they are already
  declared loss.
- Annotations in the dbt, OpenAPI and Avro exports.

## Alternatives considered

- **Declare names and readings as DDL loss** (instead of R4). This is
  much less work. It gives up the fixed point for the one DDL whose
  intent is known, and it leaves definitions, which barwise already
  writes into the file, as a permanent loss. Rejected by the user on
  2026-09-27.
- **Match fact types in the diff by their players instead of by name.**
  This would hide the renames from the diff. But the renamed model really
  is different: its verbalization reads differently. It would also
  change `barwise diff` for every other caller.
- **One JSON blob per table instead of per-column comments.** A per-column
  line keeps the comment beside the column it describes, so a person
  editing the DDL moves the two together.

## Workstreams

1. **Export every role** (core, R1; barwise-kgh). This comes first: an
   importer cannot round-trip a column the exporter never wrote. It
   changes every relational export of a model with an n-ary fact type,
   so the golden and example outputs are regenerated.
2. **Read what the DDL states** (formats, R2; barwise-dnm). Comments in
   column lists (done), and `CHECK (col IN (...))` as a value constraint.
3. **Honest grading** (cli and trial, R3; barwise-dnm). The diff JSON's
   `changes`, change-kind loss-set entries, and the DDL loss set's new
   entries. After this the trial's DDL rows name real losses only.
4. **Read our own annotations** (core renderer and formats importer, R4;
   barwise-dnm). The comment format is a contract between the renderer
   and the importer. It is pinned by a round-trip test over the trial
   kernels and the examples, not by a comment.
5. **Relationships keyed on foreign keys** (formats, R5; barwise-1077).

Workstreams 1 and 2 ship together, because both are small defects in
what the two halves write and read. The rest are each their own PR. The
trial gate runs at the end of each one.

## Risks and testing

- **R1 changes shipped outputs.** Every model with a ternary gains
  columns and possibly a different key. The regenerated examples show
  the change in review, and the dbt and OpenAPI outputs change with it.
  Tests: a ternary with a value role, a ternary whose uniqueness spans
  two of three roles, and an n-ary with two uniqueness constraints.
- **R4 makes a comment format load-bearing.** A hand edit to the DDL can
  leave an annotation stale. Rule: an annotation is used only when it
  still matches its column (same column name, and a player that exists),
  and otherwise the importer falls back to guessing and says so.
- **R3 changes `barwise diff` JSON.** The change is additive (a new
  field), and no current reader breaks.
- Every new test must fail against the code before its change. The
  trial gate is rerun after each workstream.

## Open decisions

None. Two decisions were settled by the user on 2026-09-27: R4 over
declaring the loss, and the value role as canonical (barwise-fly).

## Implementation notes

- **Workstreams 1 and 2** (barwise-kgh, part of barwise-dnm). Three more
  defects in the same path surfaced once n-ary value roles had columns.
  - The export annotation looked for a column's value type among the
    other roles of its fact type. That was right for an entity table,
    but on an n-ary table it found the wrong value type, and
    `appointment_date` was annotated with the time slots' values.
  - A value constraint declared on a value type was routed to CHECK for
    binaries only, so an n-ary's value column got no CHECK.
  - A second uniqueness constraint on an n-ary was not emitted at all.
    It is now a `UNIQUE`.
- **The CHECK grammar is one module with a round-trip test.**
  `renderValuePredicate` moved out of `constraintRouting.ts` into
  `valuePredicate.ts` beside `parseValuePredicate`. Each case in
  `valuePredicate.test.ts` goes out through one and back through the
  other.
- **Measured after workstreams 1 and 2** over the 12 kernels:
  - Value-constraint losses went from 104 to 0.
  - Object types removed went from 124 to 8.
  - The total is 1,901 deltas, because each value type that now comes
    back reports its definition instead. Those are declared loss, and
    workstream 3 is what lets the grader see that.
