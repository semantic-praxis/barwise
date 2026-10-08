# Acceptance over a skinned DDL artifact grades structure, not the skin's spelling

Status: Implemented -- the one workstream landed with this spec
Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-d60 (decided by the requester on 2026-10-08: "Use
customer naming rules")

In one sentence: a persona's acceptance checks name kernel concepts
("Student", "Person has Pidm"), a customer's DDL skin renames them
(`SGBSTDN`, `SPRIDEN`, `pc_policy`, 8-character identifiers), and the
grader now maps each imported name back through that skin's own naming
rules before the checks run, so 11 acceptance rows measure whether the
import recovered the structure rather than whether it guessed a vendor
dictionary.

## Principle

**A measure needs a stated relation to its outcome.** The acceptance
rows exist to say whether barwise recovers a customer's model from the
customer's schema. Over a skinned artifact they measured something
else: whether the import produced the kernel's spelling of a name the
artifact never contains. No importer can know that `SGBSTDN` is
Student; the skin's dictionary says so, and the skin is the trial's own
input. Grading through it is the shadow brought back to the property.

## Should the mapping invert the rules or run them forward? (resolved: forward)

Inverting is lossy where it matters most: C10 truncates identifiers to
30 characters and C12 to 8, and C10's `SibinstTeachesScbcrseSectio`
cannot be expanded back by any rule. Running the rules forward is exact. The grader applies the
skin's naming to every kernel object type name -- the same function the
generator used to write the table or column -- and compares the result
with the imported names case- and separator-insensitively, which is
exactly what undoes the importer turning a physical name into PascalCase.
After the rename the gym compares names as it always has. `Student` names table
`SGBSTDN`; the import calls it `Sgbstdn`; the two agree.

## Scope

In scope:

- When the trial grades a persona over an import of a DDL artifact that
  has a skin, it shall grade a copy of the imported model in which each
  object type whose name matches the skin's spelling of exactly one
  kernel object type is renamed to that kernel name, keeping the
  imported name as an alias.
- An entity's spelling is the skin's table name for it; a value type's
  is the skin's column name for it. A name two kernel concepts share
  after the rules, or that two imported object types share, is left
  alone.
- The step's detail shall say how many names were mapped, so a reader
  sees the grading was translated.
- The generator's naming (`ident` inside `generateDdl`) becomes one
  exported function, `skinNamer`, used by the generator and the grader:
  the mapping must agree with what the generator wrote, so it is shared
  rather than copied.

Out of scope:

- dbt, OpenAPI, code and NORMA artifacts: their skins do not rename
  concepts the way the DDL skins do.
- Concepts the artifact never names at all, such as an objectified
  fact type the DDL writes as a table named after its fact type: those
  still fail, and should.
- Relationships an artifact never states (C07's BigQuery skin writes no
  foreign keys). No naming rule recovers them; those checks keep failing
  and are reclassified to their own cause.

## Workstreams

### 1. Map names through the skin when grading

`trial/lib/generators/ddl.mjs` exports `skinNamer(skin)`, returning
`{ table(raw), column(raw) }`; `generateDdl` uses it. A new
`trial/lib/skinNames.mjs` builds the rename from a kernel, a skin and an
imported model, and writes the renamed copy. `sprint6Surfaces` grades
that copy for a `ddl` candidate whose artifact has a skin. Tests cover
the abbreviation case (C10), the prefix case (C03), the truncation case
(C12), and an ambiguous name left alone.

Acceptance: over the regenerated small tier, the 11 barwise-d60 rows
either pass or fail only on checks whose cause is not a skin's
spelling, and each is reclassified to that cause.

## Implementation notes

Measured over the regenerated small tier, 2026-10-08.

- **Three of the 11 rows pass**: C10's financial-aid-director, and
  C12's mainframe-dba and hearing-officer. C12's 8-character truncation
  mapped 55 names, so the forward mapping holds where inversion could
  not have. C10's sis-dba passed too, until review found the reason was
  false (below).
- **The other eight fail on structure, and none on a spelling.** That
  was the acceptance criterion, but which structure was not what the
  scope predicted: only C07's row is a relationship the artifact
  never states. Six are defects in the trial's own generator, and one
  is an importer limit that already had an issue:
  - barwise-rlv (C03 policy-admin-dba; C10 ir-analyst,
    registrar-data-steward and sis-dba; C12 modernization-architect and
    policy-analyst). `relationalView` writes an objectified fact type as
    two unlinked tables, and names a self-reference column after its
    player, so a ring table repeats one column. C03's "PolicyNumber and
    Term" uniqueness looked like a format limit, a uniqueness across
    two tables, until the kernel showed PolicyPeriod objectifies the
    fact type with the Term role: written as one table, the rule is an
    ordinary `UNIQUE`. It is classified to the generator, not declared
    `not_expressible`.
  - barwise-2z1 (C05 master-data-lead). "Material is produced at Plant
    in Batch", keyed on its batch alone, imports as an entity.
  - barwise-c5f (C07 network-inventory-architect). The BigQuery skin
    writes no foreign key; whether the import should infer one from a
    key-named column is a new decision.
- **A name the artifact declares twice is never mapped.** Not in the
  scope, and found in review (PR #611). C10's skin adds vendor tables
  named SPRIDEN, SFRSTCR and STVTERM, and its dictionary gives the
  generated Person, Enrollment and Term tables the same names, so the
  file creates each twice. The import keeps the first and drops the
  second, and the grader mapped SPRIDEN to Person: C10's sis-dba passed
  over a schema no database would load. `gradedCandidate` now reads the
  artifact's manifest and leaves those names alone, which is why sis-dba
  is under barwise-rlv; the collision itself is rlv's to fix.
- **The SQL importer's catch-all acceptance class is gone.** It matched
  every non-kernel `-ddl` acceptance step, so it would have taken any
  new row on its cause without anyone looking. Each replacement class
  names its steps, and `oracles.test.mjs` now asserts that an unnamed
  DDL acceptance row stays unclassified for either importer.
