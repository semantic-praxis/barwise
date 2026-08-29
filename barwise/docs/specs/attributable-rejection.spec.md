# Attributable rejection: forbids_population must judge by the constraint under test

Status: Approved for implementation with suite 2.8.0 (barwise-894)
Created: 2026-08-29
Last-updated: 2026-08-29
Tracking: barwise-894. Evidence: the 2026-08-29 rubric audit
(`npm run audit:rubric`, docs/prompt-optimization-log.md), a measured
prototype of both candidate designs, and the 115 payloads of the
recorded `eval-payloads/20260828-1647/` round.

## Principle

**A `forbids_population` check must pass only when the constraint it
names is what rejects the population.** Today it passes when _anything_
rejects the population, so on a constraint-heavy candidate it certifies
a rule the model never encoded. Measured: **16 of the 24
uniqueness-subject checks pass on an answer key with every uniqueness
constraint deleted**, and 18 of 43 `forbids_population` checks survive
deletion of the whole constraint class they name.

This is the determinism pillar failing at the level above the code. The
check is deterministic -- same input, same output -- and still not a
measurement, because the output does not depend on the thing the check
claims to be about. The scorer's other three kinds were audited in the
same sweep and are sound (`requires_element` 34/34); this one kind
carries the defect, and it is the suite's most numerous.

The consequence is retroactive. Every recorded baseline's constraint
half measured less than it claimed, so this must land **before** any
2.7.0 keyed round, or that round inherits the defect.

## Scope (EARS)

- When a `forbids_population` check names constraint kind K, the system
  shall treat the candidate as rejecting the population only if the
  injection causes a new error-severity diagnostic whose rule belongs to
  K.
- When that diagnostic's rule attributes to a constraint rather than to
  the injected population, the system shall additionally require the
  named constraint to belong to the carrier fact type the population was
  mapped onto.
- When a candidate carries no populations of its own, the system shall
  behave as it does today for every check that was already
  discriminating.
- When the rubric audit tests a `forbids_population` check, the system
  shall delete constraints of the named kind **on the named fact type**
  rather than the whole class.
- The suite manifest shall carry version 2.8.0, and rows either side of
  the bump shall be incomparable.

## What this does not decide

- `must_validate` (barwise-902) and the `cancel` token (barwise-901).
  Separate findings from the same audit, separate fixes.
- The correspondence tiers. `mapForbiddenPopulation`, `projectionMappings`
  and `entityFoldMappings` are untouched: this changes how a rejection is
  judged, never which populations are mapped or onto what.
- Whether the 2.6.0 verdicts move. Recomputing them is a reporting step
  after the fix, not part of it.

## Design: attribute by rule kind AND by carrier (both halves needed)

Two designs were prototyped against the real suite rather than argued.

**Option A -- filter by rule kind alone.** Map each `ConstraintKind` to
the population rules that constitute rejection
(`internal_uniqueness` to `population/uniqueness-violation` and its
external form, `mandatory` to the mandatory pair, and so on), and count
only those.

Measured: `forbids_population` discrimination goes 25/43 to **43/43**
under the audit's class-deletion mutation, every answer key still passes
its full rubric, and 28 of 115 recorded payloads fall with **none**
rising. Cheap and strictly better than today.

**Option A is not sufficient, and the measurement says so.** Under a
sharper mutation -- delete the named kind _on the named fact type_,
leaving other constraints of that kind -- **12 of 43 checks still pass**.
Every one is a `mandatory` check, and the reason is structural:
`population/mandatory-violation` attaches to `c.id ?? ft.id`, the
constraint, and the anchor design mints a fresh player, so _any_
mandatory constraint anywhere in the candidate fires on it. A candidate
with many mandatories passes every mandatory check it is given.

**Option B (chosen) -- rule kind, plus carrier attribution where the
rule attributes to a constraint.** For the rules that attach to the
injected population (`uniqueness`, `ring`, `frequency`,
`value-constraint`), the population id already is the attribution and
Option A's filter is complete. For the mandatory pair, additionally
require the diagnostic's `elementId` to be a mandatory constraint of the
carrier fact type the population was mapped onto -- or that fact type's
own id, which is what the rule falls back to.

This preserves the anchor that barwise-894 warns about. A mandatory
counterexample legitimately rejects via a diagnostic on a _different_
fact type from the injected population: the anchor is the carrier the
mapping chose, and the mandatory constraint under test hangs off it. The
carrier is already computed -- `WiderMapping.candFt` carries it for the
projection and entity-fold tiers -- so the attribution is a lookup, not
a new inference.

**Why not a necessity test** (remove the candidate's corresponding
constraint, re-inject, require the rejection to disappear): it answers
the question most directly and was rejected on determinism grounds. It
requires choosing _which_ candidate constraint corresponds -- exactly
the correspondence problem the tiers exist to solve, re-solved in a
second place with a different answer available. Two mechanisms deciding
one question is the drift shape CLAUDE.md forbids.

## Inventory

| Piece                                               | Change                                                                                                                 |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `checks/forbidsPopulation.ts` -- `candidateRejects` | takes the kind and the carrier; filters by rule, then by attribution                                                   |
| `checks/forbidsPopulation.ts` -- call site          | passes `constraintKind` and the mapping's `candFt`                                                                     |
| `populationMapping.ts`                              | untouched; `WiderMapping.candFt` already carries the carrier, and the flat/expansion tiers must begin returning theirs |
| `scripts/audit-rubric.mjs`                          | `forbids_population` mutation sharpened to per-fact-type                                                               |
| `rubric-baseline.json`                              | 18 `tracked:barwise-894` rows removed by the ratchet                                                                   |
| `evals/suite.yaml`                                  | version 2.8.0 with a changelog paragraph                                                                               |
| answer keys                                         | unchanged -- all ten still pass their full rubric under the prototype                                                  |

## Workstreams

1. **The predicate.** Rule-kind map plus carrier attribution in
   `candidateRejects`; flat and expansion tiers return their carrier so
   every path can supply one. Unit tests in `@barwise/learn` covering
   both halves: a uniqueness check that today passes off a mandatory,
   and a mandatory check that today passes off an unrelated mandatory.
   Acceptance: when the constraint under test is deleted from a
   reference-shaped candidate, the check shall fail, for each of the five
   kinds.
2. **The audit mutation.** Sharpen `audit-rubric.mjs` to delete the named
   kind on the named fact type. This is what found the Option A gap, and
   without it the ratchet would certify the weaker fix. Acceptance: when
   run against the pre-fix build, the audit shall report 30 of 43
   `forbids_population` checks non-discriminating.
3. **The bump and the re-read.** Suite 2.8.0, baseline rows removed, and
   a free offline re-score of the recorded round appended to the
   2.6.0 baseline doc: 28 payloads fall, none rise, mean -0.131, worst
   -0.286. Acceptance: when the round is re-scored, no payload shall
   rise, since the fix only ever removes credit.

Ordered smallest-blast-radius first, but 1 and 2 are coupled: shipping
the predicate without the sharper mutation leaves the ratchet unable to
tell Option A from Option B, and the baseline would then record a green
that is not earned. They land together.

## Open decisions

1. **Do the 2.6.0 verdicts get recomputed and republished, or does the
   next keyed round supersede them?** Recommend superseding. 28 payloads
   fall and the falls concentrate in train (`employee-hierarchy`,
   `conference-reviews`, `project-staffing`), where both arms tied; a
   recomputed arm mean built from mode-representative payloads is not a
   measurement anyway, which the 2.6.0 appendix already says. The cost of
   the alternative is a document that reads like a new baseline without
   being one.
2. **Should `external-uniqueness-violation` count for
   `internal_uniqueness`?** Recommend yes, as prototyped. A candidate
   that encodes the same rule as an external uniqueness constraint has
   encoded it; refusing that is the false-miss shape barwise-892 and
   barwise-896 both fixed. The argument against is that the check names
   `internal_uniqueness` specifically -- if the reviewer prefers strict
   naming, the tiers are the place to say so, not the predicate.
