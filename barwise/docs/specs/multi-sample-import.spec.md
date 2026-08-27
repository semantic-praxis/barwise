# Multi-sample transcript import: run-to-run disagreement becomes declared ambiguity

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-08-27
Last-updated: 2026-08-27
Tracking: barwise-877. Motivated by the run-to-run dispersion the eval
lane measures (`docs/prompt-eval-2.0.0-haiku45-2026-08-26.md`, repeat 5)
and the question of what that observation licenses in production.
Sibling: `docs/specs/eval-name-licensing.spec.md` (whose workstream 3
this feature feeds evidence to); harness workstream 6 measures the
competing validate-and-revise answer.

## Principle

Explicit over implicit, with determinism as the instrument. The
extraction call is the one non-deterministic step in an import, and the
eval lane has measured what that costs: the same transcript, prompt,
and model produce structurally different models across five runs. A
production import runs once and presents its sample with the authority
of "the model", so every fork the LLM resolved by coin-flip arrives
looking settled. The extraction pipeline already has a channel for
"the transcript does not settle this" -- the `ambiguities` list -- and
run-to-run disagreement is precisely that signal, currently discarded
because nothing collects a second run.

Composability supplies the mechanism for free. `diffModels` in core
already corresponds two models by element name -- its doc comment says
why: "LLM re-extractions produce fresh UUIDs" -- and already detects
synonym candidates between them. Agreement over N samples is a pure
fold of pairwise diffs, so the deterministic core needs nothing new;
the only additions are a sampling loop at the non-deterministic
boundary (`llm`) and a flag on two surfaces.

## Should the sampler pick the best sample by score? (resolved: no -- agreement, not ranking)

No, because production cannot compute the half of the score that makes
ranking meaningful, and the half it can compute picks wrong.

A `CaseScore` is anchored by its rubric fraction, which needs the
hand-authored checks and reference model only an eval case has. What a
real import could compute is the penalty side alone: conformance
corrections, validation diagnostics, rated by element count. The 2.0.0
baseline shows that signal cannot see the variance that matters -- the
university-enrollment samples that collapsed to 0.154 were
penalty-clean, structurally correct models failed by the rubric on
vocabulary. A penalty-only picker would have scored all five samples
nearly identical.

Worse, penalties-only selection is gameable in a known direction: a
sparser extraction has fewer elements carrying fewer possible defects,
so "keep the lowest-penalty run" systematically prefers models that
extracted less. That is the failure mode `CaseScore.elementCount`
exists to tripwire, and in production there is no rubric fraction to
counterbalance it.

What N samples honestly yield is not which run is best but where the
transcript underdetermines the model. Disagreement is the deliverable.

## Which sample becomes the model? (resolved: the medoid)

The output must be a model some run actually produced -- provenance
stays an observation, not a synthesis. Among the surviving samples,
emit the medoid: the sample whose summed disagreement count against
the others is smallest, ties broken by sample order. Deterministic
given the payloads, and it uses the information the extra samples
bought instead of privileging whichever call happened to return first.

Synthesizing a consensus model (via `mergeModels`) is rejected below.

## Scope

In scope:

- When `barwise import transcript --samples <n>` is given with n in
  [2, 5], the system shall run the extraction call n times against the
  same rendered prompt and transcript and produce one model plus an
  agreement report.
- When an object type or fact type is absent from, or differs between,
  at least one pair of surviving samples, the system shall append an
  ambiguity naming the element, the kind of disagreement, and the
  sample counts (e.g. "2 of 3 samples objectify Review; 1 models it as
  a standalone entity").
- When `diffModels` reports a synonym candidate between two samples,
  the system shall report it as a naming ambiguity carrying both names.
- When a sample fails (parse failure or truncation), the system shall
  exclude it from agreement and say so; when exactly one sample
  survives, the system shall return it with a warning naming the
  failed samples; when none survives, the system shall fail as a
  single-sample import fails today.
- When `--samples` is omitted (or 1), the system shall behave
  byte-identically to today: one call, no agreement machinery.
- When the MCP `import_transcript` tool receives a `samples` argument,
  the system shall apply the same behavior, and the capability matrix
  shall carry the row in the same commit that wires each surface.

Out of scope, deferred and named:

- **Scoring or ranking samples.** Resolved against, above.
- **A consensus/synthesized model.** Alternatives, below.
- **The validate-and-revise loop.** Harness workstream 6 measures it;
  it is the complementary answer (spend calls revising one sample
  rather than drawing more), and nothing here forecloses it.
- **VS Code exposure.** Deliberate gap, recorded in the matrix row: an
  editor import flow wants one quick pass; revisit on demand.
- **Multi-sample `review`.** Same shape, no measured need yet.

## Inventory

| Module                                       | Current state                                     | Verdict                                     |
| -------------------------------------------- | ------------------------------------------------- | ------------------------------------------- |
| `core/src/diff/ModelDiff.ts`                 | Name-matched element diff plus synonym candidates | untouched: the correspondence instrument    |
| `llm/src/TranscriptProcessor.ts`             | Single-shot pipeline (`processTranscript`)        | untouched: one call stays one call          |
| `llm/src/pipeline (new) sampleAgreement.ts`  | absent                                            | new: pure fold, samples to report + medoid  |
| `llm/src/pipeline (new) sampleTranscript.ts` | absent                                            | new: the n-call loop at the boundary        |
| `llm/src/ExtractionTypes.ts` (`Ambiguity`)   | `description` + `source_references`               | reused: disagreements render as these       |
| `cli/src/commands/import/transcript.ts`      | One call; prints warnings/ambiguities summary     | add `--samples`, render the report          |
| `mcp` `import_transcript` tool               | One call                                          | add `samples` argument                      |
| root `CLAUDE.md` capability matrix           | no row                                            | add row (CLI yes, MCP yes, VS Code gap)     |
| `promptlab/src/run/runSuite.ts` (`repeat`)   | Samples for measurement against a rubric          | untouched: sibling purpose, see below       |
| `learn/src/evaluate/nameResolution.ts`       | Licence-aware grading resolution                  | untouched: `llm` cannot and need not see it |

`runSuite({repeat})` and this feature both draw repeated samples and
must not be confused: the eval lane ranks samples because it has a
rubric; this feature never ranks, it reports. `diffModels` matches by
exact element name where learn's evaluator normalizes and licenses --
deliberately parallel, not must-agree: they answer different questions
(is this the same element across my own runs, versus does this
candidate satisfy a rubric's word), and diff's synonym-candidate
detection is the affordance that catches near-miss names here.

## Target architecture

```
llm/src/pipeline/sampleAgreement.ts        (pure, deterministic)

  interface SampleAgreement {
    medoidIndex: number;                   // which sample to emit
    stable: number;                        // elements identical in all samples
    disagreements: SampleDisagreement[];   // element, kind, per-sample presence
    ambiguities: Ambiguity[];              // the disagreements, rendered
  }
  computeSampleAgreement(models: OrmModel[]): SampleAgreement
    // pairwise diffModels; counts per element; medoid by summed
    // disagreement, ties to the earliest sample

llm/src/pipeline/sampleTranscript.ts       (the boundary)

  sampleTranscript(transcript, client, {samples, ...ProcessorOptions})
    -> DraftModelResult                    // the medoid sample, with
                                           // agreement ambiguities and
                                           // a per-sample outcome list
                                           // appended
    // n sequential processTranscript calls sharing one correlationId;
    // a failed call is recorded and excluded, not retried beyond what
    // the client already does

cli:  barwise import transcript file.md --samples 3
mcp:  import_transcript { ..., samples: 3 }
```

The observability seam is unchanged in shape: each of the n calls logs
through the same `observer`/`correlationId` the single-sample path
uses, so `llm-usage` shows one import as n correlated calls.

## Alternatives considered

- **Best-of-N by reference-free score.** Rejected above: the signal
  cannot see rubric-class variance and Goodharts toward sparser models.

- **Consensus synthesis via `mergeModels`.** Produces a model no run
  produced, so every downstream consumer of provenance (source
  references, the reasoning trail, the extraction log) would describe
  calls that did not build the emitted model. Merge exists for
  integrating a reviewed model with an incoming one under a human eye;
  silently merging n unreviewed samples is a claim, not an observation.

- **Grading samples in promptlab.** The scorer lives in dev tooling on
  purpose; MCP does not depend on promptlab, so wiring it into import
  would create a surface gap by construction -- and it re-imports the
  ranking idea already rejected.

- **Reusing learn's licence-aware resolution for correspondence.**
  `llm` cannot depend on `learn` (siblings in the graph), and does not
  need to: core's `diffModels` already owns cross-run name matching,
  and its synonym candidates carry the near-miss cases.

- **A revise loop instead of more samples.** Genuinely competitive,
  not rejected: re-prompting with validation feedback may buy more
  quality per call than an independent draw. It is harness workstream
  6's question, is unmeasured, and is orthogonal enough to ship
  separately; this spec's fold would even measure such a loop's output
  against independent samples later.

## Workstreams (each independently shippable)

### 1. The agreement fold (pure, offline)

`computeSampleAgreement` in `@barwise/llm`: pairwise `diffModels`,
per-element disagreement counts, medoid selection, ambiguity
rendering. No LLM client, no I/O; tests are fixture models with known
diffs, plus determinism pins (same inputs, byte-identical report;
medoid tie breaks to the earliest sample). First because everything
else consumes it and it costs nothing to verify.

### 2. The sampling loop and the CLI flag

`sampleTranscript` (n sequential `processTranscript` calls, shared
correlation, failure exclusion) and `--samples` on
`barwise import transcript`, rendering the agreement summary alongside
the existing warnings/ambiguities lines. Mock-client tests with canned
divergent payloads, per `llm` convention; a golden guard that
`--samples` omitted leaves the single-call path byte-identical. The
capability matrix row lands here, with MCP marked as workstream 3.

### 3. The MCP argument (provisional: not yet grounded)

`samples` on `import_transcript`, same bounds and defaults, matrix row
updated to CLI yes / MCP yes / VS Code deliberate gap. Provisional
only in that the tool's input-schema conventions (how optional
numeric arguments are validated and surfaced) should be re-read at
implementation time.

## API and migration impact

- `@barwise/llm` gains `computeSampleAgreement`, `SampleAgreement`
  (with its `SampleDisagreement` rows), and `sampleTranscript` as new
  exports. `processTranscript` and every
  existing export are untouched; no downstream package is forced to
  change.
- `@barwise/cli` and `@barwise/mcp` each add one optional argument to
  one existing command/tool. No new dependencies anywhere; the
  one-way graph is unchanged.
- Suite, scorer, and history formats are untouched -- this feature
  never produces a score.

## Open decisions (for review)

- **Bounds and default for n.** Recommend [2, 5] and no default-on:
  each sample is a full extraction call, and prompt caching makes
  samples after the first cheaper on input tokens but not on output.
  A cap above 5 buys little agreement information for linear cost.
- **Sequential or concurrent calls.** Recommend sequential: the first
  call writes the prompt-cache entry the rest read, retry/backoff
  stays the client's existing behavior, and import is interactive but
  not latency-critical. Concurrency can come later without API change.
- **Structured disagreements on the result.** The `Ambiguity` shape is
  `description` plus `source_references`, which renders everywhere
  today. Recommend emitting disagreements as plain ambiguities plus
  the structured `SampleAgreement` on the result object for
  programmatic callers, rather than widening `Ambiguity` itself.

## Risks and testing

- The single-sample path must not change: golden test that an import
  without `--samples` produces byte-identical output and makes exactly
  one call.
- The fold must be deterministic: pinned report for fixture samples,
  including the medoid tie-break.
- Failure handling: canned mock runs where one of three samples fails
  to parse; assert exclusion, the warning, and that agreement runs
  over the survivors.
- Cost is the real risk: the flag multiplies spend by n, so the CLI
  help and the matrix row must both say so plainly, and n is bounded.
- Land as three PRs in workstream order; full monorepo suite after
  each (workstream 2 touches `llm`, which `mcp` and `vscode` build
  against).

## Non-goals

- No scoring, ranking, or promptlab dependency in production.
- No synthesized consensus model; the emitted model is always one
  sample's output, verbatim.
- No change to `processTranscript`, the prompt, or the response
  schema.
- No default multi-sample behavior on any surface.
- No revise loop; that remains harness workstream 6's question.
