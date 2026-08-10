# Complete the prompt-artifact seam: resolve variants in production, and promote the model-agnostic rules into the default

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-08-09
Last-updated: 2026-08-09
Tracking: completes workstream 1 of
`docs/specs/prompt-optimization-harness.spec.md` (whose Inventory
claims production resolution that was never wired); motivated by
`docs/prompt-eval-haiku45-2026-08-09.md`. No bd issue yet (bd
unavailable in this session).

## Principle

Explicit over implicit, and composability. The harness spec declared a
runtime lane in which "`processTranscript` resolves and renders the
checked-in artifact", and recorded `packages/mcp` and
`packages/vscode` as untouched because they would "pick up artifact
resolution for free via `processTranscript`". Neither holds.
`processTranscript` accepts an artifact and renders it, but nothing
resolves one: every production call site omits the parameter, so every
extraction on every provider renders `defaultExtractionArtifact`. The
seam composes in principle and connects to nothing in practice --
`resolveArtifact` and `loadArtifactsFromDir` have exactly one caller,
`barwise prompt eval --artifacts`.

That leaves the default artifact as the only prompt any user receives,
and measurement says it is the weakest one we have. Against promptlab
suite 1.1.0 the default scores 0.760 on Haiku 4.5 with `min: 0`
frequency schema errors and chronic missing uniqueness; the tuned
variant scores 0.948. The rules that close that gap are ORM
correctness rules, not model quirks, and they currently live only in
files no user can reach. DRY is the secondary principle here and it
points the same way: an ORM correctness rule duplicated across two
variant files while absent from the default is duplication that also
fails the user.

## Should the default absorb the rules, or should production resolve variants? (resolved: both, and they are separable)

Both, because they fix different failures. Resolution reaches users
who run a model we have tuned for; promotion reaches everyone else --
OpenAI, Ollama, Copilot, and every Anthropic model without a variant.
Doing only one leaves half the surface unimproved.

They stay separable because their blast radii differ by an order of
magnitude. Wiring resolution changes behavior only for callers whose
model matches an existing `modelPrefix` (`claude-haiku`,
`claude-sonnet`), and the change is auditable per model. Promoting
rules into the default changes the prompt for every caller and
invalidates the baseline column of every measurement report we hold.
The second needs a fresh cross-tier measurement round; the first does
not.

The refinement that keeps this honest: promotion must not silently
duplicate what a variant already says. After a rule moves into the
default, the variants must drop their copy, or the two will drift and
a reader will not know which is authoritative.

## Scope

In scope:

- When `processTranscript` is called without an explicit `artifact`,
  the system shall resolve a built-in artifact for the LLM client's
  provider and model, and shall fall back to
  `defaultExtractionArtifact` when no variant matches.
- When a built-in artifact is resolved, the system shall render it
  without reading the filesystem at runtime.
- When a caller supplies an explicit `artifact`, the system shall
  render it unchanged, as today.
- When the default extraction artifact renders, it shall carry the
  model-agnostic correctness rules enumerated in Inventory.
- When a rule is promoted into the default artifact, the system shall
  no longer carry that rule in any per-model variant.

Out of scope, deferred and named:

- **The evaluator's exact-string alias matching.** `nameResolution.ts`
  compares aliases with `Array.includes`, so a candidate naming a type
  `Offering` with alias `"Course Offering"` fails a rubric asking for
  `CourseOffering`. That is an independent defect in `@barwise/learn`,
  ships as its own PR, and needs no spec.
- **The compound-term alias rule** (record the fuller stakeholder term
  as the name and the abbreviation as an alias). Worth one sample in
  twenty-one once alias matching is normalized; it rides along with
  whichever artifact edit lands next rather than justifying its own
  workstream.
- **The review surface** (`reviewModel.ts`). The harness spec reserved
  it for its workstream 5; this spec touches extraction only.
- **Non-Anthropic variants.** Nothing here authors an OpenAI or Ollama
  artifact; those providers benefit through the default.
- **The DSPy optimization lane.** Unchanged.

## Inventory

| Area                                                                    | Current state                                                       | Verdict     |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------- | ----------- |
| `llm/src/prompt/artifacts/loadArtifact.ts`                              | `loadArtifactsFromDir` reads `.prompt.yaml` from disk; one caller   | stays       |
| `llm/src/prompt/artifacts/builtins.ts`                                  | Does not exist; needed to carry variants without runtime file I/O   | new         |
| `llm/src/prompt/systemPrompt.ts`                                        | Holds `defaultExtractionArtifact` as a compiled-in constant         | modify (W3) |
| `llm/src/TranscriptProcessor.ts`                                        | Accepts `artifact?`; never resolves one                             | modify (W2) |
| `llm/src/LlmClient.ts`                                                  | Single `complete` method; no provider or model identity             | widen (W2)  |
| `llm/src/providers/{anthropic,openai,ollama}.ts`                        | Hold a resolved model internally; do not expose it                  | modify (W2) |
| `vscode/src/.../CopilotLlmClient.ts`                                    | Implements `LlmClient`; must expose identity too                    | modify (W2) |
| `llm/prompts/*.prompt.yaml`                                             | Authoring + measurement source; **not published** (`files: [dist]`) | stays       |
| `llm/package.json`                                                      | `files: ["dist"]` excludes `prompts/` from the published package    | untouched   |
| `mcp/src/tools/import.ts`                                               | Calls `processTranscript` with no artifact                          | untouched   |
| `cli/src/commands/import/{transcript,batch}.ts`                         | Call `processTranscript` with no artifact                           | untouched   |
| `vscode/src/{commands/ImportTranscriptCommand,mcp/ToolRegistration}.ts` | Call `processTranscript` with no artifact                           | untouched   |
| `cli/src/commands/prompt.ts`                                            | The only caller of `resolveArtifact`; keeps `--artifacts` override  | untouched   |
| `llm/tests/prompt/systemPrompt.golden.test.ts`                          | Pins the default's rendered bytes                                   | update (W3) |
| `promptlab/tests/scoreExtraction.test.ts`                               | Pins answer-key scores; must not move                               | guard       |

The five production _call sites_ are untouched deliberately:
resolution belongs inside `processTranscript`, not repeated at each
site. That is what the harness spec assumed when it recorded mcp and
vscode as getting resolution "for free", and it is still the right
place -- the assumption was never wrong, only unimplemented. The
vscode package does appear in the table, but for `CopilotLlmClient`
implementing a widened interface, not for how it calls extraction.

## Target architecture

```
@barwise/llm
  prompt/
    systemPrompt.ts     defaultExtractionArtifact  (compiled-in)
    artifacts/
      builtins.ts       builtinArtifacts: readonly PromptArtifact[]
                        -- generated from ../../prompts/*.prompt.yaml
                           at build time; no runtime fs, no import.meta.url
      resolveArtifact.ts  unchanged
      loadArtifact.ts     unchanged (authoring + `prompt eval --artifacts`)

  TranscriptProcessor.processTranscript(transcript, client, opts)
      artifact = opts.artifact
              ?? resolveArtifact(builtinArtifacts, {
                   surface: "extraction",
                   provider: client.provider,
                   model: client.model,
                 })
              ?? defaultExtractionArtifact

callers (unchanged): mcp/import, cli/import/{transcript,batch},
                     vscode/{ImportTranscriptCommand,ToolRegistration}
```

The generated `builtins.ts` is what makes this work in all three
distribution shapes: the published npm package ships `dist` only, the
VS Code extension is an esbuild CJS bundle where `import.meta.url`
already misbehaves (the build emits that warning today for
`learn/dist/exercise/catalog.js`), and the CLI runs from a global
install with no predictable path to a sibling `prompts/` directory.
Compiling the artifacts in sidesteps all three.

## Alternatives considered

- **Ship `prompts/` and read it at runtime.** Add `prompts` to
  `files`, resolve the directory relative to the module, call
  `loadArtifactsFromDir`. Rejected: it needs `import.meta.url` path
  resolution, which the VS Code CJS bundle already breaks for
  `@barwise/learn`'s exercise catalog; it adds filesystem I/O to a hot
  path that has none; and it makes extraction fail at runtime if the
  directory is missing rather than at build time.
- **Fold every variant rule into the default and delete the
  variants.** Simpler -- one prompt, no resolution. Rejected: the
  measurement says per-model differences are real. Haiku needed the
  frequency `min: 0` rule that the sonnet lineage never violated, and
  the sonnet lineage carries objectification and ring guidance Haiku
  did not need. Collapsing them either bloats one prompt with
  everything or loses tuning that is worth 0.19 on the tier where it
  was measured.
- **Leave production on the default permanently; treat variants as
  research artifacts.** Rejected: it makes the artifact seam
  ceremonial. If no user ever renders a variant, the loader, resolver,
  match blocks, and provenance metadata are cost without benefit, and
  the honest move would be to delete them rather than maintain them.
- **Thread `provider` and `model` through `processTranscript` options
  instead of widening `LlmClient`.** Much smaller: no interface
  change, no provider or mock updates. Rejected on grounding.
  `createLlmClient` detects the provider from the environment when
  none is given and passes `model` through as `undefined`, leaving
  each provider to apply its own default. A caller therefore does not
  reliably know which model it is about to use, so options-threading
  would resolve to the default artifact precisely in the common path
  where nobody configured a model explicitly -- and would do it
  silently. The client is the only object that knows its resolved
  model, which is why the identity belongs on the client.

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Workstream 3 is independent of 1
and 2 and could land in either order, but is placed last because it is
the only one that changes behavior for every user and the only one
gated on a measurement round.

### 1. Compile built-in artifacts into the module

Add a build step that reads `prompts/*.prompt.yaml` and emits
`src/prompt/artifacts/builtins.generated.ts` exporting
`builtinArtifacts`. Nothing consumes it yet, so behavior is unchanged
and the suite stays green by construction. Acceptance: when the
package builds, the system shall emit a `builtinArtifacts` array whose
members equal `loadArtifactsFromDir("prompts")` element for element --
asserted by a test that loads both and compares.

This is first because it is inert, and because the choice it settles
(generated versus hand-maintained) is the one an implementer most
wants fixed before wiring anything to it.

### 2. Resolve in `processTranscript`

Thread provider and model from the `LlmClient` into a `resolveArtifact`
call, falling back to the default. Acceptance: when `processTranscript`
runs against a client reporting model `claude-haiku-4-5`, the system
shall render the `haiku45` artifact; when it runs against a model with
no matching variant, the system shall render bytes identical to
today's output.

Coupling to note, and the reason this is its own PR: `LlmClient` is a
single-method interface (`complete`) that exposes no identity. The
only model identifier in the contract is `CompletionResponse.modelUsed`,
which arrives after the call -- too late to choose the system prompt.
So this workstream widens `LlmClient` with readable `provider` and
`model` members, implemented by all three providers under
`llm/src/providers/`, by `CopilotLlmClient` in `packages/vscode`, and
by every mock client in the `llm`, `cli`, `mcp`, and `vscode` test
suites. That diff is larger than the resolution logic it enables.

### 3. Promote the model-agnostic rules into the default

Move the rules below from the variants into
`defaultExtractionArtifact`, delete them from the variants, and
re-measure. Candidates, each traceable to a measured defect:

| Rule                                                     | Measured defect it closes                      |
| -------------------------------------------------------- | ---------------------------------------------- |
| Frequency `min` is at least 1, never 0                   | Schema errors; optionality is absent mandatory |
| Every 2+-role fact type carries internal uniqueness      | `completeness/fact-type-without-uniqueness`    |
| Attribute fact types are included in that rule           | Same, on `Course has CourseTitle` and kin      |
| Every binary carries both readings                       | `structural/binary-missing-inverse-reading`    |
| Frequency sits on the role the sentence quantifies over  | Inverted frequency constraints                 |
| No population that the model's own mandatory invalidates | `population/mandatory-violation`               |

Acceptance: when the default artifact renders, it shall contain each
rule above; and when the promptlab suite runs against the default on
at least two model tiers, the system shall record a mean no lower than
the pre-promotion baseline for either tier.

## API and migration impact

- `@barwise/llm` gains one export, `builtinArtifacts`. No existing
  export changes signature.
- `processTranscript`'s behavior changes for callers whose model
  matches a variant; the `artifact` option remains an override with
  the same meaning.
- `LlmClient` gains readable `provider` and `model` members. This is a
  breaking change to a published interface: every implementation
  updates, including the three providers under `llm/src/providers/`,
  `CopilotLlmClient` in `packages/vscode`, and the mock clients in
  four test suites.
- No downstream package adds a dependency; mcp, cli, and vscode pick
  up resolution without edits, which is the outcome the harness spec
  originally recorded.
- The build gains a codegen step in `@barwise/llm`, so the generated
  file must be either committed or added to `.gitignore` and produced
  by `prebuild` -- see Open decisions.

## Open decisions (for review)

- **Generated versus hand-maintained builtins.** Generating from the
  YAML keeps one source of truth and cannot drift; it costs a build
  step and a decision about committing generated output. Hand-writing
  a TS registry has no build step but duplicates every prompt body in
  two places, which is precisely the drift this spec complains about
  elsewhere. Recommend generated, committed to the repo so a consumer
  reading `dist` can trace provenance without running the build.
- **Which rules count as model-agnostic.** The six in workstream 3 are
  my proposal; each was derived from an observed defect rather than
  invented, but the list re-baselines every recorded measurement, so
  the set is the reviewer's call. Recommend all six. A reviewer who
  wants a smaller blast radius could take the first four (pure lint
  classes) and defer frequency siding and the population rule, which
  involve more judgment.
- **Should resolution be opt-out?** A `useBuiltinVariants: false`
  option would let a caller pin the default for reproducibility.
  Recommend adding it, defaulting to resolution on: the promptlab
  harness and any future regression suite want a way to hold the
  prompt fixed independent of which model they run.
- **Do variants survive promotion?** If the six rules move to the
  default, `haiku45` retains little beyond the frequency `min` rule,
  and `sonnet5` retains objectification and ring guidance. Recommend
  keeping both files -- the seam is the point, and a thin variant is
  evidence the default is doing its job -- but a reviewer could
  reasonably retire `haiku45` and re-measure.

## Risks and testing

- **The golden test will fail on workstream 3, by design.**
  `systemPrompt.golden.test.ts` pins the default's rendered bytes to
  reproduce the pre-artifact prompt. Workstream 3 must update the
  golden in the same commit and state in the message that the pin
  moved deliberately.
- **Answer-key pins must not move.** `promptlab`'s
  `scoreExtraction.test.ts` scores recorded payloads, which do not
  depend on prompt text; they should be unaffected, and CI proves it.
  If one moves, the change reached further than intended.
- **Workstream 2 silently changes production behavior.** A user on
  Sonnet gets a different prompt than yesterday. Mitigate by landing
  workstream 2 with its byte-identical-fallback test and by naming the
  change in the release notes.
- **Measurement before adoption.** Workstream 3 does not land on the
  strength of the Haiku numbers alone; it needs the suite run against
  the modified default on at least two tiers, with results recorded in
  a dated report as the other prompt changes were.
- Full gate after each workstream: `npm run build`, `test`, `lint`
  from `barwise/`.

## Non-goals

- No new extraction capability; the rules promoted are already written
  and already measured.
- No change to the eval suite, its weights, or its answer keys.
- No change to `resolveArtifact`'s matching semantics or the
  `PromptArtifact` contract.
- No per-surface expansion: extraction only, review deferred.
