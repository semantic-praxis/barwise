# Guard the anchors query's deterministic ordering

Status: Draft for review
Tracking: `model-feature-review.spec.md` workstream 4

## Principle

Determinism in core: the `anchors` query sorts its multi-entity output
by name (`evaluate.ts`, `localeCompare`) so the same model always yields
the same order. The audit found this holds and that `buildReasoningTrail`
is a pure function of its input, but the sort itself is unguarded -- the
eight existing anchor tests are all single-entity, so a regression in the
ordering would pass CI.

## Findings

- **Anchors and the reasoning trail are deterministic.** No clock,
  randomness, or uuid in `query/` or `ReasoningTrail.ts`; anchors sort by
  name and mandatory roles by `[...set].sort()`; the trail's sidecar-vs-
  fallback path is already tested. No code change is warranted.
- **The multi-entity ordering is untested.** The one place anchors
  imposes an order that a regression could silently break has no test.

## Scope

In scope: one test asserting `anchors` returns multiple entities sorted
by name regardless of creation order.

Out of scope: any production change (the query is correct); a broader
determinism sweep of other query commands (their order follows model
order and carries no extra guarantee to lock).

## Workstream

Single test added to `anchors.test.ts`: build a model whose entity types
are created out of alphabetical order, run the bare `anchors` query, and
assert the returned names are sorted ascending.

## Risks and testing

- Test-only; locks the stated ordering guarantee so a future change to
  the sort fails loudly.

## Non-goals

- No change to the query, the trail, or the resource.
