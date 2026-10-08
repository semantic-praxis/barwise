# A primary key that is also a foreign key imports its reference

Status: Draft -- no workstream implemented
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-1078

In one sentence: an unannotated table whose single-column key also
references another table imports as a subtype of that table when its
name ends in the referenced table's head noun, and otherwise as a
one-to-one fact type with it; either way the reference is no longer
dropped, and each reading is reported.

## Principle

**Explicit over implicit, and an importer that drops what it read is
not being explicit.** Today `DdlImportFormat` keeps the key, drops the
reference and warns (barwise-1078). The DDL states the reference
plainly; what it does not state is whether the dependent table is a
kind of its parent (a subtype) or more columns of it (a one-to-one
extension). Both have exactly the same shape, so this spec is about what
to do with a fact the schema does not give.

## What the shape means in the trial (measured 2026-10-08)

| Table (customer)                                  | References         | Kernel                               | Last name word, theirs / parent's | Head-noun rule    |
| ------------------------------------------------- | ------------------ | ------------------------------------ | --------------------------------- | ----------------- |
| `GRADUATE_SGBSTDN` (C10)                          | `SGBSTDN`          | subtype of Student                   | SGBSTDN / SGBSTDN                 | subtype, right    |
| `SCREEN_FAILED_SUBJECT`, `ENROLLED_SUBJECT` (C09) | `SUBJECT`          | subtypes of Subject                  | SUBJECT / SUBJECT                 | subtype, right    |
| `RANDOMIZED_SUBJECT` (C09)                        | `ENROLLED_SUBJECT` | subtype of EnrolledSubject           | SUBJECT / SUBJECT                 | subtype, right    |
| `SERIOUS_ADVERSE_EVENT` (C09)                     | `ADVERSE_EVENT`    | subtype of AdverseEvent              | EVENT / EVENT                     | subtype, right    |
| `IN_PAT_ENC`, `OUT_PAT_ENC`, `ED_ENC` (C01)       | `ENC`              | subtypes of Encounter                | ENC / ENC                         | subtype, right    |
| `TRAUMA_ENC` (C01)                                | `ED_ENC`           | subtype of EmergencyEncounter        | ENC / ENC                         | subtype, right    |
| `MED_ORDER`, `LAB_ORDER` (C01)                    | `ORDER`            | subtypes of Order                    | ORDER / ORDER                     | subtype, right    |
| `SGBSTDN`, `PEBEMPL` (C10)                        | `SPRIDEN`          | Student, Employee subtypes of Person | SGBSTDN, PEBEMPL / SPRIDEN        | one-to-one, miss  |
| `SIBINST` (C10)                                   | `PEBEMPL`          | Faculty subtype of Employee          | SIBINST / PEBEMPL                 | one-to-one, miss  |
| `PAT_2`, `PAT_3` (C01 extension tables)           | `PAT`              | the same entity, more columns        | 2, 3 / PAT                        | one-to-one, right |
| `user_profiles` (barwise-1078's own example)      | `users`            | a one-to-one extension               | PROFILES / USERS                  | one-to-one, right |

The head-noun rule (subtype when the last word of the table's name
equals the last word of the referenced table's, singular and plural
alike) is right on 14 of 17 tables. Its false-positive rate is **not
measured**: every same-head-noun table in this sample is a subtype, so
the sample has no case on which the rule could be wrong that way (PR
#620 review). The realistic risk is a prefix-qualified copy of a table -- `LEGACY_ORDER`, `ARCHIVED_ORDER` keyed on `ORDER`'s key -- which
the rule would call a subtype. The tests carry such a control, and
each inferred subtype is reported so a wrong one is seen. Its three misses are C10's vendor dictionary codes, where no
name carries the noun; it reads them as one-to-one, which is still true
of the data, just less specific. barwise's own DDL export writes this
shape only for subtypes, with an annotation, which is read first and is
unaffected.

## Options

| Option                                       | C09/C10/C01 subtype checks                            | Extension tables                     | Cost                                        |
| -------------------------------------------- | ----------------------------------------------------- | ------------------------------------ | ------------------------------------------- |
| A. always a subtype                          | pass                                                  | wrong: `PAT_2` becomes a kind of PAT | simplest; asserts "is a" the DDL never said |
| B. always a one-to-one fact type             | fail (declare not_expressible: DDL cannot say "is a") | right                                | honest; no inference at all                 |
| C. head-noun rule, B otherwise (recommended) | pass except C10's three coded tables                  | right                                | a naming heuristic, reported per table      |

Recommended: **C**, with every inferred subtype named in a warning
("imported as a subtype of ENC because its name ends in ENC's head
noun"), and every one-to-one reading names the table it could also be a
subtype of, so the inference is visible and reversible by hand. B is the
fallback if review judges any naming inference out of bounds; then the
subtype checks are declared not_expressible for ddl with the reason
that a subtype and a one-to-one extension have one relational shape.

## The one-to-one branch needs the mapper too (resolved: a core workstream)

Importing the one-to-one reading is not enough on its own:
`RelationalMapper` exports one column as both key and foreign key only
for a subtype, so an entity identified through a one-to-one relationship
re-exports a second foreign-key column the source never had
(ddl-import-fidelity.spec.md, out-of-scope section; PR #620 review).
Workstream 1 teaches the mapper that shape: an entity whose preferred
identifier is the single role it plays in a one-to-one, mandatory
binary with another entity is keyed on one column that is also the
foreign key. The subtype branch already round-trips.

## Scope

In scope: the mapper change above (core), with a round-trip test that
`user_profiles` exports with one `user_id` column; `DdlImportFormat`'s
handling of a single-column key that is also a foreign key, its tests
(one per table row above, plus the `LEGACY_ORDER` control), and the trial
rows it moves (C10 ir-analyst; the C09 biostatistician subtype check;
any check on C10's Student, Employee or Faculty subtypes is examined
and, if it fails only because the code names nothing, reported as such).

Out of scope: a composite key that is also a set of foreign keys (that
is composite-key-tables.spec.md); the dbt importer, whose relationships
test has no key-is-reference form.
