# Population correspondence sees through objectification

Status: Accepted (implemented with this spec; see Implementation notes)
Created: 2026-08-27
Last-updated: 2026-08-27
Tracking: barwise-881 (finding F6 of
`docs/reference-rubric-audit-2026-08-27.md`). Unblocks the settled
university-enrollment grade check the audit had to leave unguarded.

## Principle

The gym's founding rule -- grade by semantics, never by diffing a
reference, because a domain has many valid ORM models -- currently
stops exactly where ORM's own equivalence begins. Objectification IS
the equivalence: "Student receives LetterGrade for CourseOffering" as
a ternary, and an objectified Enrollment carrying the grade, express
the same settled rule ("at most one grade per student-offering"), and
ORM 2 treats the nesting as the same conceptual content. But
`forbids_population` corresponds fact types by flat player multiset,
so the objectified shape corresponds to nothing, the check fails a
correct model, and the audit had to leave the settled rule unguarded
-- the rubric could only pin the reference's shape.

The fix follows the licence precedent (eval-name-licensing): widen the
correspondence with an append-only tier. Exact multiset correspondence
still wins; expansion only ever rescues a comparison that would
otherwise have failed.

## Can the objectifying instance be identified? (resolved: it does not need to be)

Finding F6 called this the identity gap: a candidate's `Enrollment has
LetterGrade` population identifies enrollments by their own values, and
nothing recovers "which (Student, CourseOffering) pair is e1". For
_witnessing existence_ that gap is real (the mandatory half stays with
`docs/specs/mandatory-existence-witness.spec.md`'s out-of-scope). For
_mapping a forbidden population_ it dissolves, because the mapper
controls both sides: it MINTS the candidate instances. The reference
counterexample for the grade uniqueness is two instances sharing a
(Student, CourseOffering) pair with two grades; mapped onto the
objectified candidate, the pair folds into ONE deterministic synthetic
Enrollment value (the absorbed reference values joined in role order),
so equal pairs yield equal enrollment values, and the candidate's own
uniqueness on the Enrollment role rejects the two-grade population.
No real instance identity is consulted; the synthetic value only has
to be equal when the folded tuple is equal, which a pure join gives.

## Scope

In scope:

- When flat player-multiset correspondence finds no candidate fact
  type, the system shall retry with objectifying players expanded: a
  candidate role player that objectifies a fact type contributes that
  fact type's player names (one level, resolved through the same
  vocabulary and licence machinery as any player name).
- When a correspondence used expansion, the system shall map each
  absorbed group of reference roles onto the single objectifying
  candidate role by joining their values in reference role order into
  one deterministic synthetic value.
- When the university-enrollment case declares the settled grade check
  (`Student receives LetterGrade for CourseOffering`,
  internal_uniqueness), the recorded ternary answer key and an
  objectified-Enrollment candidate carrying the rule shall both pass,
  and an objectified candidate missing the rule shall fail. Suite
  bumps to 2.4.0.

Out of scope, deferred and named:

- **The reverse direction** (reference objectified, candidate flat):
  mapping a reference Review value onto a flat ternary needs the
  opposite move -- unfolding one value into several synthetic ones --
  and only rejects against a spanning uniqueness. No committed case
  needs it (conference-reviews' recorded fork is the associative-entity
  chain, which the suite punishes deliberately, not a flat ternary).
  The unfold sketch stays here for whoever hits the case.
- **Nested objectification** (an objectifying player inside an
  objectified fact type): expansion is one level, guarded; a second
  level waits for a model that has one.
- **Existence witnessing through objectification** -- the mandatory
  half of F6's family, still with barwise-881's sibling design as
  recorded in `mandatory-existence-witness.spec.md`.

## Inventory

| Module                                            | Current state                                        | Verdict                                 |
| ------------------------------------------------- | ---------------------------------------------------- | --------------------------------------- |
| `learn/src/evaluate/populationMapping.ts`         | Flat player-multiset correspondence, licence-aware   | widen: expansion tier + folded role map |
| `learn/src/evaluate/checks/forbidsPopulation.ts`  | Passes reference/candidate/licence to the mapper     | untouched: same call, wider answer      |
| `core` (`ObjectifiedFactType`, model accessors)   | `objectifiedFactTypes`, `getObjectType`, all present | untouched: consumed, not changed        |
| `promptlab/evals/university-enrollment.eval.yaml` | Grade rule unguarded (audit F6)                      | add the check; suite 2.4.0              |
| `promptlab` scorer and runner                     | Consume `evaluateCandidate`                          | untouched: inherit the widening         |

## Alternatives considered

- **Expand on both sides to a shared normal form.** Symmetric and
  elegant, but the reverse direction's mapping (unfold) has different
  failure semantics and no driving case; implementing it untested
  invents behavior. The expansion helper is written to be reusable
  when that case arrives.
- **Ask case authors to declare shape alternatives per check.** The
  per-check-alternatives shape the licence spec already rejected, one
  level up: it cannot reach `forbids_population`'s internals and
  restates ORM's own equivalence as authored data.

## Risks and testing

- Append-only pinned: a candidate carrying the flat ternary still
  corresponds exactly as before (the seven answer keys are the
  regression suite for this, re-gated offline at 1.000).
- Learn tests pin the three-way acceptance triangle: ternary candidate
  passes, objectified candidate with the enrollment-role uniqueness
  passes, objectified candidate without it fails.
- The synthetic fold is deterministic: same reference population, same
  minted values, byte-identical mapped population.
- Full monorepo suite after the change (learn's API is unchanged in
  shape; promptlab and the gym inherit behavior).

## Non-goals

- No change to `requires_element`, verbalization checks, or scoring
  arithmetic; no new check kind.
- No fuzzy or structural diff correspondence; expansion is driven only
  by declared `ObjectifiedFactType` links, the same
  declared-never-inferred rule the licence set.

## Implementation notes

Shipped as specified, one commit. The expansion tier lives entirely in
`populationMapping.ts`: `expandedCorrespondence` classifies candidate
roles as plain or objectifying, compares the expanded multiset, then
consumes reference roles greedily in declared order -- the same
position-disambiguates-repeats semantics as the flat tier's group-zip.
The fold joins absorbed values with a visible separator (" & ") in
reference role order, so the synthetic value is a pure function of the
reference instance alone; only equality matters, and the seam reads as
a seam in any rendered report. `forbidsPopulation` needed no change:
same call, wider answer, which is what the Inventory predicted and the
first offline gate confirmed (all seven answer keys at 1.000, the
university-enrollment rubric now 9/9). The three-way acceptance
triangle and the flat-tier regression pin are
`learn/tests/objectifiedCorrespondence.test.ts`.
