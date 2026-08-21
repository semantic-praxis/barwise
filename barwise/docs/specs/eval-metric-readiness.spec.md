# Make the eval metric strong enough to optimize against

Status: Implemented (all three workstreams)
Created: 2026-08-21
Last-updated: 2026-08-21
Tracking: prerequisite for workstream 3 of
`docs/specs/prompt-optimization-harness.spec.md` (the DSPy `optimizer/`
lane, still unbuilt) and for barwise-813. Motivated by the measured
resolution of the 2026-08-21 n=5 runs on branch `optimization-evals-3`.

## Principle

Determinism in the core, and explicit over implicit. The scorer is
deterministic and the suite is now honest about its own precision --
`docs/specs/eval-run-resolution-and-provenance.spec.md` made every run
report its standard error. That measurement is what this spec responds
to: the suite cannot resolve the differences it is being asked to
judge.

From the three n=5 runs recorded on 2026-08-21:

| Comparison                                  | difference | needed at 95% | verdict        |
| ------------------------------------------- | ---------- | ------------- | -------------- |
| `haiku45-2` vs default, Haiku 4.5           | +0.072     | 0.090         | not resolvable |
| same, with `university-enrollment` excluded | +0.057     | 0.051         | resolved       |

One case decides it. `university-enrollment` carries 60% of the default
run's variance and 91% of the variant run's, scoring a mean of 0.28 and
0.44 with a worst of 0.000 in both. It is not noisy in the ordinary
sense; it is bimodal, sometimes producing a usable model and sometimes
collapsing entirely, and averaging the two states produces a number
that describes neither.

That matters now because the next step under discussion is a DSPy
optimizer. An optimizer is a search driven by a metric, and a metric
that cannot separate its candidates does not make the search slow, it
makes the search wrong -- it will rank candidates by which one got the
luckier draw on the one bimodal case.

## Is the suite already being overfitted? (resolved: yes, visibly)

`haiku45-2` was hand-tuned against these seven cases. Measured against
the same seven, it improves six and regresses one:

| Case                  | default | haiku45-2 | z     |
| --------------------- | ------- | --------- | ----- |
| `order-management`    | 0.890   | 0.996     | +14.2 |
| `clinic-appointments` | 0.736   | 0.950     | +2.4  |
| `conference-reviews`  | 0.956   | **0.819** | −3.4  |

The regression is beyond noise, and both moved cases have
uniqueness-heavy rubrics -- the variant's headline rule is "every
2+-role fact type carries internal uniqueness", and it helped one and
hurt the other. A hand-tuned prompt that fits six of seven cases and
breaks the seventh is the ordinary signature of fitting the suite
rather than the task.

Nothing in the harness would have caught it, because every case is a
training case. A search that runs hundreds of candidates against the
same seven, with no held-out set, does more of this and faster.

## What actually buys sensitivity? (resolved: separating two questions, not raising n)

Raising `repeat` is the obvious lever and the weak one. At the measured
variance, resolving a 0.02 regression needs roughly n=190 per
configuration -- 1,330 calls per config per tier.

The cheap lever is to stop averaging two different questions together.
A run of a case answers both "did the extraction survive at all" and
"how good was it when it did", and the composite mean blends a
near-Bernoulli variable with a tight one. Split them and the tight half
becomes tight again: on the recorded data, dropping the collapsing case
alone moves the same comparison from z=1.56 to z=2.19.

The two numbers do not always agree, and that is a feature. A candidate
that collapses less often but models worse is a real trade-off a
reviewer should see, not one an average should hide.

**Which leaves the optimizer's metric unchanged.** DSPy needs a single
scalar to search on, and the existing composite score stays exactly
that. What changes is the _gate_: search on the composite, accept on
the pair. Nothing about the recorded history is invalidated, because
the composite `mean` keeps its current definition.

## Where does the floor come from? (resolved: the manifest, like every other weight)

Calling a sample a collapse needs a threshold, and a threshold is a
judgment. The project already has a rule for this: "Weights come from
the suite manifest, never from code, so reweighting is a data change."
`collapseFloor` joins `weights` for the same reason -- it is reviewable
in a diff, and changing it is a recorded decision rather than an edit
nobody sees.

Recommended value is 0.3. See Open decisions.

## Scope

In scope:

- When a suite manifest declares a `collapseFloor`, the system shall
  count each case's scored samples falling below it as collapses.
- When a case has at least one sample at or above the floor, the system
  shall report the mean and standard deviation over those samples
  separately from the mean over all samples.
- When a case's samples are all below the floor, the system shall
  report no quality mean rather than reporting zero.
- When a manifest omits `collapseFloor`, the system shall behave
  exactly as it does today.
- When a report is rendered, the system shall present each case's
  success count alongside its quality mean.
- When a suite manifest declares splits, every declared case shall
  appear in exactly one split, and the loader shall reject a manifest
  where any case is unassigned or assigned twice.
- When a suite runs with a split selected, the system shall run only
  that split's cases and shall record which split ran.
- When the three unused transcripts are declared as cases, the suite
  shall carry ten cases.

Out of scope, deferred and named:

- **The DSPy `optimizer/` project itself.** This spec makes its metric
  trustworthy; it does not build it. That remains workstream 3 of the
  harness spec.
- **`forbids_population` checks on the three new cases.** That check is
  loader-enforced to require a reference model, and references are
  generated from a recorded payload rather than hand-written. The new
  cases ship with reference-free rubrics and gain population checks
  when a keyed run has produced payloads.
- **Changing the composite score.** `mean` keeps its definition, so
  every recorded history row stays comparable.
- **Rebalancing the seed suite's weights.** Untouched.
- **Deciding barwise-813.** This spec gives that decision a metric that
  can support it; it does not make it.

## Inventory

| Area                                                                                       | Current state                                               | Verdict        |
| ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- | -------------- |
| `promptlab/evals/suite.yaml`                                                               | version 1.1.0, weights, seven cases, no floor and no splits | modify (W1,W2) |
| `promptlab/src/evalcase/types.ts`                                                          | `SuiteWeights`, `EvalCase`, `EvalSuite`                     | modify (W1,W2) |
| `promptlab/src/evalcase/loadSuite.ts`                                                      | Validates the manifest and each case                        | modify (W1,W2) |
| `promptlab/src/stats/dispersion.ts`                                                        | `sampleSd`, `dispersionOf`; pure                            | untouched      |
| `promptlab/src/run/runSuite.ts`                                                            | Folds mean/worst/sd/samples per case                        | modify (W1,W2) |
| `promptlab/src/score/scoreExtraction.ts`                                                   | The composite score                                         | untouched      |
| `promptlab/src/history/history.ts`                                                         | `HistoryEntry`                                              | modify (W1,W2) |
| `cli/src/commands/prompt.ts`                                                               | `renderReport`; `--repeat`                                  | modify (W1,W2) |
| `promptlab/evals/{vendor-onboarding,subscription-billing,incident-response}.transcript.md` | Present, 13-17KB each, **declared by nothing**              | wire (W2)      |
| `promptlab/evals/*.eval.yaml`                                                              | Seven cases                                                 | add three (W2) |
| `docs/specs/prompt-optimization-harness.spec.md`                                           | Claims the scorer makes DSPy compilation trustworthy        | correct (W3)   |

`scoreExtraction.ts` is listed untouched and that is the load-bearing
claim here. If separating collapse from quality required changing what
a payload scores, every recorded history row would become
incomparable, and the longitudinal record is the only evidence this
project has about whether prompts are improving.

## Target architecture

```ts
// The manifest gains one number and one block.
// collapseFloor: 0.3
// splits:
//   train: [order-management, university-enrollment, ...]
//   dev:   [vendor-onboarding, incident-response]

export interface CaseSummary {
  // ...existing: caseId, runs, mean, worst, samples, failures, sd
  /** Scored samples below the manifest's collapseFloor. */
  readonly collapses?: number;
  /** Mean over samples at or above the floor; absent when none were. */
  readonly qualityMean?: number;
  /** SD over those same samples; absent below two of them. */
  readonly qualitySd?: number;
}
```

`qualityMean` and `qualitySd` are optional and absent when no floor is
declared, so a manifest without one produces today's report byte for
byte.

## Workstreams (each independently shippable)

### 1. Split collapse from quality

Add `collapseFloor` to the manifest, the three per-case fields, and the
rendering. Acceptance: when a suite with a declared floor runs and a
case produces samples both above and below it, the system shall report
a collapse count and a quality mean computed only from the samples
above; and when the manifest declares no floor, the system shall
produce the same report it produces today.

The regression test that matters: replay the recorded
`university-enrollment` samples and assert the quality standard
deviation is materially smaller than the all-sample one. That is the
entire claim of this workstream, and it is checkable without a
provider.

### 2. Ten cases, split train and dev

Author `.eval.yaml` rubrics for the three unused transcripts, declare
them, and add the `splits` block. Acceptance: when the manifest
assigns every case to exactly one split, the loader shall accept it;
when a case is unassigned or listed twice, the loader shall reject it
naming the case; and when a run selects `dev`, only dev cases shall
run and the history row shall say so.

The three rubrics use `must_validate`, `requires_element`, and
`requires_ambiguity` only. Each transcript was written around a
specific resolvable structure, which is what the rubric checks:

| Case                   | The structure it tests                                                                                                  |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `vendor-onboarding`    | Identifier chosen against a tempting decoy (vendor number, not tax ID); a corrected over-claim about review cardinality |
| `subscription-billing` | Composite uniqueness: one active subscription per account per product                                                   |
| `incident-response`    | Disjunctive mandatory: an incident has an alert or a customer report, never neither                                     |

Each is a rule the transcript states, retracts, or sharpens in
dialogue, which is what makes these harder than the seed cases and
therefore worth having.

### 3. Correct the trustworthiness claim

The harness spec says the deterministic scorer is "what makes DSPy
compilation trustworthy". That is true of its determinism and false of
its resolution, and someone is about to build an optimizer on the
stronger reading. Acceptance: when a reader consults the harness spec
before building `optimizer/`, it shall state the measured resolution
and the train/dev requirement.

## API and migration impact

- `SuiteWeights` is unchanged; `collapseFloor` is a sibling field on
  the manifest, not a weight, because it selects a population rather
  than scaling a penalty.
- `CaseSummary` gains three optional fields; `SuiteReport` and
  `HistoryEntry` gain the split name. No existing field changes.
- A manifest without `collapseFloor` or `splits` loads and runs exactly
  as today, so the packaged suite can adopt them one at a time.
- Suite version moves to 1.2.0 when the three cases land, since the
  case set changes what a mean is over. Runs across the version
  boundary are not comparable, which the version is there to signal.

## Open decisions (for review)

- **Where should the floor sit?** 0.3 puts `university-enrollment`'s
  0.000 samples below it and leaves every other recorded sample above,
  which is the split the data suggests. It is also, on seven cases of
  evidence, a number chosen to fit what we have seen. Recommend 0.3
  with the reasoning recorded, and revisit once ten cases have run --
  a floor that never fires is telling you something, and so is one
  that fires everywhere.
- **How should the three new cases be split?** Putting all three in
  dev gives a clean held-out set of exactly the material no prompt has
  ever been tuned against, which is the strongest possible test.
  Putting them in train makes the search better informed. Recommend
  all three to dev for the first round, precisely because
  `haiku45-2` has never seen them: it is the only chance to measure
  overfitting on this suite before optimizing further.
- **Should `--repeat` default change?** It is 1, and a single sample
  resolves nothing. Recommend leaving it, since the run already warns,
  and a silent default that costs five times as much is worse than a
  loud one that costs what it says.
- **Should the seed cases be re-split later?** Seven train and three
  dev is lopsided against the usual advice. Recommend accepting it for
  now: the alternative is moving cases whose scores form the entire
  recorded history, and losing that continuity costs more than the
  imbalance does.

## Risks and testing

- **The floor must not change the composite mean.** A test asserts
  that adding a `collapseFloor` to a manifest leaves `mean`, `worst`,
  and `standardError` identical, so history stays comparable.
- **Absent-versus-zero, again.** A case whose every sample collapsed
  has no quality mean, and reporting 0 would claim it modelled badly
  rather than not at all. Its own test, mirroring the n=1 distinction
  the dispersion module already draws.
- **The new rubrics must be neither trivial nor impossible.** A check
  no extraction can pass adds noise, not signal; the first keyed run
  on the dev split is the evidence, and until then the rubrics are a
  hypothesis. Named here so a disappointing first dev score is read as
  a possible rubric bug rather than only as a prompt failure.
- **The answer-key pins must not move.** `scoreExtraction.test.ts`
  scores recorded payloads and is untouched by any of this.
- Full gate after each workstream: `npm run build`, `test`, `lint`.

## Non-goals

- No change to the composite score, the weights, or the rubric
  vocabulary.
- No new provider call anywhere in the implementation; every acceptance
  criterion above is checkable offline.
- No optimizer.
- No change to the seed suite's seven transcripts or their rubrics.
