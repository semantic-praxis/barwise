# Wider-shape correspondence: projection and entity-fold tiers for forbids_population

Status: Implemented at suite 2.6.0 (2026-08-28; both tiers, the
carrier diagnostics, the riders, and the offline re-read appended to
the baseline doc). The open decisions resolved as recommended: 891
rounds at 3 decimals; the entity-fold requires no reference mode.
Created: 2026-08-28
Last-updated: 2026-08-28
Tracking: barwise-890 (the tiers), barwise-891 and barwise-892 (riders
on the same bump). Evidence: docs/prompt-baseline-2.5.0-2026-08-28.md
and the payloads under `eval-payloads/20260828-0936/`. Extends
`docs/specs/objectified-correspondence.spec.md` (the expansion tier
this generalizes beside) and `docs/specs/eval-name-licensing.spec.md`
(whose append-only, rescue-only discipline both new tiers inherit).

## Principle

Grade by semantics, not by diffing a reference model -- the learn
package's founding rule, currently violated at the shape level. A
domain has many valid ORM models, and the 2026-08-28 baseline measured
what the violation costs: a candidate that carries a settled rule in a
WIDER fact type than the reference's scores identically to one that
never modeled the rule. Verified instances, all from committed
payloads:

- **Projection**: sonnet's 5-ary "Appointment is for Patient with
  Doctor on Date at TimeSlot" absorbs the reference binaries "Patient
  books Appointment" and "Appointment is with Doctor" (players a
  strict subset of the 5-ary's); sonnet's "PlanChange records
  Subscription with new PricePlan on EffectiveDate by Requester"
  absorbs "PlanChange is for Subscription".
- **Entity-fold**: both models' preferred vendor shape -- a ternary
  "Vendor has primary Contact in Region" with Contact an entity whose
  name/email/phone are Contact's own binaries -- against a reference
  5-ary that flattens those three into value roles. Haiku's payload
  carries the exact Meridian IUC over (Vendor, Region), sourced to the
  transcript's settling lines, and scores as "does not carry the
  relationship".
- **Anchor propagation**: sonnet clinic runs with EXACT matches for
  "Doctor has Specialty", "Appointment has AppointmentStatus", and
  "Patient has primary Doctor" fail all three mandatory checks anyway,
  because `forMandatory`'s counterexample anchors on a binary the
  candidate absorbed into the 5-ary. One shape decision, five failed
  checks.

Measured distortion at 2.5.0: ~0.1 of every arm's vendor mean, ~0.3 of
sonnet's clinic runs affected, and enough of the sonnet total that the
baseline's "sonnet5-3 shows no resolvable value over the default"
verdict is explicitly provisional on this spec.

## Should correspondence infer these shapes, or require declaration? (resolved: structural evidence is the declaration)

The licence spec's rule is declared-never-inferred, and the
objectification tier obeyed it by keying on explicit
`ObjectifiedFactType` links. Neither new tier has such a link to key
on -- but neither is fuzzy inference either. Projection keys on the
candidate's own role players: the reference's player multiset must be
a strict sub-multiset of the candidate fact type's, name for
licensed name. The entity-fold keys on fact types the candidate itself
declares: every absorbed reference value role must be the value player
of a binary whose other player is the folding entity. Both are exact
structural facts about the candidate model, not string similarity --
the same standing the objectification link has, one declaration less
direct. What stays forbidden is unchanged: no substring matching, no
edit distance, no "probably the same concept".

## Scope

In scope (all within `learn`'s `populationMapping.ts` and
`forbidsPopulation.ts`, plus the named riders):

- When the flat and expansion tiers find no correspondence, the system
  shall try PROJECTION: candidate fact types whose canonical player
  multiset strictly contains the reference fact type's, mapping shared
  roles by the flat tier's group-and-zip rule and giving each extra
  candidate role a fresh value, distinct per injected instance.
- When projection also fails, the system shall try ENTITY-FOLD: a
  candidate fact type matching the reference's players except that two
  or more reference value roles are replaced by one entity role, where
  every absorbed reference name is the value player of a candidate
  binary against that entity; absorbed values join into one synthetic
  value in reference role order (the objectification fold's separator
  and determinism rules apply verbatim).
- When any population in a counterexample maps through a new tier --
  the constraint's own fact type or a mandatory anchor -- the check
  shall proceed identically to a flat mapping (this is what repairs
  anchor propagation; it needs no special casing because anchors
  already flow through `mapForbiddenPopulation`).
- When every tier fails but at least one candidate fact type's players
  strictly contain the reference's, the failure message shall name it:
  "possibly carried in the wider fact type <name>, whose constraints
  do not forbid this population" -- distinct from today's blanket "does
  not yet carry the relationship". The 2026-08-28 verification did
  this classification by hand with jq; it is computable at check time.
- Riders on the same 2.6.0 bump: barwise-892 (vendor requires_ambiguity
  token `suspend` becomes the stem `suspen`, matching the noun form
  sonnet used for the correctly-reported parked item) and barwise-891
  (`keepDiagnosticPayloads` retains one payload per distinct score
  mode -- scores equal after rounding to 3 decimals -- not only the
  extremes, so a trimodal case's middle mode survives for diagnosis).

Out of scope: any change to which constraints are checked or how
counterexamples are generated; set-comparison check kinds;
`forbids_population` on external uniqueness; nested folds (an entity
fold inside a projection) -- each attempt is one tier, and a shape
needing two stays unmapped with the diagnostic.

## The one load-bearing subtlety: extra values must differ per instance

An injected population's instances must differ somewhere outside the
projected roles, or the test becomes vacuous: two byte-identical
tuples violate EVERY uniqueness constraint, so a candidate whose IUC
spans all roles -- the shape that does NOT carry the reference rule --
would reject them too, and the check would pass a model it should
fail. Fresh, per-instance-distinct values for extra roles are what
keep the question sharp: an IUC over only the shared roles rejects the
injection (rule carried), an IUC spanning the extra roles does not
(rule not carried). The same rule falls out of the entity-fold for
free -- synthetic joined values differ because the reference values
they join differ -- and the projection tier must enforce it
explicitly.

## Ambiguity: several wider carriers

"Patient books Appointment" projects into any candidate fact type
containing both players. Resolution: attempt candidates in ascending
arity (fewest extra roles first -- the least speculative reading),
then model order; the check passes on the first attempt whose
injection the candidate rejects. Trying all candidates is not
answer-shopping: each attempt asks the same question of a different
declared carrier, and "some declared carrier forbids this population"
is precisely the check's semantic intent. If no attempt rejects, the
failure reports the carriers tried.

## Inventory

| Module                                           | Current state                   | Verdict                                                                                  |
| ------------------------------------------------ | ------------------------------- | ---------------------------------------------------------------------------------------- |
| `learn/src/evaluate/populationMapping.ts`        | flat + expansion tiers          | add projection + entity-fold after expansion; tiers stay append-only rescues             |
| `learn/src/evaluate/checks/forbidsPopulation.ts` | one blanket not-carried message | carrier-aware failure message; attempt loop over projection candidates                   |
| `core` counterexample generation                 | untouched                       | untouched -- populations are mapped, never regenerated                                   |
| `promptlab` scorer/runner                        | untouched by the tiers          | 891 rider only (`keepDiagnosticPayloads`)                                                |
| `promptlab/evals/vendor-onboarding.eval.yaml`    | `matches: [suspend]`            | 892 rider: `[suspen]`                                                                    |
| `promptlab/evals/suite.yaml`                     | 2.5.0                           | 2.6.0 with changelog: scores loosen where shapes were blind                              |
| `tests/scoreExtraction.test.ts` pinned rows      | 2.5.0 answer-key scores         | re-verify; keys pass the flat tier today, so no change expected -- a change is a finding |

## Workstreams (each independently shippable)

### 1. Projection tier, with the carrier-aware message

The larger win (clinic, subscription, conference's inferred middle
mode) and self-contained. Unit tests build the observed shapes
directly: the clinic 5-ary against the booking binaries (both the
direct projection and the anchor propagation through a mandatory), the
PlanChange 5-ary, the vacuity guard (a spanning IUC must NOT pass),
and the ambiguity ordering. Integration pin: the committed payload
`eval-payloads/20260828-0936/sonnet5-train/clinic-appointments-run1.json`
scores with all five clinic checks passing.

### 2. Entity-fold tier

The vendor shape. Unit tests: the Contact ternary with the Meridian
IUC passes; the same ternary without it fails with "still allows"; a
candidate whose absorbed names attach to DIFFERENT entities does not
fold. Integration pin: `haiku45-dev/vendor-onboarding-run1.json`
passes the Meridian check.

### 3. The riders and the bump

892's one-token edit, 891's per-mode retention (promptlab, with a unit
test on a trimodal score list), the 2.6.0 `suite.yaml` changelog, and
re-running the pinned answer-key rows. Last, so the bump describes
finished behavior.

After landing: re-score the eight recorded arms' committed payloads
offline against 2.6.0 and append the deltas to the baseline doc --
that is the free, zero-call re-read the baseline's "may flip" verdict
on sonnet5-3 is waiting for. (Recorded history rows stay untouched;
they are 2.5.0 measurements and the version field says so.)

## Alternatives considered

- **Regenerate references from wider-shape payloads instead.** Swaps
  which shape is privileged without removing the privilege; the next
  model draw flattens again and fails in mirror image. Correspondence
  is the general fix; references stay whatever their recorded payload
  produced.
- **Diff-based shape equivalence (compare candidate and reference as
  graphs).** The founding rule rejects it: many valid models, and a
  graph metric reintroduces structural diffing with a threshold to
  tune. The tiers instead extend the existing question -- "does the
  candidate's own constraint machinery forbid this population" -- to
  shapes that carry the same population under a value mapping.
- **Pass when ANY candidate constraint rejects, however mapped.**
  Injecting into every fact type at once and asking "did anything
  fire" loses the correspondence discipline entirely -- a rejection
  from an unrelated constraint would count. Each tier maps role for
  role or fails; rejection must come from the mapped carrier's own
  population check.

## Open decisions (for review)

- **Score-mode rounding for 891.** Recommend 3 decimals (scores are
  reported at 3); coarser merges real modes, finer resurrects noise.
- **Should the entity-fold require the fold entity to have a
  reference mode?** Recommend no: the parser guarantees entities one
  anyway, so the requirement would be vacuously true and read as
  load-bearing.

## Risks and testing

- Both tiers are rescue-only: every payload that maps today maps
  identically (the flat and expansion tiers run first and
  short-circuit). The 2.5.0 answer keys pin this -- their scores must
  not move, and the referenceDrift test is untouched since no
  generated artifact changes.
- The vacuity guard (spanning IUC must fail) is the test that keeps
  the tier honest; it is workstream 1's first test, not an
  afterthought.
- The committed round payloads double as integration fixtures: the
  exact models that exposed the gap become the models that pin the
  fix.
- One bump for all three changes, per the 2.5.0 precedent: rows either
  side are incomparable, and the changelog names all three reasons.

## Non-goals

- No change to production import/review behavior: these tiers live in
  the evaluator (`learn`), which production never calls.
- No recursive or combined tiers; a shape needing two rescues stays
  unmapped, visibly, with the carrier diagnostic.
- No re-litigation of which shape is "better" ORM: the reference's
  shape stays the reference; the tiers only stop penalizing declared
  equivalents.
