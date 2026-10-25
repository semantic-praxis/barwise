# A mandatory role on a non-binary fact type names every player

Status: Draft

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-ygy
Touches: barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/src/verbalization/constraints/phase1.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
barwise/packages/core/tests/verbalization/ConstraintVerbalizer.test.ts,
+barwise/packages/core/tests/verbalization/naryMandatory.test.ts,
barwise/packages/cli/tests/characterization/golden/clinic-appointments.verbalize.txt

The mandatory sentence for a unary, ternary or wider fact type shall read
as FORML: "Each Appointment is for some Patient with some Doctor on some
AppointmentDate at some TimeSlot." when a reading starts with the
constrained role, and "For each Agreement, some Party on behalf of some
Party signs that Agreement." when none does. Today it writes the
constrained role's player into every slot: "Each Appointment must:
Appointment is for Appointment with Appointment on Appointment at
Appointment."

## Principle

Composability. The sentence a single-role mandatory needs is the one
`spanningArm` (phase2.ts) already writes for each arm of a disjunctive
mandatory: a reading that opens with the role, its other players
quantified by "some". A disjunctive mandatory over one role is a plain
mandatory, so the two shall say it the same way, from one renderer. The
second form ("For each X, ... that X") is new and lives beside it, so a
reading that does not open with the role gets a sentence built from the
reading rather than from the role name.

## Observed today (at 52f23edc)

The non-binary branch of `verbalizeMandatory` (phase1.ts) expands the
first reading with the constrained player's name for every placeholder,
and frames it as "Each X must: ...". Over the tracked models
(`docs`, `examples`, `packages/promptlab/evals`), 12 lines in 6 files
take this path, every one of them wrong in the same way:

| File                                                 | Lines |
| ---------------------------------------------------- | ----- |
| `docs/auction.orm.yaml`                              | 5     |
| `examples/auction-project/domains/parties.orm.yaml`  | 3     |
| `examples/auction-project/domains/auctions.orm.yaml` | 1     |
| `examples/auction-project/domains/catalog.orm.yaml`  | 1     |
| `examples/models/learning-design.orm.yaml`           | 1     |
| `examples/transcripts/clinic-appointments.orm.yaml`  | 1     |

Two tests pin the current text: `ConstraintVerbalizer.test.ts` ("Each
Employee must: Employee works on Employee in Employee.") and the CLI
golden `clinic-appointments.verbalize.txt`, line 27.

`spanningArm`'s fallback, used when no reading opens with the role,
prints the role's name as the predicate. The auction models' role names
are NORMA GUIDs (`_5593C6C5-...`), so that fallback is not fit to reuse:
it would print "Each Agreement _5593C6C5-... some Party". The new
"For each" form replaces it for the mandatory sentence only.

## Scope

- When a mandatory constraint names a role of a fact type whose arity is
  not 2, and some reading starts with that role's placeholder (nothing
  before it but whitespace or its hyphen-bound lead), the verbalizer
  shall write "Each " + lead + the role's player + the rest of that
  reading, with every other placeholder written as "some " + its lead +
  its player.
- When no reading starts with that role, the verbalizer shall write
  "For each " + the role's player + ", " + the first reading, with the
  constrained placeholder written as "that " + its lead + its player and
  every other placeholder as "some " + its lead + its player.
- When a placeholder names an index the fact type has no role for, the
  verbalizer shall print the placeholder as written (`{3}`), as
  `spanningArm` does.
- When the fact type has no reading, the verbalizer shall write "Each X
  " + the role's name, the fallback `spanningArm` uses today.
- The binary path, the disjunctive mandatory sentence and every other
  verbalizer keep their output.

Out of scope: `spanningArm`'s role-name fallback for disjunctive
mandatory, exclusion and exclusive-or arms. It has the same GUID problem
on NORMA imports, but changing it changes three sentence kinds and is
filed separately.

## Inventory

| File                      | Change                                                                                                                                                                                                                                                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constraints/sentence.ts` | New `quantifiedReading(parts, roleSeg)`: renders reading parts with a caller-supplied segment list per placeholder, applying the flush-placeholder spacing `spanningArm` does today. New `openingRest(factType, index)`: the parts after a reading's opening placeholder, and that placeholder's lead, or undefined. |
| `constraints/phase2.ts`   | `spanningArm` uses both; its output is unchanged.                                                                                                                                                                                                                                                                    |
| `constraints/phase1.ts`   | The non-binary branch of `verbalizeMandatory` writes the two forms above.                                                                                                                                                                                                                                            |
| Tests                     | `naryMandatory.test.ts` (both forms, lead, unknown index, unary, no reading); the existing pin and the CLI golden updated to the new text.                                                                                                                                                                           |

## Workstreams

### 1. The two forms

One PR. Acceptance: the 12 tracked lines change and nothing else in a
whole-corpus verbalize diff does; no output line repeats the constrained
player where the reading names another role; the disjunctive mandatory
tests pass unchanged, which is the evidence the extraction kept
`spanningArm`'s output.

## Open decisions

1. **The frame for a reading that does not open with the role.**
   (a) "For each X, some Y ... that X." (recommended): FORML, built from
   the modeller's reading, and the frame barwise already uses for
   multi-role uniqueness and join constraints ("For each ..."). (b) Keep
   "Each X must: ..." with the other slots named correctly: smallest
   diff, but "must:" with a colon is not FORML and reads as a template.
   (c) The role name as predicate, as `spanningArm` does: unreadable on
   NORMA imports. Recommend (a).
2. **A player that plays two roles in the fact type.** One tracked line
   has one: "Each LearningModule advances some ProficiencyLevel to some
   ProficiencyLevel". With both occurrences quantified by "some" the
   sentence is unambiguous. The case that is not is the "For each" form
   when the constrained player also plays another role: "For each
   Person, some Person introduces that Person to some Person" says which
   one is constrained ("that"), but a reader has to count. Halpin
   subscripts (Person1, Person2), as the ring sentences here do.
   Recommend leaving it: no tracked model reaches that case, and
   subscripting is a change to every n-ary sentence, not to this one.

## Risks and testing

Measured on a prototype of the change: over every tracked model, the
verbalize output differs in exactly the 12 lines above and nowhere else.
Four of the six distinct sentences take the "For each" form, because the
reading opens with another role ("{0} on behalf of {1} signs {2}" for
"Customer on behalf of Organization signs Agreement"); two open with the
constrained role.

The extraction from `spanningArm` is the regression risk: the
disjunctive mandatory, exclusion and exclusive-or tests, and the
whole-corpus verbalize diff showing only the 12 lines, are the check.
