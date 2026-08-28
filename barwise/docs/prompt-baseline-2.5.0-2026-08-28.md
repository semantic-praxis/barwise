# The suite 2.5.0 baseline: eight arms, two verdicts, one measurement debt

Date: 2026-08-28. The split-stratification spec's workstream 4 record:
both shipped variants and the default artifact, on both models, both
splits, `--repeat 5`, recorded to history. Point-in-time artifact --
the next baseline is a new file.

Provenance: suite 2.5.0; artifacts haiku45-2@3edda4eff7e5,
sonnet5-3@8643ad91d140, default 1.1.0@08b024dc2a29. Logs in
`eval-runs/20260828-0936/`; distinct payloads (best/worst per case) in
`eval-payloads/`. Runs used `--concurrency` 3 (dev) and 7 (train);
zero failed calls across 120 -- the terminated-retry fix (barwise-886)
saw no drops recur. `history.jsonl` rows recorded on the operator's
machine; committed separately.

## The eight arms

| Arm              | dev             | train           |
| ---------------- | --------------- | --------------- |
| haiku45-2        | 0.932 +/- 0.025 | 0.954 +/- 0.019 |
| default @ haiku  | 0.835 +/- 0.056 | 0.949 +/- 0.018 |
| sonnet5-3        | 0.853 +/- 0.049 | 0.917 +/- 0.030 |
| default @ sonnet | 0.800 +/- 0.048 | 0.929 +/- 0.037 |

## Verdict 1: haiku45-2 earns its keep; sonnet5-3 does not (yet)

**haiku45-2 vs default, on haiku:** +0.097 on dev -- the one
resolvable variant-vs-default gap in the record, and it is on the
held-out half, in exactly what the 2.5.0 dev rubric was built to
measure: the default drops settled mandatories (VendorStatus,
PO-has-vendor, BillingPeriod, entitles-a-bundle, StartDate) in 2-3 of
5 runs; the variant carries them every time. Train is a tie (0.005,
threshold 0.025): the variant's clean-case wins (order, clinic,
project, employee) cancel against one real regression (freight,
below). The reverse of an overfitting signature.

**sonnet5-3 vs default, on sonnet:** +0.053 on dev (threshold ~0.068,
unresolved) and nominally NEGATIVE on train (0.917 vs 0.929). At
repeat 5, the sonnet variant is not demonstrably better than sending
the default. This is the record's second-largest actionable fact.

## Verdict 2: the cross-model gap is mostly measurement, not quality

haiku45-2 beats sonnet5-3 on both splits, but the margin is heavily
barwise-890: the correspondence tiers (flat multiset + declared
objectification) cannot see a rule carried in a WIDER fact type, and
sonnet prefers wider shapes. Verified against payloads, not inferred:

- **clinic (sonnet, both prompts):** the 5-ary "Appointment is for
  Patient with Doctor on Date at TimeSlot" absorbs the reference
  binaries; two direct projection misses plus THREE anchor-propagated
  misses (checks whose own fact types match exactly but whose
  mandatory counterexamples anchor on the absorbed binaries). Both
  prompts produce the identical 5-ary, so this is a model property.
  Distortion ~0.1-0.3 of sonnet's clinic mean per run affected.
- **vendor (both models, both prompts, 20/20 runs):** the
  Contact-as-entity shape -- and haiku's carries the exact Meridian
  IUC over (Vendor, Region), sourced to the settling lines. The
  reference's flat 5-ary, generated from the one payload that
  flattened it, is the outlier shape. ~0.09-0.10 per arm, but it
  cancels out of every variant-vs-default comparison.
- **subscription (sonnet):** "PlanChange records Subscription with
  new PricePlan on EffectiveDate by Requester" -- projection again.
- **NOT this class**, verified as genuine defects and left standing:
  the variant's freight LineItem orphan (below), the default's
  missing mandatories, haiku's Severity/Priority drop, sonnet's
  suspend-ambiguity miss (barwise-892: lexical -- "suspension" does
  not contain the substring "suspend"; the item itself was reported).

Consequence: **fix barwise-890 (with its suite bump to 2.6.0) before
any WS4 prompt iteration.** Tuning prompts against these numbers
optimizes toward the reference's accidental shapes, and the sonnet
verdict above could flip once its wider modeling stops scoring as
absence.

## Real headroom (prompt-actionable, survives the 890 adjustment)

1. **haiku45-2 regresses freight vs the default.** The default's
   payloads carry the correct "Shipment contains Product with
   Quantity" ternary in every saved run; the variant sometimes splits
   it into an orphaned ShipmentLineItem (tied to neither Shipment nor
   Product) and misses the warehouse frequency rule. 0.893 +/- 0.089
   vs 0.940 +/- 0.019. The clearest WS4 target for the haiku prompt.
2. **haiku drops whole entities under load, rarely but repeatably:**
   Severity+Priority once in five incident runs (also seen 2026-08-27);
   Reviewer-Paper still collapses bimodally on conference (a haiku
   property -- default-on-sonnet runs conference at 1.000 +/- 0.000).
3. **Instructor-teaches goes missing in ~2/5 university runs on BOTH
   models and BOTH prompts** -- a case property worth a payload read
   before treating as prompt headroom.
4. **Sonnet's conformance noise is enormous under either prompt**
   (missing_identifier_population x19, invalid_role_player x7 in one
   arm) -- barwise-813 promotion candidates, cheaper as deterministic
   rules than as prompt text.

## Collapse floor: deliberately NOT re-fitted

Workstream 4 scheduled a re-fit; the recorded distribution says defer.
Zero samples in 120 fell below the current 0.3 floor, and the observed
minima (0.467-0.684) are precisely the 890-distorted scores -- a floor
raised to catch them would classify a correspondence artifact as a
collapse and then mis-fire after 2.6.0 removes it. Re-fit belongs
after the 890 bump, against undistorted minima. `collapseFloor: 0.3`
stands unchanged.

## Follow-ons, in order

1. barwise-890: projection + entity-fold correspondence (spec first;
   891's retention change and 892's token fix ride the same 2.6.0
   bump).
2. Re-read this table's affected cells at 2.6.0 -- the sonnet5-3
   verdict is the one that may flip.
3. WS4 prompt iteration on the unblinded numbers (freight regression
   first), and the barwise-846 WS3 transcripts per
   `docs/specs/eval-difficulty-calibration.spec.md`.

## Appendix, same day: the 2.6.0 offline re-read

Suite 2.6.0 landed (`docs/specs/wider-shape-correspondence.spec.md`)
and the committed payloads were re-scored against it -- the free,
zero-call re-read item 2 promised. Two results, one of them about the
record itself.

### The record first: seven payload files are stale

The audit that makes the deltas trustworthy also caught a flaw. A
fresh file re-scored with the new tiers disabled must reproduce its
arm log's recorded score exactly (for non-vendor cases, whose rubrics
2.6.0 did not touch); seven files in the two `haiku45-*` directories
do not, at gaps far beyond rounding. They are leftovers of the
discarded 2.4.0 attempts in the reused `/tmp` directories -- the same
overwrite hazard the false-alarm investigation hit -- and are named in
`eval-payloads/20260828-0936/README.md`; nothing below reads them.
Every other file reproduces its logged score exactly. Two earlier
claims must be re-graded accordingly: the incident Severity+Priority
drop rested partly on a stale file (the 2026-08-27 sighting stands,
this round's does not), and no committed conference payload actually
records the 0.833 middle mode -- best/worst retention never kept one,
which is barwise-891's argument made by its own absence.

### The genuine deltas (fresh files only, live 2.5.0 -> offline 2.6.0)

| Arm                  | Payload                    | 2.5.0 | 2.6.0 | delta  |
| -------------------- | -------------------------- | ----- | ----- | ------ |
| sonnet5-train        | clinic-appointments-run1   | 0.467 | 0.967 | +0.500 |
| default-sonnet-train | clinic-appointments-run1   | 0.500 | 1.000 | +0.500 |
| sonnet5-dev          | vendor-onboarding-run2     | 0.735 | 0.917 | +0.182 |
| haiku45-dev          | vendor-onboarding-run3     | 0.889 | 1.000 | +0.111 |
| haiku45-train        | university-enrollment-run1 | 0.882 | 0.993 | +0.111 |
| sonnet5-train        | university-enrollment-run3 | 0.889 | 1.000 | +0.111 |
| default-sonnet-train | university-enrollment-run2 | 0.889 | 1.000 | +0.111 |
| haiku45-dev          | vendor-onboarding-run1     | 0.869 | 0.960 | +0.091 |
| haiku45-dev          | vendor-onboarding-run2     | 0.909 | 1.000 | +0.091 |
| sonnet5-dev          | vendor-onboarding-run3     | 0.833 | 0.924 | +0.091 |
| default-haiku-dev    | vendor-onboarding-run3     | 0.819 | 0.910 | +0.091 |
| default-sonnet-dev   | vendor-onboarding-run2     | 0.627 | 0.718 | +0.091 |
| default-sonnet-dev   | vendor-onboarding-run4     | 0.820 | 0.911 | +0.091 |
| default-sonnet-dev   | subscription-billing-run3  | 0.669 | 0.746 | +0.077 |
| sonnet5-dev          | subscription-billing-run3  | 0.624 | 0.700 | +0.076 |
| default-haiku-dev    | vendor-onboarding-run4     | 0.816 | 0.879 | +0.063 |

Every delta is a rise (the tiers are rescue-only, and the audit is
what backs that word with data); every remaining fresh file is
unchanged to three decimals.

### What the re-read settles, and what it cannot

- **The clinic diagnosis was exact.** Both prompts' worst sonnet
  clinic runs gain +0.500: two direct projections and three anchor
  propagations, all rescued by one shape correspondence. The 0.467
  "collapse-adjacent" minimum was measurement.
- **The vendor distortion was ~0.09 per arm as estimated**, and it
  reached every arm, both models, both prompts.
- **A finding the baseline missed: university was 890-distorted too.**
  The "Instructor teaches" misses called a case property in headroom
  item 3 were sonnet (and once haiku) carrying the fact type wider;
  those payloads now score 0.993-1.000. Item 3 shrinks from "case
  property worth a payload read" to "haiku-only, and rarer".
- **Arm means cannot be recomputed offline.** Saved payloads are the
  per-case extremes, not the samples, so the table above bounds the
  distortion without yielding new means. Directionally: both sonnet
  arms gain on the same cases by similar amounts, so verdict 1's
  "sonnet5-3 shows no resolvable value over the default" likely
  survives, while verdict 2's cross-model gap shrinks materially. The
  true 2.6.0 baseline is the next keyed run, and it should precede any
  WS4 prompt iteration.
