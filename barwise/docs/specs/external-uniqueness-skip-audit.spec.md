# External-uniqueness skip is sound, and arity is not the limit

Status: Draft for review
Tracking: `model-feature-review.spec.md` workstream 2; seed finding 2

## Principle

External-uniqueness validation must never emit a false positive, and it
follows explicit-over-implicit by checking only when it can actually form
the combination tuple -- skipping when the join key is ambiguous. This
audit confirms the skip is sound and corrects an inaccuracy in how the
feature's reach was described.

## Findings

- **The skip is silent and sound.** `inferExternalUniquenessJoin` returns
  `undefined` on any structural ambiguity, and `checkExternalUniqueness`
  `continue`s with no diagnostic, so a skipped constraint never produces
  a false positive. The skip cases are exhaustive (see taxonomy).
- **Arity is not the limit.** An n-ary external uniqueness -- one
  constrained role per fact type, joined on a single common object that
  plays exactly one non-constrained role in each -- validates correctly.
  Confirmed by experiment with three fact types (Room by Building +
  RoomNumber + Floor): a shared three-part combination is flagged, a
  distinct one is not. The "binary-fact-type pattern" framing in
  `external-uniqueness.spec.md`, and this review plan's seed finding that
  the validator skips "n-ary/ambiguous joins", is inaccurate: the
  boundary is structural ambiguity, not the number of fact types.
- **Coverage gap.** The n-ary handled case and the "no single common
  object" skip are untested; only the same-fact-type skip is.

## Skip taxonomy (each sound)

`inferExternalUniquenessJoin` skips, returning `undefined`, when:

- fewer than two constrained roles are given;
- a constrained role is not found in any fact type;
- two constrained roles live in the same fact type (no cross-fact-type
  join to form);
- there is not exactly one common object type across all constrained fact
  types (zero, or an ambiguous several).

In every case the combination cannot be formed unambiguously, so skipping
is the sound choice.

## Scope

In scope: tests locking the n-ary handled case and the "no single common
object" skip; this spec records the corrected characterization.

Out of scope: any production code change (the validator is sound);
supporting genuinely ambiguous joins (a common object that plays several
non-constrained roles, or several candidate common objects) -- deferred,
because the skip is correct and such shapes are rare.

## Workstream

Single, self-contained test addition to
`externalUniquenessPopulation.test.ts`: n-ary violate and satisfy, plus a
"no common object" skip. No production code change.

## Open decisions (for review)

- **Support genuinely ambiguous joins later?** Recommend no, beyond a
  low-priority deferred note: the skip is sound, and no real model in the
  examples needs it. Revisit only if one appears.

## Risks and testing

- Test-only; no behavior changes. The new cases lock the reach (n-ary
  works) and one more skip boundary so a regression in the inference is
  caught.

## Non-goals

- No change to the inference or the validator.
- No new support for ambiguous-join shapes.
