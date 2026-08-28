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
