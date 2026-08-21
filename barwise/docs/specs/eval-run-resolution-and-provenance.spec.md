# Make an eval run report its own resolution and say what produced it

Status: Accepted (workstream 1 implemented; see Implementation notes)
Created: 2026-08-21
Last-updated: 2026-08-21
Tracking: barwise-814 (dispersion reporting) and the provenance half of
barwise-813's blocker. Motivated by the workstream 3 note in
`docs/specs/artifact-resolution-in-production.spec.md`, which found
that the recorded runs cannot resolve the differences they were used to
rank.

## Principle

Explicit over implicit. A `SuiteReport` states a mean to three decimal
places and says nothing about how much of that number is sampling
noise, so every reader who has quoted one has implicitly claimed a
precision the run does not have. The samples needed to compute the
precision are already in the report -- `CaseSummary.runs` holds every
score -- so the harness is withholding a number it is holding the
inputs for.

The same gap runs through provenance. A history row records
`artifactVersion` and `suiteVersion`, both of which are authored
strings that a human maintains by hand. Edit `extraction.haiku45.prompt.yaml`
without bumping `version: haiku45-2` and two rows claim the same
artifact while having run different prompts. The row asserts an
identity it cannot check.

Determinism in the core decides where each piece lives. Dispersion is
arithmetic over collected samples, so it belongs in `promptlab`
alongside `mean`. A git SHA is I/O against the working tree, so it
belongs in the CLI and arrives as a caller-supplied value -- the same
seam the "no clocks" rule already draws for the run date.

## Why not just raise `repeat`? (resolved: because the noise is one sample, not a spread)

Raising `repeat` is the obvious response to a noisy mean and it is the
wrong lever here. Working the recorded runs shows the noise is not
distributed across the suite; it is one collapsed sample.

| Run            | SE of suite mean | Variance carried by a single case                  |
| -------------- | ---------------- | -------------------------------------------------- |
| haiku45-2, n=5 | 0.0318           | 77% -- `project-staffing`, one 0.000 among 0.98s   |
| sonnet5-2, n=3 | 0.0398           | 99% -- `university-enrollment`, one 0.167 among 1s |

At those standard errors two configurations must differ by 0.088 and
0.110 respectively before the difference is distinguishable at 95%,
which is larger than every gap that has been used to rank a
configuration in this project. Detecting a 0.02 regression at n=5 would
need roughly n=190 per config -- 1,330 calls per configuration, per
tier.

So the harness should report the resolution rather than let a reader
assume it, and it should name the case carrying the variance rather
than average it away. Both are arithmetic over data already collected;
neither costs an API call. Whether to then split collapse rate from
quality-given-no-collapse is a further question that needs a threshold,
which is a judgment call and is deliberately not in this spec.

## Which identity actually pins a run? (resolved: two, and they answer different questions)

A rendered-prompt hash and a git SHA are not redundant.

- **`promptHash`** answers "was the prompt the same bytes?" It is a
  hash of the rendered system prompt, so it is immune to git state and
  to an unbumped `version:` field. It is the only identifier that
  cannot lie about the prompt.
- **`commit` plus a dirty flag** answers "was the rest of the system
  the same?" The scorer, the suite weights, the reference models, and
  `evaluateCandidate` all move the score without touching the prompt,
  and a hash of the prompt says nothing about them.

The dirty flag is load-bearing, not decoration. A SHA recorded while
the working tree has uncommitted edits names a commit that never
produced that run, and the failure is silent: two rows agree on a SHA
and disagree on what ran. `abc1234-dirty` is honest; `abc1234` on a
modified tree is worse than recording nothing.

## Scope

In scope:

- When a case has two or more scored samples, the system shall report
  the sample standard deviation of that case's scores.
- When a case has fewer than two scored samples, the system shall
  report no standard deviation for it, rather than reporting zero.
- When at least one case has two or more scored samples, the system
  shall report the standard error of the suite mean.
- When some scored case has fewer than two samples, the system shall
  mark the reported standard error as a lower bound.
- When a standard error is reported, the system shall also report the
  smallest difference between two comparable runs that it resolves at
  95% confidence.
- When more than one case carries variance, the system shall report
  which case carries the largest share of it, and that share.
- When a suite runs, the system shall report a hash of the rendered
  system prompt.
- When the CLI records a history row, the system shall record the
  running barwise version, and shall record the git commit and whether
  the working tree was modified when both are determinable.
- When the git commit cannot be determined, the system shall record the
  row without it rather than failing the run.

Out of scope, deferred and named:

- **Splitting collapse rate from quality-given-no-collapse.** The
  strongest available variance reduction, and it needs a threshold for
  what counts as a collapse. That is a judgment call that deserves its
  own spec and its own review.
- **Hashing the suite content.** `suiteVersion` carries the same
  unbumped-string trap as `artifactVersion`, and a `suiteHash` would
  close it. It needs `loadSuite` to retain raw bytes it currently
  discards. See Open decisions.
- **Operational telemetry** -- tokens, latency, cost, retry storms
  across the production surfaces. Filed as barwise-815; this spec
  touches the eval record only.
- **Re-deriving dispersion for already-recorded history rows.** Old
  rows lack per-sample scores, so nothing can be recomputed for them.
  They stay as they are.
- **The t-distribution.** See Open decisions.

## Inventory

| Area                                      | Current state                                                        | Verdict           |
| ----------------------------------------- | -------------------------------------------------------------------- | ----------------- |
| `promptlab/src/run/runSuite.ts`           | Folds `mean`/`worst`/`samples` per case; holds every score in `runs` | modify (W1)       |
| `promptlab/src/stats/dispersion.ts`       | Does not exist; the pure SD/SE fold                                  | new (W1)          |
| `promptlab/src/history/history.ts`        | `HistoryEntry` carries means only; caller supplies the date          | modify (W1,W2,W3) |
| `promptlab/src/index.ts`                  | Public barrel                                                        | modify (W1)       |
| `cli/src/commands/prompt.ts`              | `renderReport` prints mean/worst; builds the history entry           | modify (W1,W3)    |
| `cli/src/workspace/provenance.ts`         | Does not exist; resolves version, commit, dirty                      | new (W3)          |
| `cli/src/commands/history.ts`             | Already shells out to git via `execFileSync`; the pattern to reuse   | untouched         |
| `cli/src/index.ts`                        | Reads `version` from the CLI's own package.json                      | untouched         |
| `promptlab/evals/history.jsonl`           | Not checked in; produced by keyed runs                               | untouched         |
| `promptlab/tests/scoreExtraction.test.ts` | Pins answer-key scores; must not move                                | guard             |

The scorer is untouched deliberately. Nothing in this spec changes what
a payload scores; it changes what a run says about the scores it
already produced. If `scoreExtraction.test.ts` moves, the change
reached further than intended.

`cli/src/commands/history.ts` is listed as untouched but is the reason
workstream 3 is cheap: `barwise history` already runs git through
`execFileSync` with a helper that turns a failure into a message. The
new provenance helper follows it rather than inventing a second way to
call git.

## Target architecture

```ts
// promptlab/src/stats/dispersion.ts -- pure, no I/O, no clock
export interface Dispersion {
  /** SE of the suite mean; absent when no case has 2+ samples. */
  readonly standardError?: number;
  /**
   * True when some scored case had fewer than 2 samples. Its variance
   * is unknown and counted as zero, so the standard error understates.
   */
  readonly lowerBound: boolean;
  /** Smallest gap between two comparable runs resolvable at 95%. */
  readonly resolvableDifference?: number;
  /** The case carrying the largest share of total variance. */
  readonly dominantCase?: { readonly caseId: string; readonly share: number; };
}

export function sampleSd(scores: readonly number[]): number | undefined;
export function dispersionOf(
  cases: readonly { caseId: string; sd?: number; samples: number; }[],
): Dispersion;
```

`CaseSummary` gains `sd?: number`. `SuiteReport` gains
`dispersion: Dispersion` and `promptHash: string`. `HistoryEntry` gains
`promptHash`, an optional `standardError`, optional per-case `sd`, and
an optional `build` block:

```ts
readonly build?: {
  readonly version: string;      // always known to the CLI
  readonly commit?: string;      // absent outside a git checkout
  readonly dirty?: boolean;      // absent when commit is absent
};
```

`build` is separate from `promptHash` because they have different
authors: `promptHash` is computed by `promptlab` from bytes it rendered,
`build` is handed in by the caller like the date. Keeping the seam
visible in the shape is the point -- a reader can tell which fields the
package vouches for.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Workstream 1 is the one that gates
the measurement round; 2 and 3 could land in either order after it.

### 1. Report dispersion

Add the pure fold, wire it into `runSuite`, carry it into the history
entry, and print it. Acceptance: when a suite runs with `repeat` of 2
or more and every case is scored, the system shall report a standard
error greater than zero and a resolvable difference derived from it;
and when a suite runs with `repeat` of 1, the system shall report no
standard error rather than zero.

The rendered line is part of the deliverable, not a nicety. The defect
this closes is people quoting a mean without an error bar, and a number
that appears only in `--format json` does not close it:

```
suite 1.1.0  artifact=haiku45-2  mean=0.916 +/- 0.062 (95%, n=5)  worst=0.000
  gaps below 0.088 are not resolvable at this sample size
  77% of variance is project-staffing
```

### 2. Hash the rendered prompt

Hash the system prompt `runSuite` already builds, put it on the report
and the history row. Acceptance: when two runs render byte-identical
system prompts, the system shall report equal prompt hashes; and when a
variant's instructions change without its `version` changing, the
system shall report different prompt hashes.

That second criterion is the whole reason this workstream exists, and
it is testable without a provider: render two artifacts that differ
only in body text, and assert the hashes diverge while
`artifactVersion` agrees.

### 3. Record what built the run

Add the CLI-side provenance helper and pass its result into
`toHistoryEntry`. Acceptance: when the CLI records a history row from
inside a git checkout, the system shall record the commit and the
working tree's modified state; and when git is unavailable or the
directory is not a checkout, the system shall record the row with the
version alone and shall not fail the run.

The failure mode to test explicitly is the second one. An eval run
costs money; a missing `git` binary must never be what loses it.

## API and migration impact

- `@barwise/promptlab` gains `Dispersion`, `sampleSd`, `dispersionOf`.
  `CaseSummary`, `SuiteReport`, and `HistoryEntry` gain fields; no
  existing field changes meaning or type.
- `SuiteReport.dispersion` and `SuiteReport.promptHash` are required on
  the report, so any code constructing a `SuiteReport` by hand updates.
  Inside the repo that is test fixtures only; `runSuite` is the sole
  production constructor.
- `HistoryEntry`'s new fields are all optional, so `readHistory` parses
  every existing row unchanged. Rows written before this spec simply
  carry no dispersion and no build block, which is the truth about
  them.
- `toHistoryEntry` gains one optional argument on its existing options
  object. Existing callers compile unchanged.
- No package gains a dependency. The hash uses `node:crypto`; the git
  calls use `node:child_process`, both already used in the packages
  that will call them.

## Open decisions (for review)

- **Normal approximation versus the t-distribution.** The 1.96
  multiplier assumes a normal sampling distribution, which at n=5 per
  case is mildly optimistic -- the true interval is a little wider.
  Using a t-quantile means carrying a table or an approximation for a
  correction that does not change any decision we currently face, since
  the observed gaps are three to ten times smaller than the threshold
  either way. Recommend the normal approximation, documented as such in
  the rendered output's footnote rather than buried in code.
- **What `resolvableDifference` assumes about the other run.**
  Comparing two runs, the standard error of the difference is
  `sqrt(SE_a^2 + SE_b^2)`. Reporting a single number from one run means
  assuming the other has comparable dispersion. Recommend reporting it
  anyway with `SE * sqrt(2)`, because the operator's actual question is
  "is this gap real" and making every reader do the algebra is how the
  error bar gets dropped again. The alternative is to report only the
  standard error and add a `barwise prompt compare` that does the
  two-run arithmetic honestly -- better, and bigger than this spec.
- **Whether to hash the suite as well as the prompt.** `suiteVersion`
  has exactly the unbumped-string problem `promptHash` exists to fix,
  and a rubric edit moves scores as surely as a prompt edit. Closing it
  means `loadSuite` retaining the raw bytes of the manifest and every
  case file. Recommend deferring: everyone running evals today is in a
  git checkout, so workstream 3's commit and dirty flag already catch a
  rubric edit. Revisit if evals ever run from a published package.
- **Whether `repeat: 1` should warn.** A single-sample run can resolve
  nothing, and `repeat` defaults to 1. The harness could print a line
  saying so on every default-repeat run. Recommend yes, on stderr, and
  only when history is being recorded -- a one-off exploratory run
  should not be nagged, but a row that will be compared against later
  should say what it cannot support.

## Risks and testing

- **The dispersion arithmetic must be tested against known inputs, not
  against a mock provider.** That is why the fold is its own module:
  `sampleSd([1,1,1])` is 0, `sampleSd([1])` is undefined, and a
  hand-computed suite standard error can be asserted exactly. A test
  that only runs a mock client through `runSuite` would not catch a
  wrong denominator.
- **The n=1 case is the one to get right.** Reporting `sd: 0` for a
  single sample claims perfect precision and is the exact failure this
  spec exists to prevent. It needs its own test at both the case level
  and the suite level.
- **Answer-key pins must not move.** `scoreExtraction.test.ts` grades
  recorded payloads and does not depend on dispersion or provenance. If
  one moves, the change reached further than intended.
- **Provenance must not be able to fail a run.** Test the not-a-repo
  path directly, by pointing the helper at a temp directory outside any
  checkout.
- Full gate after each workstream: `npm run build`, `test`, `lint` from
  `barwise/`.

## Implementation notes

### Workstream 1 (2026-08-21)

Shipped as specified, with all four Open decisions resolved by the
reviewer as recommended: normal approximation kept, the resolvable
difference reported rather than left as algebra for the reader, the
suite hash deferred on the strength of version control, and a stderr
line on an unresolvable run.

One deviation, deliberate:

- **`dominantCase` is reported whenever any variance exists**, not only
  "when more than one case carries variance" as Scope says. The
  single-varying-case run is the most informative one to name -- the
  recorded Sonnet run had 99% of its noise in one case -- so suppressing
  the report exactly there would have withheld the finding that
  motivated the field. The CLI still prints it only above a 50% share,
  because naming a case that carries a third of the noise is not
  actionable.

Worth knowing for workstreams 2 and 3:

- **`marginOfError` takes a standard error, not a `Dispersion`.** The
  spec's sketch had it take the whole object, which does not serve
  `barwise prompt history` -- a recorded row carries the error and
  nothing else. Passing the number keeps `Z95` defined once; a caller
  multiplying by 1.96 itself is a caller who will silently drift to a
  different confidence level than the runner reports.
- **A zero standard error and an absent one are different results**, and
  the code distinguishes them: every sample scoring identically is a
  real measurement of a stable configuration, while one sample per case
  measured nothing. Both were nearly collapsed into `0` during
  implementation; a test now pins each.
- **`repeat` still defaults to 1**, so the common invocation is the one
  that resolves nothing. The stderr note fires only when a history row
  is being written, per the Open decision, but the default itself is
  worth revisiting when workstream 3 lands.

## Non-goals

- No change to what a payload scores. The scorer, the weights, and the
  rubric vocabulary are untouched.
- No new API calls, and no change to how many the harness makes.
- No collapse threshold, and no re-weighting of the mean to discount
  outliers.
- No change to the retry policy or the complete/incomplete distinction
  that governs whether a row is recorded at all.
