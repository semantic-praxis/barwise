# Make a score explain itself

Status: Implemented
Created: 2026-08-22
Last-updated: 2026-08-22
Tracking: barwise-833. Prompted by the first `repeat=5` baseline, which
was legible enough to show that the next question could not be answered
at all.

## Principle

Comments describe what the code cannot -- and a report should describe
what the number cannot. The harness now produces a mean it can defend
statistically and cannot explain mechanically. Two gaps, both the same
shape as every defect this line of work has turned up: the output is
insufficient to diagnose the output.

## What the baseline showed

```
university-enrollment  mean=0.540  worst=0.000  sd=0.307  ok=4/5
                       quality=0.675+/-0.061  [corrections=1.6 warnings=6]
suite  mean=0.860 +/- 0.044   gaps below 0.062 are not resolvable
       76% of that noise is university-enrollment alone
```

Two distinct problems were averaging together, and the collapse split is
what separated them:

|                                                   |  cost | nature     |
| ------------------------------------------------- | ----: | ---------- |
| six warnings on every run                         | -0.30 | systematic |
| one run in five missing `CourseOffering` entirely | 0.000 | variance   |

Neither can currently be diagnosed further.

**The warnings are unnamed.** `scoreExtraction` counts diagnostics by
severity and discards them, so the report can say six and not which
six. Seven `completeness/*` rules exist; the recorded answer keys
produce zero warnings between them, so the cost is addressable -- but
nothing says which rule to address.

**The collapse is unreproducible.** The payload is scored and dropped.
Four runs of that case passed every rubric check and one missed the
central entity, and there is no way to ask what the fifth produced
instead. A one-in-five event that owns 76% of the suite's noise is
exactly the thing worth keeping evidence of.

## Scope

In scope:

- A case score shall record which validation rules warned, and how
  often, not merely how many warnings there were.
- The report shall name them, so a reader can see which rule to attack.
- A history row shall carry each case's penalty counts and the suite's
  warnings by rule.
- Each case shall keep the payload of its best and worst scored sample,
  and of any sample that could not be scored at all.
- The operator shall be able to write kept payloads to a directory.

Out of scope, deferred and named:

- **Keeping every payload.** Thirty-five files per sweep to explain the
  one or two that need explaining. Two per case bounds the cost by the
  suite rather than by `repeat`.
- **Automatic writes to a default location.** An eval run should not
  surprise anyone with files. The flag is explicit.
- **Diffing a collapse against a healthy run.** Obvious next step once
  the payloads exist, and a separate concern from capturing them.
- **Re-weighting warnings.** The tally is what tells us whether 0.05 is
  right. Changing a weight before seeing the distribution would be
  guessing, and every recorded row would have to be discarded.

## Why warnings belong in the record, when cache tokens needed an argument

`HistoryEntry.tokens` earned its place on cost grounds, explicitly
against the observation that caching is score-neutral
(`cache-reporting.spec.md`). Warnings are the opposite case and need no
such argument: they are **score-constitutive**. They are, on the first
baseline, roughly 80% of everything lost.

A row carrying a mean without them cannot answer the question anyone
comparing two rows will actually have -- whether the score moved because
warnings fell or because a rubric check began passing. Those are
different achievements and a single number conflates them.

Per-rule detail stays at the suite level rather than per case. Seven
rules across seven cases is forty-nine numbers to answer a question
nobody asks per case; the suite tally answers "which class of defect are
we reducing" and is seven.

## Inventory

| Area                                     | Current state                      | Verdict |
| ---------------------------------------- | ---------------------------------- | ------- |
| `promptlab/src/score/scoreExtraction.ts` | Counts diagnostics, discards them  | modify  |
| `promptlab/src/run/runSuite.ts`          | No payload kept, no rule tally     | modify  |
| `promptlab/src/history/history.ts`       | Mean and SD per case, no penalties | modify  |
| `cli/src/commands/prompt.ts`             | Prints counts, cannot name a rule  | modify  |

## Workstreams

### 1. Name the warnings

`CaseScore.warningsByRule`. Acceptance: when a scored model warns, the
score shall record the rule that warned and how many times; and when it
does not warn, the field shall be empty rather than absent-and-ambiguous.

### 2. Keep what cannot be explained

`CaseRun.payload`, kept for each case's extremes and for unscorable
runs, plus `--save-payloads <dir>`. Acceptance: when a case is sampled
more than twice, the samples between its best and worst shall not retain
a payload; when the operator names a directory, the retained payloads
shall be written there.

**Corrected after the first dev run.** Capture was first tied to the
collapse floor, and the sweep it was built for defeated it:
`subscription-billing` ranged 0.327 to 0.950 on the same transcript,
`ok=5/5`, no collapse, nothing kept. The interesting failure is not
"below a threshold" but "far from its siblings", which a threshold
cannot see. Best as well as worst because the question is what the good
run did that the bad one did not, and one payload cannot answer it.

### 3. Record the decomposition

Per-case penalty counts and a suite-level warning tally on the history
row. Acceptance: when a run is recorded, the row shall carry enough to
say why the mean is what it is.

## Risks and testing

- **Memory.** Payloads are tens of kilobytes and a sweep is dozens of
  runs. Two per case bounds this by the suite, so `repeat` cannot grow
  it -- asserted directly, since the pruning happens after scoring and a
  regression would be invisible until a long sweep.
- **A tally that hides a rule firing once.** The point is to find the
  dominant rule, but a rule firing once is still the difference between
  a passing and failing case elsewhere. Every rule that fired is listed,
  not a top-N.
- **Row growth.** Per-case counts are three numbers each; the rule tally
  is one object at the suite level. Both are bounded by the rule set,
  not by the run.
- Full gate: `npm run build`, `test`, `lint`.

## Non-goals

- No change to the scoring formula or the weights.
- No change to which rules exist or their severities.
- No prompt change.
