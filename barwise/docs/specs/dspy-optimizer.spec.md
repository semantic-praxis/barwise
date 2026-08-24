# The DSPy optimizer lane

Status: Implemented
Created: 2026-08-23
Last-updated: 2026-08-23
Tracking: barwise-843. Workstream 3 of
`docs/specs/prompt-optimization-harness.spec.md`, which has carried it
as "provisional: not yet grounded" since 2026-08-08.

## Principle

Determinism in the core, and non-determinism one layer out -- taken to
its conclusion. The optimizer is the most non-deterministic thing this
repository will ever run, so it lives furthest out: a separate Python
project, outside the npm workspace, never imported, never in CI, never
on the runtime path. Nothing it produces is trusted on its own word;
what it emits is a _candidate_, and the acceptance gate is the same
`barwise prompt eval` a human would run by hand.

Orthogonality decides the seam. The Python lane crosses to TypeScript
only through two subprocess calls -- `barwise prompt schema` and
`barwise prompt score` -- which already exist as ordinary commands for
anyone to call. There is no shared library, no FFI, and no second copy
of the schema or the scorer.

## Grounding (the notes the harness spec asked for, now measured)

The harness spec named three things to confirm before building. All
three were checked, and two changed the design.

**1. DSPy installs and carries the optimizers.** `dspy 3.3.1` under
`uv`, with `BootstrapFewShot`, `BootstrapFewShotWithRandomSearch`,
`MIPROv2`, `GEPA` and `COPRO` all present.

**2. DSPy's rendering is not production's rendering -- confirmed, not
assumed.** A signature rendered offline produces DSPy's own field
protocol wrapped around the instruction text:

```
Your input fields are:
1. `transcript` (str):
...
[[ ## extraction ## ]]
{extraction}
In adhering to this structure, your objective is:
        <the instructions>
```

Production renders none of that scaffolding. So the compiled program's
own score is a **search signal only**, and the number that decides
adoption always comes from `barwise prompt eval` through the real path.
The instruction text is cleanly recoverable (`Signature.instructions`),
which is exactly the part the optimizers rewrite and the part the
exporter writes into a `.prompt.yaml`.

**3. Demos do not fit naively, and this is the finding that changes
most.** Measured against the recorded payloads:

|                          | tokens (approx) |
| ------------------------ | --------------- |
| extraction system prompt | 4,540           |
| smallest demo payload    | 1,103           |
| mean demo payload        | 1,984           |
| largest demo payload     | 3,851           |

`BootstrapFewShot` defaults to 4-16 demos. At the mean that is
**8,000-32,000 tokens of demos on a 4,540-token prompt** -- a 3x to 8x
prompt, paid on every call of every candidate evaluation, before the
transcript. Three demos alone more than double it.

So the exporter enforces a demo budget in tokens and truncates
payloads to fit, and the compile step caps `max_bootstrapped_demos`
rather than taking the library default. A default that quietly
octuples the prompt is not a default this repository can accept.

## The resolution problem, built in rather than argued about

The scorer is deterministic; its _resolution_ is not unlimited, and
DSPy is the technique most sensitive to that. Measured: at `repeat=5`
the resolvable difference is about 0.086. Recorded variant-vs-default
gaps were 0.103 (n=3) and 0.072 (n=5) -- the variant led both times,
neither resolvably. Resolving 0.03 needs n=45 per configuration.

An optimizer selecting among candidates on differences below that
threshold is selecting noise. Rather than leave the operator to
discover this, the lane reports it:

- `compile.py` takes an explicit call budget and samples-per-candidate,
  never a library default, and refuses to start without them.
- Every run writes a **run report** naming the samples per candidate,
  the implied resolvable difference at that sample count, and whether
  the winning margin exceeded it. A margin inside the noise band is
  labelled as such.
- The metric records the per-evaluation **rule tallies**
  (`errorsByRule`, `warningsByRule`, `correctionsByCategory`) alongside
  the float, so the delta report can say _which named rule moved_.
  A rule count going from 18 to 4 is a far lower-variance observation
  than a 0.03 shift in a mean, and it is available from the same calls.

This is the honest form of the harness spec's claim that the scorer
"makes DSPy compilation trustworthy": it is trustworthy about
determinism, and the run report is what keeps it from being read as a
claim about resolution.

## Scope

In scope, as `optimizer/` (uv-managed, outside the npm workspace):

- `barwise_cli.py` -- the only crossing point: subprocess wrappers for
  `barwise prompt schema` and `barwise prompt score`.
- `dataset.py` -- read `packages/promptlab/evals/` into DSPy examples,
  honouring the manifest's `splits`. Compile on **train** only.
- `program.py` -- the extraction signature and module, its schema
  fetched from the CLI, never hand-copied.
- `metric.py` -- candidate payload to a temp file, out to
  `barwise prompt score`, back as a float plus the rule tallies.
- `compile.py` -- optimizer selection and configuration under an
  explicit budget; writes the run report.
- `export.py` -- compiled program to a candidate `.prompt.yaml` with
  provenance, plus a delta report. Never writes over an active
  artifact.
- Tests that run with **no API key and no network**, using DSPy's
  `DummyLM` for the program and the recorded payloads for the metric.

Out of scope, deferred and named:

- **Running a real compilation.** This spec builds the lane; spending
  money on it is a separate, human act. The run report exists so that
  when someone does, the result says what it can support.
- **CI execution.** The npm workspace does not know this directory
  exists, and Turborepo does not run it. Its tests are run by hand from
  `optimizer/`.
- **The review surface.** `prompt schema --surface review` exists, but
  only extraction has an eval suite, so only extraction has a metric.
- **Automatic adoption.** The exporter writes a candidate. Adoption is
  re-running `barwise prompt eval`, reading the delta, and committing
  -- unchanged from the harness spec.

## Inventory

| Area                        | Current state                              | Verdict |
| --------------------------- | ------------------------------------------ | ------- |
| `optimizer/`                | Does not exist                             | add     |
| `barwise prompt schema`     | Prints the extraction schema (11.5 KB)     | none    |
| `barwise prompt score`      | Prints `CaseScore` JSON incl. rule tallies | none    |
| `packages/promptlab/evals/` | Cases, transcripts, `splits`               | none    |
| `packages/llm/prompts/`     | Where a candidate lands                    | none    |
| `.gitignore`                | No Python entries                          | modify  |

Nothing in TypeScript changes. If this spec had required a change
there, the seam would be wrong.

## Risks and testing

- **A lane that cannot be exercised without paying.** The failure that
  has cost this project most, and the reason `barwise-841` exists.
  Every module here is testable offline: `DummyLM` drives the program
  end to end, `run()` itself is smoke-tested end to end, and the metric
  runs against recorded payloads whose scores are already pinned in
  `promptlab`. A contributor can change this code and know whether it
  works. 55 tests, about a minute, no key and no network.

  Mutation-checked: eight deliberate breakages -- the demo budget, the
  truncation marker, the clobber refusal, train/dev disjointness, the
  noise-band branch, the sample floor, the omitted `match`, and the
  schema back in the instructions -- each caught, and the last two only
  by the smoke test and the loader round trip.
- **The schema drifting from production.** Prevented by construction:
  the schema is fetched from `barwise prompt schema` at run time, and
  a test asserts the fetch happens rather than a literal being read.
- **Optimizing against the held-out set.** `dataset.py` reads the
  manifest's `splits` and `compile.py` takes train only; the dev split
  is reported on, never compiled against. A test asserts a compile
  dataset contains no dev case.
- **A candidate silently replacing a shipped artifact.** The exporter
  refuses to write a path that already exists unless told to, and
  writes provenance naming the optimizer, the proposer model, the
  target model, the suite version and the date.
- **Two bugs found by smoke-running the compile path, both of which
  would have surfaced only after a paid compilation.** They are worth
  naming because neither is visible from reading the code:

  1. The exported instructions carried the 11.5 KB schema, making the
     candidate 20 KB and duplicating in every request what production
     already sends as the extraction tool's `input_schema`. The schema
     moved to the output field's description, where the adapter still
     renders it, the optimizers leave it alone, and `instructions`
     stays the prose the exporter writes. Handing MIPROv2 a schema to
     paraphrase would have spent the search on the one part that must
     stay exact.
  2. The candidate had **no `match` block**, and `resolveArtifact`
     filters to artifacts that declare one -- so the candidate loaded
     without complaint and was then silently skipped. The operator
     would have read "Using the default prompt artifact." while
     believing they had just gated the candidate they paid to compile.
     `match` is now required and derived from the target model.

  The second is the same failure class as barwise-842, one layer out:
  a resolution that quietly falls back and reports success. It was
  found by round-tripping an export through the real loader rather than
  by asserting on the exporter's own YAML, which would only have proved
  this package agrees with itself. That round trip is now a test.
- **Demo blowup.** Covered above; the exporter enforces a token budget
  and a test asserts an oversized demo set is truncated rather than
  emitted.
- Gate: the TypeScript gate is unaffected. The Python lane has its own
  `pytest` run, executed by hand.

## Non-goals

- No change to `@barwise/promptlab`, `@barwise/llm`, or the CLI.
- No DSPy dependency anywhere in the npm workspace.
- No change to the shipped prompt artifacts.
