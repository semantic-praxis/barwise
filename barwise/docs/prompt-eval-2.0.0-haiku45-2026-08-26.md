# Suite 2.0.0 baseline, haiku45-2, both splits (2026-08-26)

The first measurement of the rated suite
(`docs/specs/eval-split-stratification.spec.md`, workstream 1). Run by
the operator on a local key, per `docs/local-eval-runbook.md`, with
`--no-history`: these numbers ground the decisions in workstreams 2 and
3, they are not the committed baseline the re-split will be measured
against. `evals/history.jsonl` still does not exist, which is what keeps
the re-split cheap (barwise-846).

Artifact `haiku45-2@3edda4eff7e5` on `anthropic/claude-haiku-4-5`,
`repeat 5`, both splits. No truncations, no failed calls, cache reading
on every run.

## What it recorded

| Split     | Mean  | 95% margin | Resolvable gap | Worst |
| --------- | ----- | ---------- | -------------- | ----- |
| train (7) | 0.891 | 0.061      | 0.086          | 0.154 |
| dev (3)   | 0.965 | 0.016      | 0.022          | 0.883 |

Per case:

| Case                  | Split | Mean  | SD    | ok  | Quality       |
| --------------------- | ----- | ----- | ----- | --- | ------------- |
| order-management      | train | 0.993 | 0.011 | 5/5 | 0.993 ± 0.011 |
| university-enrollment | train | 0.496 | 0.460 | 2/5 | 1.000 ± 0.000 |
| clinic-appointments   | train | 0.985 | 0.010 | 5/5 | 0.985 ± 0.010 |
| employee-hierarchy    | train | 1.000 | 0.000 | 5/5 | 1.000 ± 0.000 |
| project-staffing      | train | 0.980 | 0.000 | 5/5 | 0.980 ± 0.000 |
| conference-reviews    | train | 0.845 | 0.158 | 5/5 | 0.845 ± 0.158 |
| freight-corrections   | train | 0.937 | 0.018 | 5/5 | 0.937 ± 0.018 |
| vendor-onboarding     | dev   | 0.976 | 0.023 | 5/5 | 0.976 ± 0.023 |
| subscription-billing  | dev   | 0.968 | 0.047 | 5/5 | 0.968 ± 0.047 |
| incident-response     | dev   | 0.952 | 0.012 | 5/5 | 0.952 ± 0.012 |

## The dev split is now the easier half, and that is barwise-845

Under 1.2.0 the dev mean was 0.631 and dev read as the hard half. Rating
the penalties inverted it: dev now scores 0.074 **above** train, with an
error bar a quarter as wide.

The mechanism is visible in the run output rather than inferred. **No
dev case failed a rubric check.** Every failure line printed in either
run belongs to `university-enrollment` or `conference-reviews`, both
train. The dev cases' sub-1.000 scores are entirely penalties --
`corrections=2.4`, `warnings=2.6`, `excessAmbiguity=1` -- not missing
content.

So the two halves still measure different quantities, and the 2.0.0
weights only changed which direction the difference points. Dev grades
element recall, which haiku has in full on all three cases; train grades
constraint semantics through `forbids_population`, which is where the
entire distribution lives. That is the confound barwise-845 exists to
close, now with a number on it.

## What it says about the case count (barwise-846, workstream 3)

The spec's rule was that if the dev error bar is comfortable at four or
five cases, the third new long transcript is not worth writing. It is
comfortable at **three**: ±0.016, resolvable 0.022.

**Do not bank that number.** Dev is tight precisely because its rubric
cannot produce the correlated failure this suite's variance is made of:
every large deviation here came from a `requires_element` plus
`forbids_population` block flipping together on one modelling decision.
Workstream 2 gives the dev cases exactly those checks, so dev's spread
should rise toward train's. Sizing the split against today's dev bar
would fit it to a rubric that is about to change.

What this run does establish: nothing here supports authoring three new
long transcripts on error-bar grounds. Re-measure dev dispersion after
workstream 2 lands, then choose.

## barwise-852 reproduced, and separated its two modes cleanly

`university-enrollment`: `ok=2/5`, `quality=1.000 +/- 0.000`. When it
survives it scores **exactly 1.000 with zero spread**; when it does not,
0.167, 0.154, 0.160 with an identical failure list all three times --
three `requires_element` and two `forbids_population` checks on
`CourseOffering`, failing as one block.

That is not a hard case executed inconsistently. It is a coin flip on a
single modelling decision, executed perfectly either way. It accounts
for 89% of the suite's noise; without it the train resolvable gap falls
from 0.086 to roughly 0.03, and the other six cases average 0.957.

`collapseFloor: 0.3` is doing exactly what it was specified to do here
-- the two modes are reported apart, and the quality mean is untouched
by the collapses. It does not need re-fitting on this evidence.

Still open, and the saved payloads are what settle it: whether the
transcript underdetermines `CourseOffering` (an authoring bug -- fix the
transcript) or whether it is genuinely hard (a real signal -- keep the
case and raise `repeat`). The diff to read is what a collapsed run
builds instead: a direct `Student enrolls in Course` with the semester
hung off it would mean the transcript never forces the offering to be a
thing.

Second instance of the same shape, in train: `conference-reviews`,
sd=0.158, three of five samples missing `Reviewer reviews Paper` and
failing its `requires_element` and `forbids_population` together. Worth
looking at once university-enrollment is settled.

## Operational notes

- **No truncation anywhere.** Train peaked at 9,956 of 16,384 output
  tokens, dev at 14,315 of 41,640. The per-case budget derived from
  transcript length has comfortable headroom at both sizes, and
  `--max-tokens` was not needed.
- **Caching worked on both runs**: 258,774 read against 4,796 written on
  train; 167,864 against 9,576 on dev. No cache warning fired.
- **12 payloads saved on train, 6 on dev** -- best and worst per case,
  which is what `keepDiagnosticPayloads` retains.

## Next

1. **barwise-845 is unblocked and needs no further calls.** Every dev
   sample passed its full rubric, so the saved payloads are usable
   answer keys; the sonnet dev arm's trigger condition (a best sample
   that cannot pass its own rubric) did not fire. Identify the best
   payload per case with `barwise prompt score --case <id> --extraction
<file>`, install it as `tests/fixtures/responses/<caseId>.json`, and
   run `npm run regen:references`.

   One thing to watch when pinning: the existing seven answer keys score
   exactly 1.000, and these three will pin below it -- `vendor-onboarding`
   reached 1.000, but `subscription-billing` topped out at 0.989 and
   `incident-response` at 0.960, on conformance corrections and
   validation warnings rather than any failed check.

2. Read the two `university-enrollment` payload modes and settle
   barwise-852 before touching the case.
3. Re-measure dev dispersion after step 1, then decide the case count.
4. The sonnet arms stay unrun. They answer the variant-versus-default
   comparison, which nothing above is waiting on.
