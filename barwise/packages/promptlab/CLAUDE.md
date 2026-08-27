# @barwise/promptlab

Deterministic prompt evaluation for the LLM surfaces
(`docs/specs/prompt-optimization-harness.spec.md`). An eval case pairs
a fixture transcript with a rubric of semantic checks (the modeling
gym's `GymCheck` vocabulary) and a reference model; the scorer grades
an extraction payload through the exact production parse path. The
offline DSPy optimizer lane consumes the same scorer through
`barwise prompt score`.

## Dependency Rule

Depends on `@barwise/core` (validation, serialization), `@barwise/llm`
(prompt construction, extraction parsing, conformance), `@barwise/learn`
(`evaluateCandidate` and the check vocabulary), and `yaml`. ZERO
dependencies on VS Code. `@barwise/cli` (`barwise prompt`) consumes
this package; it must never depend on the CLI.

## Package Layout

```
src/
  evalcase/    EvalCase/EvalSuite types; the GymCheck | PromptCheck
               check union; loadSuite (manifest + declared cases, no
               directory discovery)
  score/       scoreExtraction: payload -> parse -> conformance ->
               validation count -> evaluateCandidate fold -> CaseScore
               promptChecks: the payload-side check runners
               (requires_ambiguity) and the ambiguity-excess count
  run/         runSuite: cases x repeat through an LlmClient with the
               active prompt artifact
  history/     JSONL score history (append/read; caller supplies dates)
  index.ts     Public API barrel

evals/         The packaged seed suite: suite.yaml (weights + declared
               case list), *.eval.yaml, *.transcript.md, and
               *.reference.orm.yaml for the train split. history.jsonl
               appears here only after a recorded eval run; none is
               checked in (docs/local-eval-runbook.md states the same,
               and this file used to contradict it -- barwise-873)
tests/         Vitest; fixtures/responses/ holds the recorded payloads
               that double as the suite's answer keys
```

## Key Conventions

- **The scorer is pure and deterministic.** Same payload, case, and
  weights give a byte-identical `CaseScore`. All I/O lives in the
  loader, the runner, and the history writer. The LLM call in
  `runSuite` is the only non-determinism; a score is a sample, and
  `repeat` controls the sample count.
- **Score = rubric fraction minus declared penalties.** Weights (per
  conformance correction, per residual validation error) come from the
  suite manifest, never from code, so reweighting is a data change.
- **Penalties are rates, not counts** (suite 2.0.0,
  `docs/specs/eval-split-stratification.spec.md`). `scoreExtraction`
  divides each rule's occurrence count by the scored model's
  `elementCount` -- object types plus fact types -- before applying the
  weight, so a weight reads as _the cost of a model in which every
  element carries that kind of defect_. Counted absolutely, the penalty
  side grew with transcript length while the rubric side stayed a
  fraction in [0, 1], and three of four recorded compilation arms
  floored at 0.000 where the clamp discards every difference. One
  denominator serves every rule on purpose: per-rule denominators would
  make each new validator rule a promptlab change. `ambiguityExcess` is
  the exception and stays unrated -- it is charged against a per-case
  authored budget, so it is a rate already. A model with no elements
  charges nothing rather than dividing by zero.
- **`elementCount` is recorded, not recomputed.** It is on `CaseScore`
  for the reason `MetricLog.scored` exists: a denominator each consumer
  derives for itself is one two consumers will eventually derive
  differently. It is also the tripwire on what rating leaves unpunished
  -- a candidate whose mean `elementCount` climbs alongside its score is
  inflating its own denominator.
- **A weight's meaning is versioned; its type is not.** `SuiteWeights`
  looked identical before and after rating, so nothing a compiler sees
  distinguishes a count-era manifest from a rate-era one. The manifest
  `version` is the only signal, which is why `loadSuite` defaults the
  omittable weights to the 2.0.0 values rather than to 0, and why a
  re-fit is a version bump rather than a tweak.
- **Two check families, one fraction.** A case may declare `GymCheck`s,
  which `@barwise/learn` grades against the parsed model, and
  `PromptCheck`s, which promptlab grades against the extraction payload
  (`docs/specs/eval-transcript-realism.spec.md`). The scorer partitions
  by family, runs each grader, and reassembles the results in authored
  order. A payload check never reaches `evaluateCandidate` -- it takes
  an `OrmModel` and has no vocabulary for the payload -- which is why
  the family lives here and not in `learn`.
- **`requires_ambiguity` needs its budget.** The check alone is won by
  an extraction that flags everything, so a case that declares one
  should declare an `ambiguityBudget`, and the suite an
  `ambiguityExcess` weight. A missing budget means unbounded, which is
  what every case authored before the field meant; a missing weight now
  means the 2.0.0 default rather than 0.
- **Answer-key invariant.** Each case's recorded payload in
  `tests/fixtures/responses/` must pass its full rubric; the exact
  scores are pinned in `tests/scoreExtraction.test.ts`. Changing a
  rubric, reference, or the scorer shows up as a visible diff there.
- **References are generated, not hand-written, and now something
  enforces it.** `renderReference` runs a recorded payload through
  `parseExtractionFromJson` and serializes the result;
  `npm run regen:references` writes every case that has a payload, and
  `tests/referenceDrift.test.ts` fails when a committed reference stops
  matching a fresh render.

  This was a rule with no implementation for the suite's whole life, and
  it had drifted: the regenerator's first run found
  `freight-corrections` missing a `sample: true` the parser has emitted
  since the sample-populations work. Nothing caught it because a
  reference is consumed by `forbids_population`, which asks about
  constraints and never reads populations -- so the stale field changed
  no score and produced no symptom.

  `withDeterministicIds` is what makes the guard exact rather than
  approximate: ids are minted fresh on every parse, so without a fixed
  generator only structure could be compared. It restores the previous
  generator in a `finally`, because `setIdGenerator` is process-wide and
  a leak would leave every later test in the worker minting fixture ids
  while still passing.

  A drift failure means one of two things and they call for opposite
  responses: the parse path changed and the references should be
  regenerated, or the parse path regressed and the diff is the bug
  report.
- **No client-derived material in `evals/`.** Transcripts and fixture
  models are invented domains, always. Everything here is checked in,
  published in the npm package, and read by anyone who clones the repo,
  so this is a property of the directory rather than a judgment call per
  file. Recommended in `docs/specs/eval-transcript-realism.spec.md` and
  settled in `docs/specs/eval-split-stratification.spec.md`.
- **A mean is reported with its error bar or not at all.** `runSuite`
  folds per-case sample SD and the suite's standard error through
  `src/stats/dispersion.ts`, and the CLI prints the 95% margin beside
  every mean it renders, including in `barwise prompt history`. Below
  two samples the SD is **undefined, never 0** -- one observation says
  nothing about spread, and a 0 propagates into a standard error
  claiming perfect precision. That distinction is the whole point of
  the module; guard it if you touch the fold.
- **Dispersion is pure, so it is tested against known inputs.** The
  formulas live in their own module rather than inline in the runner
  because a wrong denominator yields a plausible number that a
  mock-client test walks straight past. `tests/dispersion.test.ts`
  pins the n-1 denominator and reproduces the recorded Haiku run's
  standard error, so a change to the fold contradicts the report it
  was derived from.
- **The suite is split, and dev is held out.** `suite.yaml` assigns
  every case to `train` or `dev`, and the loader rejects a manifest
  that leaves one unassigned -- a case that quietly joins train is a
  case that can no longer detect overfitting. The three dev cases have
  never been tuned against, which is the only honest test of whether a
  prompt variant generalises. `runSuite({split})` and
  `barwise prompt eval --split` select one half.
- **A collapse is not a bad score.** `collapseFloor` in the manifest
  separates "did the extraction survive" from "how good was it when it
  did", reported per case as `collapses`, `qualityMean`, `qualitySd`.
  It never changes `mean`, so every recorded history row stays
  comparable -- search on the composite, gate on the pair. Below the
  floor for every sample means **no** quality mean rather than zero.
- **A run can say what it is doing.** `runSuite({onProgress})` emits a
  `sample` event per call and a `retry` event before each backoff; the
  CLI renders them to stderr behind `barwise prompt eval --verbose`, so
  `--format json` stays a clean pipe. Omitted, the run is silent, which
  is what every caller before it got. The retry event is the one that
  earns its keep: a rate-limited sweep and a hung one are otherwise
  indistinguishable for as long as the backoff lasts.
- **Three kinds of bad run, and only one of them is a score.** A call
  the provider never answered is excluded (barwise-806). A payload the
  production parse path rejects is a real zero. A payload cut off at
  the output-token ceiling is **excluded**, because what it measures is
  the caller's budget, not the prompt. The third is the dangerous one:
  it raises no error at all, since a truncated tool_use block arrives
  as well-formed JSON holding whatever fields completed. It scored
  0.000, 0.000 and 0.133 on the dev split before anything said why.
  `runSuite` derives a per-case budget from the transcript
  (`suggestMaxTokens`), reports `truncations` apart from `failures`,
  and labels the run `failureKind: "truncated"` -- the two call for
  opposite responses, one "look at the provider" and the other "raise
  `--max-tokens` and re-run".
- **Keep what the provider said, especially when nothing went wrong.**
  `CaseRun` carries `stopReason`, `promptTokens`, `outputTokens`, and
  the `maxTokens` the call was given, plus `status`, `errorType` and
  `requestId` on a failure. The token pair is the point: equal values
  are a truncation, and a _near_-equal pair on a healthy run is the
  only warning that the next slightly longer transcript will not fit,
  which is why it is recorded and rendered when nothing is wrong. The
  request id is worth keeping precisely because it is useless locally
  -- it is the only handle on a call that has already happened when
  asking the provider about it.
- **A penalty is named, never only counted.** `CaseScore` carries
  `warningsByRule`, `errorsByRule` and `correctionsByCategory`; the
  `SuiteReport` sums all three and the history row records all three.
  The error tally was the one missing, and it cost the most: an error
  weighs 0.8 against a warning's 0.4, so the record named the cheaper
  signal and counted the dearer one -- which is how "did the ring-player
  fix move the baseline" became a question only a paid re-run could
  answer. The corrections tally then turned out to matter most of all:
  on the recorded answer keys **all fourteen corrections were one
  category**, `orphaned_reference_mode`, which was the entire gap
  between those payloads and 1.0 and was invisible behind a lump count.
  That check is now gone (barwise-839) and the answer keys score exactly
  1.000, which is the tally's best argument for itself: a lump count
  would have shown a stable 0.94-0.98 forever and named nothing to fix.

  **All of them or none** if you add a fourth: a tally in the scorer
  without one in the history row repeats the defect one level up, which
  is exactly how warnings and errors came to differ. The rule tallies
  share one helper for the same reason.
- **Two identifiers pin a run, and they answer different questions.**
  `promptHash` (`src/provenance/promptHash.ts`) fingerprints the
  rendered system prompt, so it catches a variant edited without its
  `version:` being bumped -- which `artifactVersion`, a hand-maintained
  string, cannot. `HistoryEntry.build` carries the barwise version, git
  commit, and whether the tree was modified, which is what covers the
  scorer, weights, and reference models: all of those move a score
  without touching a prompt. Neither substitutes for the other.
- **No clocks.** History entries take their date from the caller (the
  CLI); nothing in this package reads the system time. Provenance that
  needs I/O -- a git SHA, the running version -- follows the same seam
  and arrives from the caller as `build`. The prompt hash is the
  exception that proves the rule: it is pure, computed here from bytes
  this package rendered.
- Live LLM runs happen only through `barwise prompt eval` with keys
  configured; CI tests use mock clients and canned payloads, per the
  `llm` package convention.

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check
```

Lint and format run from the repo root (`npm run lint`, `npm run fmt`).
