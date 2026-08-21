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
               case list), *.eval.yaml, *.transcript.md,
               *.reference.orm.yaml, history.jsonl (checked-in record)
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
  `ambiguityExcess` weight. Both default to unbounded/0, which is what
  every case authored before the field meant.
- **Answer-key invariant.** Each case's recorded payload in
  `tests/fixtures/responses/` must pass its full rubric; the exact
  scores are pinned in `tests/scoreExtraction.test.ts`. Changing a
  rubric, reference, or the scorer shows up as a visible diff there.
- **References are generated, not hand-written.** The seed references
  were produced by running the recorded payloads through
  `parseExtractionFromJson` and serializing -- they cannot drift from
  what the pipeline actually builds.
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
