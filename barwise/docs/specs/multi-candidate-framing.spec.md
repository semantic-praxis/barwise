# Multi-Candidate Framing in Transcript Extraction

Status: draft
Owner: design conversation (sensemaking initiative)
Tracking: implements initiative #3 / WS5 of
`implicit-sensemaking.spec.md`, which drafted it provisionally. File bd
issues per workstream when this lands.

## Principle / Problem

The transcript extractor hands back a single, unquestioned model even
where the domain genuinely forks. The sensemaking discipline now embedded
in `SENSEMAKING_GUIDANCE` says to hold two or three rival framings at
genuine forks (attribute vs entity type, subtype vs role, binary vs
objectified fact type, which identifier) and let the domain decide. The
tool already _detects_ these forks -- `processTranscript` returns an
`ambiguities[]` array and the prompt flags eight categories -- but it only
reports them as warnings. It never offers the rival framing the modeler
could adopt.

This touches two pillars. **Determinism in core**: generating an
alternative framing is abductive and non-deterministic, so it stays in
`llm`; _comparing_ framings is deterministic and already exists as
`diffModels` in `core`. **Composability**: the strongest version rides the
ambiguity detection and the diff engine barwise already has, rather than
adding a candidate-ranking engine.

## Should we return full alternative models or just describe the fork? (resolved: full models, diffed)

Full alternative models, compared via `diffModels`. A textual description
of a fork is what the `ambiguities[]` array already provides; it does not
let the modeler _adopt_ the other framing or see its blast radius. A full
candidate model diffed against the primary does both: the diff shows
exactly which object types, fact types, and constraints change, and the
candidate is directly adoptable. The spec's whole value -- "compared via
the existing diff" -- requires real models to diff.

## Should the alternative be a full model or a patch on the primary? (resolved: full model)

A full candidate model per alternative. Barwise has no patch-apply
mechanism, and `diffModels` already matches by name (not id), so it
tolerates a freshly-extracted candidate with new ids. Reusing
`parseDraftModel` to turn each alternative into an `OrmModel` keeps one
parsing path. The cost is tokens (an alternative is a second model in the
response); we bound it by making the feature opt-in and capping the number
of alternatives.

## Scope

In scope:

- An opt-in extraction mode that, alongside the primary model, returns one
  alternative framing for the single highest-impact structural fork
  (extensible to a small N).
- Each alternative carries the ambiguity it resolves, a parsed candidate
  `OrmModel`, and its `diffModels` result against the primary.
- Opt-in surfacing through `import_transcript` (MCP) and
  `barwise import transcript` (CLI), default off.

Out of scope:

- Changing the default single-model behavior, cost, or output.
- A new comparison or ranking engine -- reuse `diffModels`.
- Auto-selecting a framing. The modeler (human or agent) chooses; the tool
  only presents.
- Initiative #4 (anchors view, reasoning trail) and WS4 (cross-fact-type
  counterexamples).

## Inventory

| Area                                         | Change                                                         | WS | Verdict                          |
| -------------------------------------------- | -------------------------------------------------------------- | -- | -------------------------------- |
| `llm/src/ExtractionTypes.ts`                 | Add optional `alternatives` to the extraction response + types | A  | Additive                         |
| `llm/src/ExtractionPrompt.ts`                | Opt-in prompt + schema branch that asks for one rival framing  | A  | Additive, gated                  |
| `llm/src/DraftModelParser.ts`                | Parse each alternative via the existing path                   | A  | Reuse                            |
| `llm/src/TranscriptProcessor.ts`             | `ProcessorOptions.alternatives`; populate `DraftModelResult`   | A  | Additive, opt-in                 |
| `llm` (new `CandidateFraming` + diff wiring) | Diff each alternative vs the primary via core `diffModels`     | B  | Deterministic comparison in core |
| `mcp/src/tools/import.ts`                    | `alternatives?: boolean`; render fork + diff summary           | C  | Additive, opt-in                 |
| `cli/src/commands/import.ts`                 | `--alternatives`; render fork + diff summary                   | C  | Additive, opt-in                 |

## Target architecture

```
# llm: generation stays non-deterministic; comparison reuses core diff.
ProcessorOptions {
  modelName?: string
  existingModelContext?: string
  alternatives?: boolean        # NEW, default false
}

DraftModelResult {
  ... existing fields ...
  alternatives?: readonly CandidateFraming[]   # NEW, present only when requested
}

# A candidate framing: the fork it resolves, the model, and the diff
# against the primary (deltas + breakingLevel + synonymCandidates).
interface CandidateFraming {
  readonly ambiguity: Ambiguity         # which fork this framing takes the other side of
  readonly rationale: string            # one line: "models Email as the identifier instead of customer_id"
  readonly model: OrmModel              # parsed via the existing parseDraftModel
  readonly diff: ModelDiffResult        # diffModels(primary, candidate) -- deterministic, core
}

# Surfacing (opt-in, default off):
#   MCP  import_transcript(..., alternatives=true)
#   CLI  barwise import transcript <file> --alternatives
# Output: primary model as today, then an "Alternative framings" section --
# each fork's description, the rationale, and the diff summary
# (added/removed/modified names + breaking level).
```

## Alternatives considered

- **Return N independent candidate models (`DraftModelResult[]`).**
  Rejected: `diffModels` is pairwise, so N candidates still need a base to
  diff against, and there is no natural "primary." It also multiplies
  token cost. The chosen design keeps one primary and diffs each
  alternative against it -- which is exactly the pairwise shape diff
  already supports.
- **Describe forks textually only (no models, no diff).** Rejected: that
  is what the existing `ambiguities[]` array already does. The spec calls
  for framings "compared via the existing diff," which needs real models,
  and a textual fork is not adoptable.
- **Generate each alternative with a separate LLM call.** Deferred: a
  single structured response carrying the primary plus the alternative is
  cheaper and keeps one round-trip; separate calls are a fallback if the
  combined response proves unreliable.

## Workstreams

- [ ] **WS-A -- Alternatives in extraction (`llm`).** Add an optional
      `alternatives` array to `ExtractionResponse`/`DraftModelResult` and a
      `ProcessorOptions.alternatives` flag. When set, the prompt and schema
      ask the model, for the single highest-impact structural fork it
      identified, to also return a full alternative framing plus a
      one-line rationale. Parse each alternative with the existing
      `parseDraftModel`. Default off -- no change to existing behavior or
      cost. Recorded-fixture tests (the package convention).
- [ ] **WS-B -- Diff each alternative against the primary.** Introduce
      `CandidateFraming` and populate its `diff` with
      `diffModels(primary, candidate)` (deterministic, core). Keeps the
      comparison in core and the generation in `llm`.
      _(provisional: not yet grounded -- confirm whether the diff is
      computed in the processor or by the surfacing layer.)_
- [ ] **WS-C -- Surface alternatives (opt-in).** Add `alternatives` to
      `import_transcript` and `--alternatives` to the CLI, both default
      off. Render the primary as today, then an "Alternative framings"
      section: each fork's description, its rationale, and a concise diff
      summary (added/removed/modified element names and breaking level).
      _(provisional: not yet grounded.)_

## API and migration impact

All changes are additive and opt-in; default behavior, output, and cost
are unchanged.

- `DraftModelResult` and `ExtractionResponse` gain an optional
  `alternatives` field; existing consumers ignore it.
- `ProcessorOptions` gains an optional `alternatives` flag (default false).
- `import_transcript` and the CLI gain an optional, default-off parameter.
- A malformed or unparseable alternative is dropped with a warning -- it
  never blocks the primary model.

## Open decisions

- **How many alternatives.** _Recommend_ one (the single highest-impact
  structural fork) for the first cut, with the type shaped as an array so N
  can grow later. Trade-off: more alternatives multiply tokens and dilute
  attention.
- **Which forks qualify.** _Recommend_ the structural forks named in
  `SENSEMAKING_GUIDANCE` -- entity vs value type, subtype vs role, binary
  vs objectified, identifier choice -- not all eight ambiguity categories
  (optionality and cardinality forks are better left to constraints).
- **Where the diff is computed.** _Recommend_ in the processor (so
  `DraftModelResult` is self-contained), accepting that `llm` already
  depends on `core`. Alternative: compute it in the surfacing layer.
- **Single response vs separate calls.** _Recommend_ a single structured
  response; revisit only if reliability suffers.

## Risks and testing

- **Token cost and latency.** A full alternative model roughly doubles the
  response. Mitigated by opt-in default-off and capping at one alternative
  for the first cut.
- **Unparseable alternatives.** The LLM may return an invalid alternative.
  Reuse `parseDraftModel`'s validation and drop a bad alternative with a
  warning; the primary is unaffected.
- **Trivial or noisy alternatives.** Restrict generation to structural
  forks so an alternative represents a real modeling decision, not a
  cosmetic difference.
- **Diff name-churn.** An alternative that renames many elements shows as
  add/remove pairs; the existing `synonymCandidates` heuristic surfaces
  likely renames, which is acceptable.
- **Determinism.** Generation is non-deterministic and lives in `llm`,
  tested with recorded request/response fixtures; the diff is deterministic
  core. No non-determinism enters `core`.
- **Formatting.** Same pre-push gate as the parent spec; `dprint
  fmt:check` runs in CI but not in this environment.

## Non-goals

- Auto-selecting or ranking framings.
- A bespoke multi-model comparison engine.
- Changing default extraction behavior or the `.orm.yaml` format.
