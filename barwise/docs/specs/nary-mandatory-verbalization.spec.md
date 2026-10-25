# A mandatory role on a non-binary fact type names every player

Status: Implemented -- WS1

Created: 2026-10-25
Last-updated: 2026-10-25
Tracking: barwise-ygy
Plan-reviewed: 97bab914 (code-review, pr-review)
Touches: barwise/packages/core/src/verbalization/constraints/sentence.ts,
barwise/packages/core/src/verbalization/constraints/phase1.ts,
barwise/packages/core/src/verbalization/constraints/phase2.ts,
barwise/packages/core/tests/verbalization/ConstraintVerbalizer.test.ts,
+barwise/packages/core/tests/verbalization/naryMandatory.test.ts,
barwise/packages/cli/tests/characterization/golden/clinic-appointments.verbalize.txt,
barwise/correction-baseline.json

The mandatory sentence for a unary, ternary or wider fact type shall read
as FORML: "Each Appointment is for some Patient with some Doctor on some
AppointmentDate at some TimeSlot." when a reading starts with the
constrained role, and "For each Agreement, some Customer on behalf of
some Organization signs that Agreement." when none does. Today it writes the
constrained role's player into every slot: "Each Appointment must:
Appointment is for Appointment with Appointment on Appointment at
Appointment."

## Principle

Composability. When a reading opens with the constrained role, the
sentence a single-role mandatory needs is the one `spanningArm`
(phase2.ts) already writes for each arm of a disjunctive mandatory: the
rest of that reading, its other players quantified by "some". The two
shall find that reading and render it with one pair of helpers, so they
cannot drift. They still differ in two places, both deliberate. The
mandatory sentence prints the opening placeholder's hyphen-bound lead
before its subject ("Each sale Listing ..."), where a disjunctive
mandatory prints one shared subject for several arms and so omits each
arm's lead. And when no reading opens with the role, the mandatory
sentence takes a new form built from the reading ("For each X, ... that
X"), where `spanningArm` keeps its role-name fallback (see Out of scope).

## Observed today (at 52f23edc)

The non-binary branch of `verbalizeMandatory` (phase1.ts) expands the
first reading with the constrained player's name for every placeholder,
and frames it as "Each X must: ...". Over every tracked `.orm.yaml`, 17
lines in 11 files take this path, every one of them wrong in the same
way:

| File                                                 | Lines |
| ---------------------------------------------------- | ----- |
| `docs/auction.orm.yaml`                              | 5     |
| `examples/auction-project/domains/parties.orm.yaml`  | 3     |
| `examples/auction-project/domains/auctions.orm.yaml` | 1     |
| `examples/auction-project/domains/catalog.orm.yaml`  | 1     |
| `examples/models/learning-design.orm.yaml`           | 1     |
| `examples/transcripts/clinic-appointments.orm.yaml`  | 1     |
| `trial/customers/C02-bank/kernel.orm.yaml`           | 1     |
| `trial/customers/C05-manufacturer/kernel.orm.yaml`   | 1     |
| `trial/customers/C06-logistics/kernel.orm.yaml`      | 1     |
| `trial/findings/barwise-nqd/base.orm.yaml`           | 1     |
| `trial/findings/barwise-nqd/incoming.orm.yaml`       | 1     |

Two tests pin the current text: `ConstraintVerbalizer.test.ts` ("Each
Employee must: Employee works on Employee in Employee.") and the CLI
golden `clinic-appointments.verbalize.txt`, line 27.

`spanningArm`'s fallback, used when no reading opens with the role,
prints the role's name as the predicate, then "some Y" for each other
role. The auction models' role names are NORMA GUIDs (`_5593C6C5-...`,
barwise-981), so that fallback is not fit to reuse: it would print "Each
Agreement _5593C6C5-... some Customer some Organization". The new "For
each" form replaces it for the mandatory sentence only.

Two cases need no handling, because the `FactType` constructor rules
them out: a fact type with no reading (it throws "must have at least one
reading", and `readings` has no remover), and a placeholder with no
role (`validateReadingTemplate` rejects an index at or beyond the role
count). The new code relies on both rather than carrying branches no
model can reach.

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
- The binary path, the disjunctive mandatory sentence and every other
  verbalizer keep their output.

Out of scope: `spanningArm`'s role-name fallback for disjunctive
mandatory, exclusion and exclusive-or arms. It has the same GUID problem
on NORMA imports, but changing it changes three sentence kinds, and its
root cause is the importer writing role ids as role names, tracked as
barwise-981. Fixing that at the importer would also make the role-name
fallback readable; the "For each" form here is better FORML either way.

## Inventory

| File                      | Change                                                                                                                                                                                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constraints/sentence.ts` | New `quantifiedReading(parts, roleSeg)`: renders reading parts with a caller-supplied segment list per placeholder, applying the flush-placeholder spacing `spanningArm` does today. New `openingReading(factType, index)`: the parts after a reading's opening placeholder, and that placeholder's lead, or undefined. |
| `constraints/phase2.ts`   | `spanningArm` uses both; its output is unchanged.                                                                                                                                                                                                                                                                       |
| `constraints/phase1.ts`   | The non-binary branch of `verbalizeMandatory` writes the two forms above.                                                                                                                                                                                                                                               |
| Tests                     | `naryMandatory.test.ts` (both forms, a lead on the constrained and on another role, a unary, a flush placeholder); the existing pin and the CLI golden updated to the new text.                                                                                                                                         |

## Workstreams

### 1. The two forms

One PR. Acceptance: a verbalize diff over every tracked `.orm.yaml`
changes exactly the 17 lines above and nothing else; in each changed
line every placeholder names its own role's player; the disjunctive
mandatory, exclusion and exclusive-or tests pass unchanged, which is the
evidence the extraction kept `spanningArm`'s output.

## Implementation notes

/code-review of the implementation found four inputs the plan did not
name, all in the shared renderer, so the fixes reach `spanningArm` too:

- A reading that opens with the role and names it again later ("{0}
  signs {2} for {0}") wrote the later slot as "some Customer", a
  different claim. The renderer now writes every occurrence of the
  sentence's own role as "that X", in both forms.
- Whitespace at the end of a reading printed before the period ("Each
  Person breathes ."). The renderer trims the reading's last text.
- Two placeholders with nothing between them ran together ("some
  Personsome Topic"), and the flush-placeholder space was added only
  before an ASCII word. The renderer separates adjacent placeholders and
  tests for a word with `[\p{L}\p{N}]`, the parser's own definition.
- The player reference and the "some" segment were written twice, with
  "some" a keyword in one and plain text in the other. Both callers now
  take them from `rolePlayer` and `quantifiedReading` in `sentence.ts`,
  so a disjunctive mandatory, exclusion or exclusive-or arm marks "some"
  as a keyword, as the binary sentences mark "at most one".

So "`spanningArm`'s output is unchanged" holds for every tracked model
(the corpus diff is still the 17 lines) and for the existing tests, but
not for those four kinds of reading, where its text was wrong the same
way. Two findings were left: a reading that already ends in "that" gets
"that that X" in the "For each" form, and a noun written into the
reading before a placeholder stays before the quantifier ("posts some
Amount to Account some GeneralLedgerAccount", C02-bank). Both follow the
modeller's reading as written, and guessing at its grammar would be a
worse failure than repeating it.

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

Measured on a prototype of the change: over every tracked `.orm.yaml`,
the verbalize output differs in exactly the 17 lines above and nowhere
else. They hold 10 distinct sentences. Three take the "For each" form,
because the reading opens with another role ("{0} on behalf of {1} signs
{2}" for "Customer on behalf of Organization signs Agreement"): Agreement,
ConsignmentAsset, BidSubmission. Seven open with the constrained role:
WonItem, Payment, LearningModule, Appointment, Transaction, WorkOrder,
CustomsDeclaration.

The extraction from `spanningArm` is the regression risk: the
disjunctive mandatory, exclusion and exclusive-or tests, and the
whole-corpus verbalize diff showing only the 17 lines, are the check.
