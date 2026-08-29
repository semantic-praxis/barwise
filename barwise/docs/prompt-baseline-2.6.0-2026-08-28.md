# The suite 2.6.0 baseline: the sonnet verdict survives its measurement fix

Date: 2026-08-28. The re-baseline the 2.5.0 record's own appendix
called for: both shipped variants and the default artifact, on both
models, both splits, `--repeat 5`, recorded to history -- now measured
by an evaluator that sees wider shapes (barwise-890). Point-in-time
artifact; the next baseline is a new file.

Provenance: suite 2.6.0; artifacts haiku45-2, sonnet5-3, default
1.1.0. Record in `eval-payloads/20260828-1647/` (committed on branch
`eval-round-20260828-1647` with the eight history rows, the arm logs
as siblings of their payload directories, and the `eval-runner.sh`
that ran them -- the logs initially fell to the root `.gitignore`'s
`*.log` and needed a force-add; a negation now covers the record).
The offline audit re-scored all 115 committed payloads against their
exact per-sample log lines: zero mismatches, and per-mode retention
(barwise-891) held -- no duplicate modes, middle modes present. Runs
used `--concurrency` 3 (dev) and 7 (train); every log names its
artifact, all eight footers say suite 2.6.0, and no failure or
truncation warning appears anywhere in the round.

## The eight arms

| Arm              | dev             | train           |
| ---------------- | --------------- | --------------- |
| haiku45-2        | 0.971 +/- 0.009 | 0.973 +/- 0.018 |
| default @ haiku  | 0.885 +/- 0.061 | 0.962 +/- 0.007 |
| sonnet5-3        | 0.831 +/- 0.110 | 0.976 +/- 0.007 |
| default @ sonnet | 0.814 +/- 0.076 | 0.976 +/- 0.008 |

(2.5.0 rows are incomparable by suite version; directionally, every
cell moved the way the offline re-read predicted -- train sonnet up
~0.06 on the clinic rescue, vendor-affected dev cells up ~0.05-0.09.)

## Verdict 1: haiku45-2 earns its keep -- now on an unblinded metric

**haiku45-2 vs default, on haiku:** +0.086 on dev against a combined
95% margin of 0.062 -- resolvable, held out, and no longer inflatable
by the measurement artifact, since 2.6.0 scores wider shapes as
carrying their rules. Train is a tie (+0.011, margin 0.020). The same
shape as the 2.5.0 verdict, now standing on firmer ground.

**sonnet5-3 vs default, on sonnet:** +0.016 on dev (margin 0.134,
unresolved) and an exact tie on train (+0.000, margin 0.010). The
2.5.0 baseline marked this verdict provisional on barwise-890; the fix
landed, the re-run happened, and the verdict did not move. **The
provisional flag comes off: at repeat 5, sonnet5-3 shows no resolvable
value over sending the default.** It was not measurement.

## Verdict 2: the cross-model gap was measurement, and now it is gone (on train)

haiku45-2 vs sonnet5-3 on train: -0.003, dead even -- at 2.5.0 this
gap was 0.037 and the baseline attributed most of it to 890. Confirmed
in full. The dev gap that remains (+0.141, resolvable) is not
systematic quality but sonnet dev instability, diagnosed per payload
below.

## What the two bad dev cells actually are (payload-verified)

- **sonnet5-3 subscription run 5 scored 0.077 -- the record's first
  sample below the 0.3 collapse floor.** The payload parsed, but
  conformance rejected all 44 of its role players
  (`invalid_role_player` x44), leaving a zero-element model that fails
  every element and population check. One catastrophic sample turns
  the case mean 0.85-ish into 0.693 +/- 0.366 and dominates the arm's
  dev margin. This is the strongest single piece of evidence yet for
  barwise-813 (promote conformance rules): the model's answer was not
  empty; the pipeline's reading of it was.
- **default-sonnet vendor run 3 scored 0.330:** the shapes are all
  there (38 elements) and nineteen fact types carry no constraint at
  all -- five "still allows" failures, `missing_identifier_population`
  x3. A genuine constraint-drop collapse, and the failure messages say
  "still allows", not "does not carry": the correspondence tiers
  mapped everything, so the score is measuring the model now.

## The 2.5.0 headroom list, re-read

1. **The freight regression did not reproduce.** haiku45-2 freight
   0.921 vs default 0.923 -- even. The 2.5.0 gap (0.893 vs 0.940) was
   sampling, not a stable property; "clearest WS4 target" is
   withdrawn.
2. **Conference bimodality on haiku persists** (worst 0.684 against a
   0.937 mean) -- still the Reviewer-Paper drop, still haiku-specific,
   still genuine.
3. **University is clean on both models** (its 890 distortion is
   gone), and clinic no longer appears among any arm's low cells.
4. **Sonnet's conformance noise is now the sonnet story**: one
   total-collapse sample and heavy `invalid_role_player` /
   `missing_identifier_population` tallies. barwise-813 promotion is
   cheaper than prompt text for all of it.

## Collapse floor

The 0.077 sample is the first recorded observation below the 0.3
floor, and it is a true collapse (zero usable elements), not a
890-distorted score -- the floor's first firing is a correct one. The
re-fit deferred at 2.5.0 can now proceed against undistorted minima,
though one observation argues no urgency: the floor separated exactly
the sample it should have.

## Follow-ons, in order

1. barwise-813: promote the conformance findings to deterministic
   rules -- the subscription collapse and the vendor constraint-drop
   are its evidence base, and it now blocks more score than any prompt
   edit.
2. WS4 prompt iteration for haiku: conference's Reviewer-Paper drop is
   the one reproducible regression left; freight is withdrawn.
3. The sonnet5-3 decision: with the tie confirmed on an unblinded
   metric, either retire the variant (send the default on sonnet) or
   iterate it against the dev instability -- but any iteration should
   wait for 813, which is where its dev deficit actually lives.
4. barwise-846 WS3: the difficulty-calibrated transcripts, then the
   re-split and the next baseline.
