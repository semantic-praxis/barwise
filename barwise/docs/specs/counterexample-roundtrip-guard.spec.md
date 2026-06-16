# Guard the counterexample round-trip at the model-wide entry point

Status: Draft for review
Tracking: `model-feature-review.spec.md` workstream 1

## Principle

The round-trip is the counterexample's correctness guarantee: a generated
counterexample is the deterministic inverse of population validation, so
feeding its `forbidden` populations back through the validator must trip
the rule it was generated for. The per-constraint tests prove this on
hand-built single-constraint fixtures, but the entry point everything
actually calls -- `generateCounterexamples(model)` -- is tested only for
count and determinism. The invariant it most needs to hold is unguarded
at the level it is used.

## Problem

No test takes a model carrying many constraint types, runs
`generateCounterexamples`, and asserts every result round-trips. A
generator that regressed, or an interaction between constraints in one
model that a single-constraint fixture cannot show, would pass CI. This
is the property `REPO_REVIEW-2026-06.md` T4 recommends, scoped to the one
invariant that matters most here.

## Scope

In scope: one model-wide completeness test in
`CounterexampleGenerator.test.ts` -- build a constraint-rich model, call
`generateCounterexamples`, and assert each returned counterexample trips
its own rule, isolating each by adding its `forbidden` populations,
validating, then removing them.

Out of scope: any production code change (the generators are complete --
all eleven constraint types dispatch and each has a per-type round-trip
test); general property-based/fuzz testing (the broader T4 item).

## Approach

Add a `RULE_BY_TYPE` map from constraint discriminant to the
`population/*` rule id, and a test that, for each counterexample from a
constraint-rich model, adds its `forbidden` populations to the model,
runs `populationValidationRules`, asserts the mapped rule id is present,
then removes the populations it added (via `OrmModel.removePopulation`)
so each counterexample is checked in isolation. Assert a spread of
constraint types (at least eight) so the guard fails loudly if a
generator stops emitting.

The model is built in-code from the existing per-type fixtures'
patterns -- the intra-fact-type constraints (internal uniqueness, value,
frequency, ring) plus the cross-fact-type ones (mandatory, disjunctive
mandatory, exclusion, exclusive-or, subset, equality, external
uniqueness) -- so the test owns its fixture and does not read from disk.

## Workstream

Single, self-contained: the map, the model builder, and the test. No
production code and no public API change.

## Risks and testing

- Test-only; it cannot regress behavior. If it surfaces a real
  round-trip failure, that failure is a separate bug fixed under its own
  spec -- the point of the guard is to make such a failure visible.
- Isolating with add-validate-remove keeps each counterexample's check
  independent, so an accumulated population cannot mask or fabricate
  another's violation.

## Non-goals

- No change to the generators or the validator.
- Not full property-based testing; this guards the model-wide entry
  point against one invariant, not arbitrary generated models.
