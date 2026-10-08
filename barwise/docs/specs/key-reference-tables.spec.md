# A primary key that is also a foreign key imports its reference

Status: Draft -- no workstream implemented
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-1078

In one sentence: an unannotated table whose single-column key also
references another table imports as a subtype of that table when its
name ends in the referenced table's head noun and it repeats none of
that table's other columns, with the inference reported; any other such
table keeps today's reading until core can identify an entity through
another entity, which is a follow-up.

## Principle

**Explicit over implicit, and an importer that drops what it read is
not being explicit.** Today `DdlImportFormat` keeps the key, drops the
reference and warns (barwise-1078). The DDL states the reference
plainly; what it does not state is whether the dependent table is a
kind of its parent (a subtype) or more columns of it (a one-to-one
extension). Both have exactly the same shape, so this spec is about what
to do with a fact the schema does not give.

## What the shape means in the trial (measured 2026-10-08)

| Table (customer)                                    | References         | Kernel                               | Last name word, theirs / parent's | Rule result          |
| --------------------------------------------------- | ------------------ | ------------------------------------ | --------------------------------- | -------------------- |
| `GRADUATE_SGBSTDN` (C10)                            | `SGBSTDN`          | subtype of Student                   | SGBSTDN / SGBSTDN                 | subtype, right       |
| `SCREEN_FAILED_SUBJECT`, `ENROLLED_SUBJECT` (C09)   | `SUBJECT`          | subtypes of Subject                  | SUBJECT / SUBJECT                 | subtype, right       |
| `RANDOMIZED_SUBJECT` (C09)                          | `ENROLLED_SUBJECT` | subtype of EnrolledSubject           | SUBJECT / SUBJECT                 | subtype, right       |
| `SERIOUS_ADVERSE_EVENT` (C09)                       | `ADVERSE_EVENT`    | subtype of AdverseEvent              | EVENT / EVENT                     | subtype, right       |
| `IN_PAT_ENC`, `OUT_PAT_ENC`, `ED_ENC` (C01)         | `ENC`              | subtypes of Encounter                | ENC / ENC                         | subtype, right       |
| `TRAUMA_ENC` (C01)                                  | `ED_ENC`           | subtype of EmergencyEncounter        | ENC / ENC                         | subtype, right       |
| `MED_ORDER`, `LAB_ORDER` (C01)                      | `ORDER`            | subtypes of Order                    | ORDER / ORDER                     | subtype, right       |
| `SGBSTDN`, `PEBEMPL` (C10)                          | `SPRIDEN`          | Student, Employee subtypes of Person | SGBSTDN, PEBEMPL / SPRIDEN        | not a subtype, miss  |
| `SIBINST` (C10)                                     | `PEBEMPL`          | Faculty subtype of Employee          | SIBINST / PEBEMPL                 | not a subtype, miss  |
| 42 extension tables, `PAT_2` to `LAB_ORDER_3` (C01) | their base table\* | the same entity, more columns        | 2 or 3 / the base's               | not measured\*       |
| `user_profiles` (barwise-1078's own example)        | `users`            | a one-to-one extension               | PROFILES / USERS                  | not a subtype, right |
| `LEGACY_ORDER`, a copy of `ORDER` (test control)    | `ORDER`            | not a subtype                        | ORDER / ORDER                     | not a subtype, right |

The rule has two conditions. **The table's name ends in the referenced
table's head noun** (its last word, singular and plural alike), and
**it repeats none of that table's non-key columns.** The head noun alone
has a false positive the trial cannot show: a prefix-qualified copy --
`LEGACY_ORDER` keyed on `ORDER`'s key -- ends in the
parent's noun and is not a kind of it (PR #620 review). A copy repeats
its parent's columns and a subtype adds its own, so the second condition
separates them. Measured over the three customers with this shape, no
real subtype repeats a parent column (11 of 11), and the control fails
the second condition. The three misses are C10's vendor dictionary
codes, where no name carries the noun; they keep today's reading.

\*The extension tables are not evidence yet (PR #620 review). The trial
generator writes them with a primary key and no `FOREIGN KEY`
(`trial/lib/generators/ddl.mjs`, the `extension_tables` idiom); only its
manifest records the reference. So no import has ever seen them as this
shape, and an earlier draft's "42 extension tables rejected" was read
off their names, not measured. By name they would fail the head noun --
`PAT_2` ends in `2` -- but that is a prediction until the generator
emits the reference and the trial is re-run, which is in scope below.

**What neither condition can tell apart** (PR #620 review): a table
keyed on its parent that holds rows for only some parents, with facts of
its own -- `ARCHIVED_ORDER(order_id, archived_at)` -- reads as a subtype,
and in ORM terms that is what it is: ArchivedOrder is an Order that has
an ArchivedAt, a subset with its own facts. The case the DDL cannot
separate from a subtype is a vertical partition that every parent row
has, one table split in two; both are a key that is also a reference,
and no constraint in a CREATE TABLE says "every parent has a row here".
The rule reads that case as a subtype too when its name carries the
parent's noun. This is the residual false positive, recorded here rather
than designed away: until barwise-3pc gives the importer a one-to-one
reading to fall back on, a user who knows the table is a partition can
only remove the subtype by hand, which also removes the relationship.
The tests carry `ARCHIVED_ORDER` as a control that pins this behaviour,
with a comment naming the limit.

**barwise's own export loses its subtypes today, annotated or not** (PR
#620 review). An earlier draft said the export's annotation is read
first and so is unaffected. It is not: the table annotation
(`barwiseAnnotation.ts`, `TableAnnotation`) records the entity,
reference mode, definition and objectification, and nothing about a
supertype. Measured on `examples/output/employee-hierarchy.orm.yaml`:
exported as annotated DDL and imported again, both subtype facts are
gone -- Manager's shared key (identifying) warns as barwise-1078, and
Employee's `person_id` column (non-identifying) imports as an ordinary
relationship. So the annotation gains an explicit `supertypes` list, which
the export writes and the import reads before any naming rule:
explicit where barwise wrote the DDL, inferred only where it did not.

## Options

| Option                                                                                                             | Subtype checks                       | Extension tables, copies                                                                                                                                                                                                                 | Cost                                                   |
| ------------------------------------------------------------------------------------------------------------------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| A. always a subtype                                                                                                | pass                                 | wrong: `PAT_2` becomes a kind of PAT                                                                                                                                                                                                     | simplest; asserts "is a" the DDL never said            |
| B. never a subtype: today's reading, the reference dropped with a warning; subtype checks declared not_expressible | out of reach                         | right                                                                                                                                                                                                                                    | no inference; known information loss until barwise-3pc |
| C. the two-condition rule, today's reading otherwise (recommended)                                                 | pass except C10's three coded tables | right for copies, and by name for the trial's 42 (to be measured); wrong for a vertical partition named with its parent's noun (the documented false positive), which by hand can only be undone with the relationship until barwise-3pc | a naming heuristic, reported per table                 |

Recommended: **C**, with every inferred subtype named in a warning
("imported as a subtype of ENC: its name ends in ENC's head noun and it
repeats none of ENC's columns"), so the inference is visible and
reversible by hand, except the documented false positive above, which loses the relationship when undone until barwise-3pc. B is the fallback if review judges any naming
inference out of bounds, on the reason that a subtype and a one-to-one
extension have one relational shape. A subtype read this way
round-trips: the mapper writes exactly this shape for a subtype.

## Requirements

1. When an unannotated table's key column carries exactly one foreign
   key, that foreign key is a shared-key foreign key and it meets both
   conditions below (two or more shared-key foreign keys are requirement
   2's; any other foreign key on the key column, shared-key or not,
   leaves the table to requirement 3, since a subtype that drops a
   second reference is the information loss this spec exists to end;
   PR #620 review) -- a shared-key foreign key being one whose
   source columns are exactly the table's primary key, a single column,
   and whose referenced columns are exactly another table's complete
   primary key (PR #620 review: not a composite foreign key that merely
   contains the key column, and not a reference to an alternate UNIQUE
   column) -- and the table's name ends in the referenced
   table's head noun, and the table repeats none of the referenced
   table's non-key columns, both as defined under "Matching" below, the DDL importer shall import the table's entity as a subtype
   of the referenced table's entity, identified through it. The
   subtype's own key column then imports as no preferred identifier:
   today's importer gives every entity table a preferred key-value
   fact first (`DdlImportFormat.ts`, the key step), and keeping it
   beside an identifying subtype fact gives the entity two identity
   sources, which `completenessWarnings.ts` reports as conflicting
   identification (PR #620 review). The same holds for a subtype fact
   with `providesIdentification` imported from an annotation
   (requirement 4a).
   **Matching** (PR #620 review). A name's head noun is its last
   `_`-separated word after removing quoting, compared without regard
   to case. The child's head noun matches the parent's when the two are
   equal or differ by exactly one of these endings and no others, the
   ones reference-inference.spec.md uses: `ies` and `y`, `es` and
   nothing, `s` and nothing -- so `ENROLLED_SUBJECTS` matches
   `SUBJECT`, `enrolled_subject` matches `SUBJECT`, and an irregular
   plural matches only itself. A child column repeats a parent column
   when their names are equal without regard to case; the key column,
   which both tables share by definition, is not counted. The number
   rule is reference-inference.spec.md's, and the two must give the
   same answer for the same names, so they share one function in
   `packages/formats/src/ddl/` (CLAUDE.md: a must-agree copy is shared,
   never restated): whichever spec lands first creates it, with its own
   tests, and the second imports it (PR #620 review).
2. When it does, the importer shall add a warning naming the table, the
   supertype and both conditions. When the key column carries
   shared-key foreign keys to two or more tables that each meet both
   conditions, the importer shall import none of them as a supertype,
   read the table as requirement 3 does, and warn naming every
   candidate: which parent to choose is not the DDL's to say, and
   taking the first would make the model depend on constraint order
   (PR #620 review).
3. When a table with a shared-key foreign key does not meet both
   naming and column conditions, or its key column's foreign key is not
   a shared-key foreign key, the importer shall
   read it exactly as before this spec (for a shared-key foreign key:
   the key imported, the reference not, and the existing warning).
4. The DDL export shall write a `supertypes` list on every table
   annotation it writes -- empty for an entity that is no subtype, so
   that absence means only "written before this spec" (PR #620 review).
   Each entry is one subtype fact: the supertype entity, the columns
   that reference its table (a list, since a supertype keyed on several
   columns is referenced through all of them), and the subtype fact's
   fields as core stores them -- `providesIdentification`,
   `isExclusive`, `isExhaustive`, `definingRule` (`SubtypeFact.ts`).
   An entity may have several entries, one per supertype.
   4a. When a table's annotation carries `supertypes`, the importer shall
   import each entry's subtype fact with the stored fields, never
   re-deriving them: `providesIdentification` in particular cannot be
   read off the columns, because the relational mapper writes an
   identifying subtype fact as a non-key foreign key when an
   objectification identifies the same entity
   (`RelationalMapper.ts`, the objectification-precedence branch; PR
   #620 review). The entry's columns locate the link and are checked
   against the DDL: they must be a declared foreign key, in full, to the
   table of the named supertype. An entry that fails the check is
   dropped with a warning naming it -- that entry alone; the others
   are read as usual (PR #620 review) -- since an annotation is used
   only while it describes the DDL (ddl-round-trip-fixed-point.spec.md).
   Columns of an entry that passes are the subtype link, not a
   relationship. Requirements 1-3 do not apply to a table whose
   annotation carries `supertypes`, with one exception: when the list
   was non-empty and every entry was dropped, the annotation no longer
   says anything about the table's parents, and requirements 1-3 apply
   as to an unannotated table. An empty list as written says barwise
   wrote the table and it is no subtype, so the naming rule must not
   invent one.
   4b. When a table's annotation has no `supertypes` (an export from
   before this spec), requirements 1-3 apply to it as to an
   unannotated table.
5. Round trips (PR #620 review: the first wording asked an unannotated
   export to keep what only the annotation can carry):
   - A subtype imported by requirement 4a, exported with annotations and
     imported again, shall give the same subtype facts. Without
     annotations nothing promises it survives: the names of
     `employee` and `person` say nothing of a subtype, which is the
     loss requirement 4 exists to prevent.
   - A subtype imported by requirement 1, exported with or without
     annotations and imported again, shall give the same subtype facts,
     and shall re-export as one column that is both key and foreign
     key. Without annotations this holds because the import named both
     entities after the tables whose names met the rule, and the export
     names the tables after the entities.

## The one-to-one reading is a follow-up (resolved: deferred)

Reading the other tables as a one-to-one relationship is three changes,
not one. The mapper exports one column as both key and foreign key only
for a subtype (ddl-import-fidelity.spec.md, out of scope); and the
identification model it reads cannot express an entity identified
through another entity: `preferredIdentifyingBinary` accepts only an
entity-to-value binary, `identificationSources` would credit a preferred
fact to both entity players, and `identificationGraph` has no edge for
the dependency (`packages/core/src/model/identification.ts`; PR #620
review). That is a metamodel change with its own cycle handling and
diagnostics, so it is filed as its own issue (barwise-3pc). Until it lands, a table
this rule does not read as a subtype keeps today's behaviour: the key is
imported, the reference is not, and the warning says so.

## Scope

In scope: matching controls for a plural child of a singular parent
(`ENROLLED_SUBJECTS` to `SUBJECT`, caught), a case difference
(`enrolled_subject` to `SUBJECT`, caught) and a non-ending difference
(`SUBJECTIVE` to `SUBJECT`, not caught); `DdlImportFormat`'s handling of a single-column key that is
also a foreign key; tests for a caught subtype, a coded-name miss, an
extension table, `user_profiles`, the `LEGACY_ORDER` control, the `ARCHIVED_ORDER` control, and a same-noun child that repeats exactly one of a multi-column parent's non-key columns, which must keep today's reading (PR #620 review: it separates "no repeated column" from "not every column repeated"); two
exclusion tests for requirement 1's shared-key definition, each with a
same-noun name that would otherwise qualify -- a composite foreign key
`(tenant_id, order_id)` that contains the single key column, and a
one-column foreign key to the parent's alternate UNIQUE column rather
than its primary key -- both keeping today's reading; and a
round-trip test that a caught subtype re-exports unchanged; the
`supertypes` field in `barwiseAnnotation.ts` (writer and reader) and
`DdlExportFormat`, with round-trip tests, annotated and not, over an
identifying and a non-identifying subtype -- `employee-hierarchy`
carries both -- a subtype whose supertype has a two-column key, an
entity with two supertypes, a subtype fact with `isExclusive`,
`isExhaustive` and a `definingRule` set, and an assertion on each imported subtype that the model reports no
conflicting-identification diagnostic, a mixed control (the key column carries one qualifying shared-key
foreign key and one other foreign key; today's reading), a two-parent
control for requirement 2 (both parents qualify, neither
imported), an annotation whose columns no longer form the foreign key
(dropped with a warning, the table read by requirements 1-3), an
annotation with one valid and one stale entry (the stale one dropped,
the valid one imported, requirements 1-3 not applied), an
objectified entity whose identifying subtype fact is exported as a
non-key foreign key (re-imported with `providesIdentification` true),
an empty `supertypes` on a same-noun vertical partition (no subtype
invented), and a test that an annotation's `supertypes` wins over
a table name that fails the naming rule. The trial
generator writing the extension tables' `FOREIGN KEY` over the parent's
complete key -- today it copies only the first key column, so C01's
two-column Admission key would not be a shared-key reference, and the
manifest records the same partial key (PR #620 review); the generator
and the manifest both copy every key column -- (`trial/lib/generators/ddl.mjs`), with a
generator test that each extension table's DDL carries it -- without
it the extension-table rows above are unmeasured; then a trial run, the
extension tables' result recorded in this spec's implementation notes,
and the rows it moves (C10 ir-analyst; the C09 biostatistician subtype
check; any C01 row the newly visible references change).

## Workstreams

1. **The naming rule** (formats): requirements 1-3 and the shared
   number-matching function, if reference-inference has not landed it;
   their tests. Independent of the others.
2. **The annotation** (formats): requirements 4, 4a, 4b and 5 -- the
   `supertypes` field in `barwiseAnnotation.ts`, its writer in the
   export and reader in the import, and the round-trip tests. Shippable
   alone; it fixes barwise's own export whatever happens to the naming
   rule. Lands with or after 1 only in that requirement 4a's fallback
   names requirements 1-3.
3. **The generator and the trial** (trial): the extension tables'
   `FOREIGN KEY`, its generator test, the trial run and the
   reclassification. After 1, since the rows it moves are the naming
   rule's.

Out of scope: the one-to-one reading (above, barwise-3pc); a composite key
that is also a set of foreign keys (composite-key-tables.spec.md); the
dbt importer, whose relationships test has no key-is-reference form.
