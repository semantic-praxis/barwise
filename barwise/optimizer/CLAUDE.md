# optimizer (the DSPy lane)

DSPy prompt optimization for the extraction surface. **Python, offline,
dev-time only.** Not an npm workspace member, not a dependency of
anything, never imported by shipped code.

Its tests **do** run in CI, on changes under `optimizer/` or
`packages/cli/` -- the second because the metric tests shell out to the
real `barwise prompt score`, so a CLI change can break them without
touching a Python file. That is new: the lane ran in no CI at all until
barwise-900, and the guard its spec named -- "executed by hand" -- had
already failed, with the loader round trip red for weeks before anyone
noticed. Nothing else about the dependency rule changes; the lane is
still outside Turborepo and still depends on the workspace only as a
subprocess.

Design and grounding: `docs/specs/dspy-optimizer.spec.md`.
Its parent: `docs/specs/prompt-optimization-harness.spec.md` (workstream 3).

## Dependency Rule

This directory depends on `dspy` and `pyyaml`, and on the `barwise` CLI
**as a subprocess**. It imports nothing from the workspace and nothing
in the workspace imports it. The dependency runs one way and through a
process boundary; there is no build-order relationship, so Turborepo
does not know this directory exists.

Conversely: **nothing here may become a runtime dependency.** If a
capability built here turns out to be needed at run time, it moves into
`@barwise/llm` as TypeScript. That is the same rule that keeps
non-determinism out of `core`, applied one layer further out.

## Layout

```
../pyproject.toml         the project root is `barwise/`, NOT here -- it must be an
                          ancestor of every package or `uv run --frozen`
                          silently resolves nothing (see the repo CLAUDE.md)
../uv.lock                committed -- a run costs money, so pin what produced it
barwise_optimizer/
  barwise_cli.py          THE seam: `prompt schema` / `prompt artifact` / `prompt score`
  dataset.py              evals/ -> dspy.Example, honouring the manifest splits
  program.py              signature + module; schema fetched, never embedded
  metric.py               candidate -> score, plus the rule tallies behind it
  compile.py              optimizer under an explicit budget; writes the run report
  export.py               compiled program -> candidate .prompt.yaml + delta report
tests/                    all offline: no API key, no network
```

## Commands

```sh
uv sync --frozen --extra dev   # install; --frozen honours the committed lock
uv run --frozen --extra dev pytest -q   # the whole suite, offline, ~75s

# A real compilation. Costs money. Requires a key in the environment --
# never pass one as an argument.
uv run --frozen python -m barwise_optimizer.compile \
  --target-model anthropic/claude-haiku-4-5 \
  --optimizer bootstrap --max-calls 200 --samples-per-candidate 5
```

**Prefer `../compile-runner.sh`** for a real run, from `barwise/`. It
does the four free things first -- key present, tree clean, `dist` built,
`pytest` green -- stamps the output so two compiles cannot overwrite each
other, splits the JSON report from the progress stream, and prints which
arm to gate on. Knobs are environment variables:

```sh
export ANTHROPIC_API_KEY=...
./compile-runner.sh                                   # mipro -> sonnet, opus proposer
OPTIMIZER=bootstrap SEED_FROM=default TARGET=anthropic/claude-haiku-4-5 \
  ./compile-runner.sh
```

It refuses rather than guesses, and every refusal is free: no key, a dirty
tree (the candidate's provenance names a commit), a missing proposer for
`mipro`/`gepa`. The `pytest` step is there because nothing else catches a
red test in this lane (barwise-900) and the minute before spending money
is when hand-running pays.

**Rebuild the CLI after pulling.** The seam runs
`packages/cli/dist/index.js` -- built output, not sources -- so a branch
that adds a command still has the previous build on disk until
`npm run build` runs from `barwise/`. That bit once, as
`error: unknown command 'artifact'` mid-compile; `_run` now recognises
commander's wording and says to rebuild instead of passing the raw error
through. `BARWISE_CLI` overrides what gets run.

## Key Conventions

- **One crossing point.** Everything that reaches TypeScript goes
  through `barwise_cli.py`. If something new is needed from that side,
  add it there rather than shelling out from wherever you happen to be.
- **The schema is fetched, never embedded.** `barwise prompt schema`
  answers at run time. A literal pasted here would be right the day it
  was pasted and silently wrong afterwards, describing a shape the
  parser no longer accepts.
- **The compiled program's score is a search signal, never the accepted
  number.** DSPy renders its own field protocol around the instructions
  (`[[ ## extraction ## ]]` and the rest), which production never
  emits. So a candidate is _gated_ by a real `barwise prompt eval`
  before anyone commits it, and the exporter refuses to overwrite a
  shipped artifact.
- **Compile on train, report on dev.** `compile_set()` is train,
  `report_set()` is dev, and there is no way to ask for both while
  compiling. A manifest with no declared `splits` is refused rather
  than defaulted to everything -- compiling against the held-out cases
  produces a number that cannot detect overfitting, and does so
  silently.
- **No library defaults for anything that costs money.** `--max-calls`
  and `--samples-per-candidate` are required, and demos are capped at 2
  rather than DSPy's 4-16. Measured: the system prompt is ~4,540 tokens
  and demo payloads run 1,103-3,851 (mean 1,984), so the library
  default is a 3x to 8x prompt paid on every call of every candidate.
  The exporter enforces a token budget and truncates visibly.
- **The verdict is data, not prose.** `verdict.decide` owns the gate --
  beats / ties / loses / unmeasurable, plus `worth_gating` -- and both
  `report.json` and the delta report render that one decision. It used
  to live only inside the markdown renderer, so acting on it meant
  reading a paragraph, and `compile-runner.sh` grepped that paragraph
  until this landed: a reword would have made the runner print nothing
  and say nothing about it. `unmeasurable` covers the two ways a margin
  exists arithmetically while meaning nothing -- saturation, and a
  missing shipped arm under `--seed-from default`, where treating the
  absent mean as 0.0 would report the candidate beating production by
  its whole score.
- **Say whether the win resolved.** At `repeat=5` the suite's
  resolvable difference is about 0.086. The delta report leads with
  whether the margin cleared it and labels a margin inside the band as
  not evidence, because the mean alone cannot answer that and it is the
  step most likely to be skipped. The **rule tallies** are the more
  useful half: a named rule going from 18 to 4 is a count from the same
  calls, legible where a 0.03 shift in a mean is not.
- **Three arms, because beating the seed is not the bar.** The run
  scores what production would send (`shipped`), the seed it started
  from (`baseline`), and the compiled candidate -- and reports the
  margin over each. `baseline` is the SEED, which under `--seed-from
  minimal` is 90 words, and "baseline" is exactly the word a reader
  takes to mean "what we ship": the 2026-08-29 bootstrap run reported
  0.380 vs 0.355 and read as a near-tie while the shipped prompt scored
  0.814 on those same dev cases, so a candidate that lost to production
  by 0.45 looked like noise (barwise-899). The shipped sweep is skipped
  only when `--seed-from default` makes the baseline the shipped prompt
  already. All three go through the DSPy harness, so they compare to
  each other and **not** to a recorded `barwise prompt eval` row, which
  renders the prompt production's way -- the report says so in place.
- **A candidate must declare a `match` block.** `resolveArtifact`
  filters to artifacts that declare one, so a candidate without it
  loads fine and is then silently skipped -- the gating run measures
  the default while reporting on the candidate. `write_candidate`
  requires it and `match_for_target` derives it from `provider/model`.
- **Gate a candidate with `--artifacts` AND `--artifact-version`.**
  The match block is derived from the target, so a candidate claims the
  same provider and model prefix as the shipped variant for that model -- `--artifacts` alone is therefore genuinely ambiguous and the
  resolver refuses to guess. That refusal is the good outcome; the bad
  one is the report that used to say `--artifacts packages/llm/prompts`,
  which widens the set with the directory the shipped builtins come
  from and measures a shipped variant while the reader believes they are
  gating the candidate (barwise-850, reproduced in an instruction). The
  delta report now prints the candidate's own directory and version,
  and both halves are pinned in `test_run_smoke.py`.
- **A compile says what it is doing, per call.** `make_metric(log,
  progress)` reports every evaluation -- case, score, phase
  (`baseline` / `shipped` / `compile` / `candidate`) and calls spent
  against the ceiling -- to **stderr**, because the run prints its
  result as JSON on stdout. Without it a compile is silent between
  tqdm ticks ~80s apart at sonnet latency, and a healthy run, a
  rate-limited one and a hung one look identical (barwise-897). Every
  return path reports, the two zero-scoring ones included: silence on
  the failure paths is what made the silence dangerous.
- **`--seed-from` decides which prompt the search starts from, and the
  right answer differs by optimizer.** `minimal` is a 137-token summary
  -- right for `mipro`/`gepa`, which propose replacements, because
  seeding them with the shipped 4,540-token prompt biases the search
  toward paraphrases of it. `default` fetches what the target would
  actually be sent today (via `barwise prompt artifact`, keyed on the
  provider/model pair) -- right for `bootstrap`, which never rewrites
  instructions and only selects demos, so from a weak seed it selects
  demos generated _by_ that weak seed and amplifies its defects. The
  first real compilation showed exactly that: `misplaced_is_preferred`
  10 to 70, and a floored score throughout. The seed source is part of
  the candidate's version string, because two seeds are two experiments.
- **The report refuses to compare saturated arms.** `scoreExtraction`
  clamps at zero, so runs whose penalties exceed 1.0 all report 0.000
  however much worse they were -- and the clamping also collapses the
  SD, shrinking `resolvable` so a meaningless margin looks decisive.
  The first real compilation hit it precisely: means of 0.000 and 0.001
  against a manufactured threshold of 0.002. A zero with a rubric that
  still passed something is the evidence of a clamp, and above
  `SATURATION_SHARE` of them the report says the margin means nothing
  and sends the reader to the rule counts.
- **Rule counts need their denominator, and it is not `evaluations`.**
  A run that fails or comes back unparseable is scored 0 and
  contributes **no** tallies -- so an arm with more failures produces
  fewer occurrences of everything and reads as _better_ on every rule
  while being worse per run. The first mipro report did exactly that:
  `binary-missing-inverse-reading` showed 160 to 145, an apparent
  improvement, which was 10.67 to 14.50 per scored run. `MetricLog`
  now carries `scored`, and the report switches to per-run rates and
  says so whenever the two arms scored different numbers of runs.
- **The call ceiling is enforced, and enforcing it took three tries.**
  `--max-calls` originally reached only GEPA's `max_metric_calls`, so
  for `bootstrap` and `mipro` the required flag enforced nothing. It is
  now a `CallBudget` callback counting at `on_lm_start`. Two traps on
  the way: DSPy wraps callbacks in `except Exception` and
  `BootstrapFewShot` wraps each attempt the same way, so
  **`BudgetExceeded` derives from `BaseException`** -- the idiom that
  keeps `KeyboardInterrupt` out of blanket handlers. And `run()`
  restores `dspy.settings.callbacks` in a `finally`, because a second
  run in one process would otherwise still be counting against the
  first run's ceiling.
- **`mipro` costs about 3x `bootstrap`, and two of its defaults do not
  survive a seven-case split.** Measured offline with both models
  stubbed: **103 calls** at `auto='light'` and
  `--samples-per-candidate 5`, against bootstrap's 32. Some of those go
  to the **proposer** model, which is a second, usually dearer model.
  `compile_kwargs` turns off `requires_permission_to_run` (a stdin
  prompt duplicating the `--max-calls` gate, and a hang anywhere
  non-interactive) and `minibatch` (35 samples drawn from a set of
  seven; DSPy's own MIN_MINIBATCH_SIZE is 50).
- **`mipro` needs `optuna`, imported at the optimization step** -- after
  bootstrapping and instruction proposal have been paid for. It is
  declared in `pyproject.toml` and `build_optimizer` checks for it
  anyway, because a stale venv would otherwise lose a dozen paid calls
  to an ImportError.
- **Two DSPy facts that cost a debugging round if unknown.** `MIPROv2`
  reads `dspy.settings.lm` in its constructor and raises without one,
  while `BootstrapFewShot` constructs happily and fails much later --
  `build_optimizer` requires an LM uniformly so the ordering mistake
  does not read as "mipro is broken". And `GEPA` requires a separate
  `reflection_lm`; that is what `--proposer-model` supplies, refused at
  config time so it costs a flag rather than a run.

## Testing

- Framework: pytest, **always through `uv run`**. A bare
  `python3 -m pytest` reports `No module named pytest` because the deps
  live in the uv-managed venv, not in the ambient interpreter -- and that
  error reads exactly like "this machine cannot run the suite", which is
  how it was once written into a commit message as a fact. `uv sync
  --extra dev` then `uv run pytest -q` is the whole story, and
  `../compile-runner.sh` does both as preflight.
- Everything runs offline.
- **Run it before you spend money, because nothing else will.** This
  lane is outside Turborepo and CI by design, so a red test here is
  reported by no one. The loader round trip below sat red from the day
  the haiku45-2 variant shipped until it was noticed by accident weeks
  later; the spec's whole guard is the clause "executed by hand"
  (barwise-900 weighs what should replace it).
- `DummyLM` drives the program end to end -- signature rendering, the
  call, parsing, the metric -- with no key and no network.
- The metric tests run the **real** `barwise prompt score` subprocess
  against the recorded answer-key payloads. Mocking it would test this
  package's idea of the CLI rather than the CLI, and the seam is the
  thing most likely to break.
- `tests/test_run_smoke.py` runs `run()` end to end offline -- compile,
  evaluate, export, report -- and then round-trips the candidate
  through the real `prompt eval --artifacts` to prove the **loader**
  accepts it. That found the missing `match` block; asserting on the
  exporter's own YAML would only have proved this package agrees with
  itself.
- Assertions here have been mutation-checked: twelve deliberate
  breakages, each caught. Two are worth naming. Omitting `match` is
  caught only by the loader round trip. And making `CaseScore.floored`
  always return False was caught by **nothing** until a direct test was
  added -- the report tests supply the floored count as a literal, so
  they assert the consumer and never the computation. That is the
  barwise-840 shape, and a good reason to mutate the _producer_ of any
  value a test feeds in by hand.
