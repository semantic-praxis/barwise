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
  evalcase/    EvalCase/EvalSuite types; loadSuite (manifest + declared
               cases, no directory discovery)
  score/       scoreExtraction: payload -> parse -> conformance ->
               validation count -> evaluateCandidate fold -> CaseScore
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
- **Answer-key invariant.** Each case's recorded payload in
  `tests/fixtures/responses/` must pass its full rubric; the exact
  scores are pinned in `tests/scoreExtraction.test.ts`. Changing a
  rubric, reference, or the scorer shows up as a visible diff there.
- **References are generated, not hand-written.** The seed references
  were produced by running the recorded payloads through
  `parseExtractionFromJson` and serializing -- they cannot drift from
  what the pipeline actually builds.
- **No clocks.** History entries take their date from the caller (the
  CLI); nothing in this package reads the system time.
- Live LLM runs happen only through `barwise prompt eval` with keys
  configured; CI tests use mock clients and canned payloads, per the
  `llm` package convention.

## Commands

```sh
npx vitest run              # run tests
npx tsc --noEmit            # type-check
```

Lint and format run from the repo root (`npm run lint`, `npm run fmt`).
