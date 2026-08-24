# optimizer (the DSPy lane)

DSPy prompt optimization for the extraction surface. **Python, offline,
dev-time only.** Not an npm workspace member, not a dependency of
anything, never imported by shipped code, never run in CI.

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
pyproject.toml            uv-managed; dspy pinned exactly
uv.lock                   committed -- a run costs money, so pin what produced it
barwise_optimizer/
  barwise_cli.py          THE seam: subprocess to `prompt schema` / `prompt score`
  dataset.py              evals/ -> dspy.Example, honouring the manifest splits
  program.py              signature + module; schema fetched, never embedded
  metric.py               candidate -> score, plus the rule tallies behind it
  compile.py              optimizer under an explicit budget; writes the run report
  export.py               compiled program -> candidate .prompt.yaml + delta report
tests/                    all offline: no API key, no network
```

## Commands

```sh
uv sync --extra dev        # install
uv run pytest -q           # the whole suite, offline, ~9s

# A real compilation. Costs money. Requires a key in the environment --
# never pass one as an argument.
uv run python -m barwise_optimizer.compile \
  --target-model anthropic/claude-haiku-4-5 \
  --optimizer bootstrap --max-calls 200 --samples-per-candidate 5
```

The tests require the CLI to be **built** (`npm run build` from
`barwise/`), because the seam runs `packages/cli/dist/index.js`.
`BARWISE_CLI` overrides what gets run.

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
- **Say whether the win resolved.** At `repeat=5` the suite's
  resolvable difference is about 0.086. The delta report leads with
  whether the margin cleared it and labels a margin inside the band as
  not evidence, because the mean alone cannot answer that and it is the
  step most likely to be skipped. The **rule tallies** are the more
  useful half: a named rule going from 18 to 4 is a count from the same
  calls, legible where a 0.03 shift in a mean is not.
- **A candidate must declare a `match` block.** `resolveArtifact`
  filters to artifacts that declare one, so a candidate without it
  loads fine and is then silently skipped -- the gating run measures
  the default while reporting on the candidate. `write_candidate`
  requires it and `match_for_target` derives it from `provider/model`.
- **Two DSPy facts that cost a debugging round if unknown.** `MIPROv2`
  reads `dspy.settings.lm` in its constructor and raises without one,
  while `BootstrapFewShot` constructs happily and fails much later --
  `build_optimizer` requires an LM uniformly so the ordering mistake
  does not read as "mipro is broken". And `GEPA` requires a separate
  `reflection_lm`; that is what `--proposer-model` supplies, refused at
  config time so it costs a flag rather than a run.

## Testing

- Framework: pytest. Everything runs offline.
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
- Assertions here have been mutation-checked: eight deliberate
  breakages (demo budget, truncation marker, clobber refusal, train/dev
  disjointness, the noise-band branch, the sample floor, the omitted
  `match`, and the schema back in the instructions), each caught.
