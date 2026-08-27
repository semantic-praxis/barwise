# A subtype instance witnesses its supertype's existence

Status: Accepted (implemented with this spec; see Implementation notes)
Created: 2026-08-27
Last-updated: 2026-08-27
Tracking: barwise-880 (finding F5 of
`docs/reference-rubric-audit-2026-08-27.md`). The objectification half
of that finding is resolved out, below, and stays with the barwise-881
design family.

## Principle

Determinism in the core, applied to a semantic hole the audit fell
into twice. ORM's subtyping is definitional -- "every Employee is also
a Person" -- and a subtype sharing its supertype's identification
scheme names instances in the same value space. The population
machinery ignored this: `buildObjectUniverse` credits an instance only
to the exact `playerId` of the role it appears in, so a Manager
recorded managing a department does not exist as an Employee, and the
validator cannot flag that this Manager works in no department. The
counterexample generator has the mirror-image hole: `findAnchorRole`
looks for a role played by the exact type, so a mandatory on a player
whose only other roles belong to its subtypes is underivable, and the
audit had to withdraw a settled check
(`Employee works in Department` mandatory) because of it.

Both holes are one decision -- what counts as an existence witness --
owned in one place each. Widening the universe fixes mandatory,
disjunctive-mandatory, spanning, and cardinality consistently, because
all four consume `buildObjectUniverse`.

## Does objectification also witness existence? (resolved: not yet -- the identity gap)

Semantically yes: each instance of "Reviewer reviews Paper" IS a
Review. Mechanically no: a population instance of the objectified fact
type carries role values for Reviewer and Paper and nothing that names
the Review (`review_id` appears nowhere in the tuple), so the universe
could assert that _some_ Review exists but never _which_, and both the
mandatory check and its counterexample need the which. Bridging that
needs an instance-level identity for objectified tuples -- the same
design problem as barwise-881's objectification-blind correspondence,
so it stays with that issue rather than being half-solved here.
`Review has ReviewScore` mandatory therefore remains untestable, as
the audit recorded.

## Scope

In scope:

- When a non-sample population instance plays a role, the system shall
  credit the value to the role's player and to every supertype
  reachable through `SubtypeFact` links whose `providesIdentification`
  is true (shared value space; a link with an independent identifier
  breaks the chain).
- When the counterexample generator seeks an anchor role for a
  mandatory constraint, the system shall accept a role played by the
  player or by any identification-sharing descendant of the player,
  preferring an exact-player anchor when one exists.
- When the employee-hierarchy eval case declares the settled
  `Employee works in Department` mandatory check, the recorded answer
  key shall score its full rubric (verified offline; suite bumps to
  2.3.0 per the 2.2.0 precedent).

Out of scope: the objectification witness (above); any change to
sample-population semantics (`sample: true` stays out of the universe
-- positive evidence only); subtype _membership_ inference (whether a
value in an Employee role is also a Manager is not decidable and not
attempted -- witnessing flows up the chain only).

## Inventory

| Module                                               | Current state                           | Verdict                                      |
| ---------------------------------------------------- | --------------------------------------- | -------------------------------------------- |
| `core/src/validation/rules/population/shared.ts`     | Universe keyed by exact playerId        | widen: credit identification-sharing chain   |
| `core/src/counterexample/CounterexampleGenerator.ts` | `findAnchorRole` matches exact playerId | widen: descendants too, exact-first          |
| population `mandatory/cardinality/spanning` rules    | Consume the universe                    | untouched: inherit the widening              |
| `llm/src/ExtractionConformance.ts`                   | Mirrors structural validator rules      | untouched: population rules are not mirrored |
| `promptlab/evals/employee-hierarchy.eval.yaml`       | Check withdrawn by the audit            | restore it; suite 2.3.0                      |
| `promptlab/evals/conference-reviews.eval.yaml`       | Check withdrawn by the audit            | untouched: waits on the objectification gap  |

Extractions are unaffected on scores: extraction populations are
`sample: true`, which the universe skips, so no recorded answer key or
live run gains or loses a diagnostic from the validator widening. The
one score-visible change is the restored rubric check, which is what
the version bump marks.

## Risks and testing

- Core tests pin both directions: a Manager-population value raises a
  mandatory violation on an Employee role, and a subtype link with
  `providesIdentification: false` does not conduct. A cycle guard
  keeps a malformed subtype graph from looping.
- Generator tests pin the descendant anchor and the exact-first
  preference, and that a player with no roles anywhere still yields no
  counterexample.
- The promptlab answer-key gate re-runs offline; `scoreExtraction`
  pins stay byte-identical except the employee-hierarchy rubric total.
- Full monorepo suite (examples validation included) guards models
  with real populations against surprise diagnostics.

## Non-goals

- No conformance change, no new check kind, no correspondence change.
- No objectification identity; barwise-881 owns that design.

## Implementation notes

Shipped as specified, one commit, with one detail the brief did not
name: the ancestry walk is one exported function
(`identificationSharingAncestry` in the population rules' `shared.ts`)
consumed by both the universe and the generator's anchor search -- two
answers to "who does this value witness" would have been the exact
drift the rest of this repo's guards exist to prevent. The generator's
exact-first preference keeps counterexample output byte-identical for
every model the widening does not concern, which the existing
determinism pins confirm. One prediction verified rather than assumed:
the pre-existing generator test "Order has no other fact type to
anchor -> skipped" still holds, because Order has no subtypes either
-- the widening changes nothing for subtype-free models. The restored
employee-hierarchy check passed its answer key offline on the first
run (6/6, score 1.000).
