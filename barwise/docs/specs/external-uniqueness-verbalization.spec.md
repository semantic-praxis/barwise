# Fix external-uniqueness verbalization for cross-fact-type roles

Status: Draft for review
Tracking: `model-feature-review.spec.md` workstream 3; seed finding 1

## Principle

Verbalization is pure-core and must be correct -- it is the human-facing
reading of a constraint, and a wrong reading erodes trust in every other
output. This is a correctness finding: `verbalizeExternalUniqueness`
resolves the constrained roles against the owner fact type only, but
external uniqueness is cross-fact-type by definition, so the roles in the
other fact types do not resolve and the reading prints a raw role id.

## Problem

`ConstraintVerbalizer.verbalizeExternalUniqueness` resolves each
constrained role with `factType.getRoleById(roleIds[i])`
(`ConstraintVerbalizer.ts:375`), which searches only the owner fact
type's roles. An external uniqueness identifies an object by a
combination of roles that live in _different_ fact types (a Room by its
Building and its RoomNumber), so every role not owned by the constraint's
fact type returns `undefined` and the code falls back to the raw role id.

Observed on the Room fixture:

```
The combination of Building and r-roomnumber-numbers is unique across fact types.
```

`Building` resolves (it is in the owner fact type "Room is in Building");
`RoomNumber` prints as `r-roomnumber-numbers`, its raw id.

## Why only this verbalizer (scope check)

The sibling resolver `resolveCommonPlayer` (used by the disjunctive-
mandatory, exclusion, and exclusive-or verbalizations) also reads against
the owner fact type, but it is unaffected: those constraints share a
single _common_ player across their roles, and the constraint's own fact
type always owns at least one of those roles, so resolving through that
one role yields the right player. External uniqueness is the only
constraint whose roles name _distinct_ players in distinct fact types, so
it is the only verbalizer that must resolve each role model-wide.

## Scope

In scope: resolve the constrained roles model-wide in
`verbalizeExternalUniqueness`, and a regression test that verbalizes a
cross-fact-type external uniqueness and asserts both player names appear
(no raw role id).

Out of scope: `resolveCommonPlayer` (correct, per the scope check); the
external-uniqueness validation and counterexample (already resolve
model-wide); broader-shape external uniqueness (a separate deferred
enhancement per the review plan).

## Fix

Add a model-wide role lookup -- try the owner fact type first, then scan
`model.factTypes` -- and use it in `verbalizeExternalUniqueness` in place
of `factType.getRoleById`. The lookup is the verbalizer's local mirror of
what `inferExternalUniquenessJoin` already does; core ships no shared
"find role by id across the model" helper, and adding one is a wider
change than this fix warrants (a candidate for the metamodel workstream).

## Workstream

Single, self-contained: the helper, the one call site, and the
regression test in `ConstraintVerbalizer.test.ts`. No public API change;
no downstream package is affected.

## Open decisions (for review)

- **Promote the role lookup to a shared `OrmModel` method?** Three sites
  now do the same model-wide role scan (the join inference, the
  counterexample generator, this verbalizer). Recommend not in this fix --
  file it as a metamodel-workstream finding (a small DRY consolidation),
  so this stays a contained correctness fix.

## Risks and testing

- Verbalization is deterministic and pure; the fix adds a read-only scan,
  no I/O or ordering change. Existing readings for same-fact-type cases
  are unchanged (the owner fact type is tried first).
- A new `ConstraintVerbalizer.test.ts` case builds Room-by-Building-and-
  RoomNumber and asserts the reading names both `Building` and
  `RoomNumber` and contains no `r-` raw id. Keeps verbalization coverage
  above its 90% target.

## Non-goals

- No change to validation, counterexamples, or serialization.
- No broadening of external-uniqueness support beyond the binary pattern.
