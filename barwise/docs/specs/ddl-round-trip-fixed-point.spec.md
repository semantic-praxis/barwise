# A DDL export reads back as the model that wrote it

Status: Accepted -- workstreams 1 to 6 implemented

Created: 2026-09-27
Last-updated: 2026-10-07
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
  data type DDL has no name for (`money`, `other`).
- **R4. Barwise reads its own annotations.** The annotated export writes
  one machine-readable comment per table and per column, naming the
  element it came from: the entity type and its reference mode; the fact
  type, its readings and role names; the value type. The importer reads
  them when present and names what it builds from them. Without them
  (`--no-annotate`, or another tool's DDL), it guesses from column names
  as it does today. Definitions are read back from the machine-readable
  line; the existing `-- Definition:` line stays for the reader
  ("Workstream 4 in detail"). The annotation text says nothing about dbt.
- **R5. A table keyed on its foreign keys is a relationship.** A table
  barwise exported from a fact type reads back as that fact type, from
  its annotation. A table without one, whose primary key is two or more
  foreign-key columns, imports as an objectified relationship over the
  referenced entities, the table's other columns its attributes, not as
  an entity with an invented key (barwise-1077; the shape decided with
  the requester on 2026-10-07, "Workstream 5 in detail").

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

### Workstream 3 in detail

Measured on main at 4982b06c (after workstreams 1 and 2), the 12
kernels' modified deltas carry these change kinds: `definition` on 678
object types and 24 fact types, `readings` and `roleName` on 355 fact
types, constraint changes on 199, `sourceContext` 41, `aliases` 28,
`referenceMode` 18, and `dataTypeChanged` 25.

- **One serializer for both surfaces.** The CLI's `diff --format json`
  and the MCP `diff_models` tool build the same delta object in two
  places. Adding `changes` to one would make them disagree, so the
  per-delta shape moves into `@barwise/core/diff` as `deltaToJson`, and
  both call it. `changes` is already plain data by construction
  (`changeDescription.ts`: copies, never model instances).
- **A loss-set entry's grammar.** `{elementType, kind}` as today, plus
  an optional `change` naming a `ChangeDescription` kind. Any other key
  on the entry is matched against the change's own fields as a subset,
  so `{"change": "dataTypeChanged", "from": {"name": "money"}, "to":
  {"name": "decimal"}}` covers a money column coming back as decimal and
  nothing else. Both ends are named: with only `from`, money read back
  as any type at all would have passed (PR #582 review). An entry
  without `change` covers the whole delta, as before.
- **A modified delta is inside the loss set when every one of its
  changes is covered.** Coverage is per change, not per delta: one
  declared change riding with an undeclared one leaves the delta outside,
  and the failure names the undeclared kind.
- **A diff without `changes` cannot be graded against a change entry.**
  The grader reports `could_not_answer` rather than reading the missing
  field as "no changes", which would pass every modified delta. It does
  so only for a delta a change entry would judge; one a whole-delta
  entry covers, or one no change entry names, is graded as before.
- **What the DDL loss set gains.** `aliases`, `sourceContext` and `note`
  on object and fact types, and `dataTypeChanged` from `money` to
  `decimal` and from `other` to `text`. Definitions are not declared: the export writes them, so they
  are workstream 4's to read back, and until then they are findings.
- **What is left out, and why.** `auto_counter` returns as `integer`,
  and a decimal with a scale but no precision returns with neither.
  Both have DDL spellings (an identity column, `DECIMAL(p, s)`), so they
  are export defects, not DDL limits, and are filed rather than
  declared (barwise-hgr and barwise-e5n).
- **After this workstream the `model-roundtrip:ddl` rows still fail.**
  Every kernel still has definitions, readings and role names outside
  the loss set. What changes is that the row names them.

### Workstream 4 in detail

Measured on main at 77150e44 (after workstream 3 and barwise-hgr/e5n),
the annotated export of the 12 kernels reads back with 678 object type
definitions, 24 fact type definitions, 341 fact types renamed (each an
added and a removed delta), 355 changed readings, 336 changed role
names and 18 changed reference modes. Each one is a guess the importer
makes from a column name, about a model the file already names.

- **One machine-readable line per entity table and per column.** The
  line is `-- barwise:v1 ` followed by one JSON object. JSON because a
  definition is free text: it may hold a colon, a quote or a newline,
  and `JSON.stringify` escapes all three onto one line. The `v1` makes
  a later change of shape detectable rather than misread.
- **Each line says where it belongs.** A table line names its `table`;
  a column line names its `table` and `column`. The importer indexes
  them by those names and does not care where in the file they sit, so
  a reordered file still reads.
- **What a table line carries:** the `entity` name, its
  `referenceMode`, and its `definition`. Only an entity's table gets
  one; an n-ary or many-to-many table imports as an entity until
  workstream 5, and gets its line there.
- **What a column line carries:** the column's binary fact type -- its
  `factType` name, `readings`, `definition`, and `roles` as
  `{name, player}` in the fact type's order -- plus `rowRole`, the
  index of the role the table's own entity plays, and, when the other
  player is a value type, its `definition`. The exporter finds the fact
  type through the column's `sourceRoleId`. A column whose role is not
  in a binary (a unary's boolean, a subtype's key) gets no line, and
  neither does a role spread over several columns (a composite foreign
  key), which the importer reads one column at a time.
- **The importer uses a line only while it still describes the file.**
  A column line is used when its column exists, its row role's player
  is the entity being built, and its other player is the value type it
  names or the entity of the table the foreign key references. A table
  line is used when its entity name is free. Otherwise the importer
  guesses from the column as it does today and warns that the
  annotation no longer matches (Risks, "R4 makes a comment format
  load-bearing").
- **What the line does not carry.** Constraints come from the DDL
  (`PRIMARY KEY`, `NOT NULL`, `UNIQUE`, `CHECK`), which already states
  them; carrying them twice would let the two disagree. Aliases, source
  context and notes stay declared loss, as workstream 3 left them. The
  preferred-identifier mark is barwise-fly's.
- **The `-- Definition:` line stays, for the reader.** The JSON line is
  what the importer reads, so the human line is not parsed: two
  carriers for one definition would have to agree, and only one of them
  can hold a newline.
- **One module owns the format.** `formats/src/ddl/barwiseAnnotation.ts`
  renders and reads the line, the export and import both call it, and a
  round-trip test over the 12 kernels and the examples pins it.

### Workstream 5 in detail

Measured on main at bb526f5e, the 12 kernels export 50 tables keyed only
on foreign-key columns (37 binary many-to-many or one-to-one, 13 n-ary),
two more keyed partly on a value column or on one foreign key, and 15
entity tables of objectified fact types keyed on their foreign keys.
Every one imports today as an entity with an invented `<table>_id` key.

- **A fact-type table gets a table line.** `{"kind": "factTable"}` with
  the fact type's `factType`, `readings`, `definition`, and `roles` as
  `{name, player, columns}` in the fact type's order. `columns` names
  the table's columns for that role -- one for a value role, one per key
  column of the referenced entity for an entity role -- found through
  each column's `sourceRoleId`. A value role also carries its value
  type's `valueDefinition`. A table whose fact type has a role with no
  column gets no line.
- **An objectifying entity's table line names what it objectifies.** The
  entity line gains `objectifies`, the same shape as a fact-type table's.
  The C01 `admission` table has no column for `AdmissionDateTime`, so
  its fact type cannot be named from the table and gets no
  `objectifies`; that is an export defect, filed rather than worked
  around (barwise-c65).
- **The importer builds what the line names.** A fact-type table becomes
  its fact type, not an entity. An objectifying table becomes its entity,
  the fact type, and the objectification. The roles' players come from
  the DDL: an entity role's columns must be a foreign key to the table
  of the named entity, and a value role's column is claimed as that
  value type. Uniqueness comes from the DDL too: the primary key is a
  uniqueness over the roles whose columns it spans, and each `UNIQUE`
  over the roles whose columns it lists. A line that does not match the
  table is set aside with a warning, as in workstream 4.
- **Without a line, a table keyed on two or more foreign keys is an
  objectified relationship** (decided with the requester on 2026-10-07).
  The table's name is the entity; the fact type has one role per
  foreign key in the key, with a uniqueness spanning them; every other
  column is the entity's attribute, as for any table. Names are guessed:
  the fact type is "<A> and <B> <table words>", read "{0} and {1} have
  <table words>". This is also the shape barwise exports an objectified
  fact type in, so an unannotated export of one reads back as one. The
  alternative -- one n-ary fact type with the value columns as roles --
  matched an n-ary export better, but read worse for an ordinary link
  table; with annotations, an n-ary export reads back exactly anyway.
- **What is left for the next PR.** A key or `UNIQUE` over plain
  columns needs an external uniqueness constraint, a different
  mechanism; it closes barwise-1077 in a PR of its own.

### Workstream 6: keys and UNIQUE over plain columns (barwise-1077)

Workstream 5 left the half of barwise-1077 that has no relationship in
it: a `UNIQUE` over several columns, and a primary key with a plain
column in it. Both import today as a warning and nothing else. In ORM,
"this combination of an entity's attributes is unique" is an external
uniqueness over the attributes' fact types, and that is what the export
writes a multi-column `UNIQUE` from (`constraintRouting.ts`): 23 of
them across the 12 kernels.

- **R6.** When an entity table has a `UNIQUE` over two or more columns,
  each of which imported as a binary of that entity, the importer shall
  add an external uniqueness over the binaries' other roles, stored on
  the first column's fact type as the kernels store it.
- **R7.** When an entity table's primary key spans two or more columns
  and is not keyed on foreign keys alone (workstream 5), the key columns
  shall import as mandatory attributes of the entity with an external
  uniqueness over them, instead of being dropped. The entity keeps the
  invented `<table>_id` reference mode, and the warning says so: the
  metamodel has no preferred external uniqueness, so nothing can name
  the combination as the entity's identifier, and an export of the
  result adds the `<table>_id` column back. That gap is its own issue
  (barwise-ezn); no data is lost meanwhile.
- **A column of the relationship the table objectifies** stands for
  that relationship's role: C03's `UNIQUE (policy_number, term_number)`
  is an external uniqueness over PolicyNumber's role and the Term role
  of "Policy is in force for Term", as the kernel has it. The columns of
  a composite foreign key all stand for their one role.
- **A `UNIQUE` or key over a column that imported as nothing** (a
  column of a table that failed to import) keeps today's warning.

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
    back reports its definition instead. Workstream 3 found that these
    are not declared loss after all: the export writes definitions, so
    reading them back is workstream 4.
- **Workstream 3.** The trial's twelve `model-roundtrip:ddl` rows still
  fail, as expected: 1,784 deltas outside the loss set and 103 inside,
  the same 103 as before. Every object type whose aliases, source
  context or money type are now declared also lost its definition, so
  no delta moved inside yet; the change entries start counting once
  workstream 4 reads definitions back. What changed is the row: it names
  the undeclared kinds (`modified object_type Provider (referenceMode,
  definition)`) where it used to name only the element. The trial gate
  is unchanged: 1074 steps, 0 new, 0 stale, 172 open.
- **Workstream 4.** Over the 12 kernels the annotated round trip went
  from 1,869 deltas to 649. Readings, role names and fact-type
  definitions no longer differ, and the 341 renamed fact types come back
  under their own names. The trial's twelve `model-roundtrip:ddl` rows
  still fail, now with 459 deltas outside the loss set (from 1,784) and
  190 inside (from 103). What is left is out of this workstream's reach:
  constraint differences (barwise-fly, and fact types now matched by name
  report theirs as modified), n-ary and many-to-many tables and the value
  types and definitions on them (workstream 5), subtypes and
  objectification (declared loss), and entities whose key is composite.
  The trial gate is unchanged: 1074 steps, 0 new, 0 stale, 172 open.
  - **An entity may play one value type twice.** The corpus test found
    Listing's opening and closing `Timestamp` coming back as
    `ListingTimestamp`: core's `claimValueTypeName` refuses a second role
    for one entity, because a second guessed "<Entity> has <Name>" would
    collide with the first. An annotated fact type has its own name, so
    the importer passes `namedFactType` and the refusal is lifted for it
    only; the dbt importer is unchanged.
  - **A line whose table or column is gone is reported.** The first
    version ignored such a line silently, which is the case a hand rename
    produces. Now it is named in the warnings.
- **Workstream 5.** Over the 12 kernels the annotated round trip went
  from 649 deltas to 528: fact types removed from 77 to 11, object types
  added from 58 to 3. Every fact-type table now reads back as its fact
  type, under its own name, readings and roles. What is left of the
  relationships is two filed defects:
  - **barwise-c65.** Six objectified fact types (C01 Admission, C04
    OrderLine, C07 OrderItem, C08 IntervalReading, C09 ProtocolAmendment,
    C12 BenefitIssuance) lose their value role in the export, so the
    table cannot name them and the import guesses the relationship.
  - **barwise-4gr.** Five binaries whose role is a composite foreign key
    get no column line (workstream 4 skips them), and still import under
    guessed names.
  - **A pre-existing parse defect surfaced in the corpus test.** The
    column list of a `PRIMARY KEY` or `FOREIGN KEY` was read with a lazy
    `(.*?)`, so a quoted name with a parenthesis in it --
    `"(ambiguous)"` in the pii-redaction example -- cut the list short and
    the key was lost. The list is now read quote-aware.
  - **A stale fact-type line falls back all the way.** The first version
    made the table an entity but skipped the keyed-on-foreign-keys rule,
    so it lost its key; a test caught it.
- **Workstream 6.** All 23 external uniquenesses in the kernels now read
  back over the same roles, from none: a corpus test in
  `BarwiseAnnotation.test.ts` pins it, keyed by role position among
  each fact type's players, since the import mints new role ids and an
  identifier's fact type and value type can be spelled its own way.
  - **The kernel delta count rose, 528 to 535, while fidelity improved.**
    Core's diff resolves a role outside the host fact type by its raw id,
    so every external uniqueness reads as removed and added after any
    import, and the import may host one on a different fact type than
    the original (C03). Before this workstream they read only as
    removed. That is a defect in the instrument, filed as barwise-b7z,
    not a loss; the corpus test above is the measurement that holds.
  - **The first version missed C03's policy period,** whose `UNIQUE`
    spans a relationship column and an attribute; step 3b looked only
    at binaries. The relationship builder now returns each column with
    the role it plays.
  - **No preferred external uniqueness.** A composite key over plain
    columns still identifies its entity by an invented `<table>_id`,
    and the warning names barwise-ezn.
