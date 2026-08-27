# @barwise/llm

LLM-powered transcript extraction for ORM models. Takes plain-text or
markdown transcripts of business working sessions and produces draft
ORM models using structured LLM output.

## Dependency Rule

This package depends on `@barwise/core` (model types, serializers) and
the provider SDKs `@anthropic-ai/sdk` and `openai`. The Ollama provider
uses neither: it talks to Ollama's native `/api/chat` over `fetch` from
Node core, so it adds no dependency at all. It has ZERO
dependencies on VS Code. The LLM integration is intentionally kept at
the boundary of the system -- the core model and validation logic know
nothing about LLMs.

Each provider loads its SDK lazily (a dynamic `import()` on first use)
and constructs the underlying client only when a completion is first
requested, so importing this package -- or the provider factory -- does
not pull either SDK into memory for callers that never run that
provider. New providers added under `src/providers/` must follow the
same pattern.

`@barwise/diagram` is a devDependency only (used in integration tests).

## Package Layout

```
src/
  ExtractionTypes.ts      Types for extraction responses (ExtractedObjectType, InferredConstraint, etc.)
  LlmClient.ts            Abstract LLM client interface (LlmClient, CompletionRequest, CompletionResponse)
  ExtractionPrompt.ts     Thin facade re-exporting the prompt/ modules
  ExtractionConformance.ts Structural cleanup so parsed constraints pass validation
  DraftModelParser.ts     Converts extraction response into an OrmModel with provenance tracking
  TranscriptProcessor.ts  Pipeline orchestrator: transcript -> LLM -> draft model
  ModelContext.ts         Existing-model context for incremental extraction
  ReasoningTrail.ts       Extraction reasoning capture
  budget.ts               Output-token budget derived from transcript length
  parse/                  Response parsing (object types, fact types, constraints, ...)
  prompt/                 Prompt artifacts (builtins.generated.ts, selectArtifact,
                          systemPrompt, reviewPrompt, responseSchema, promptHash)
  providers/              LlmClient implementations: anthropic, openai, ollama
                          (+ factory.ts createLlmClient, stopReason.ts)
  observe/                Call/extraction/validation telemetry records
  review/                 reviewModel (LLM semantic review)
  index.ts                Public API
```

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # run tests with coverage
npx tsc --noEmit            # type-check only
```

## Key Conventions

- The `LlmClient` interface is provider-agnostic. New providers are
  added under `src/providers/` and implement the same interface.
- **A client declares its own identity.** `LlmClient` carries a
  `provider` and a `model`, both readable before the call, because
  `processTranscript` and `reviewModel` use them to resolve a
  per-model prompt variant from `builtinArtifacts` and nothing else
  knows the resolved model
  (`createLlmClient` passes `model: undefined` through and lets each
  provider apply its default). `model` is `string | undefined` and
  required, not optional: a provider that cannot know its model in
  advance must say so explicitly, and gets the default artifact.
  `CompletionResponse.modelUsed` is a different thing -- what actually
  answered, reported too late to choose a prompt.
- **The output budget belongs to the call, not the client.** A client
  holds one `maxTokens` for its lifetime, which is the wrong grain: the
  same client runs a 1 KB transcript and a 17 KB one, and a
  client-lifetime constant has to be set for the largest to be safe for
  any of them. `CompletionRequest.maxTokens` overrides it per call, and
  `suggestMaxTokens` (`src/budget.ts`) derives one from the
  transcript's own length, floored at the client default so anything
  that fit before behaves exactly as it did. The ratio in that module
  is calibrated from `promptlab/tests/fixtures/responses/`, not from
  intuition, and it uses the **densest** observed case rather than the
  mean: under-budgeting silently corrupts a measurement while
  over-budgeting only permits one, so the two errors are not symmetric.
- **A provider must say why it stopped.** Both SDKs report it and this
  code discarded it until `providers/stopReason.ts`. Two fields come
  back and they are not redundant: `stopReason` is the provider's own
  word passed through unmapped, and `truncated` is the one derived
  question every caller has, so no caller learns each provider's
  spelling of it. A reason the provider never reported stays **absent**
  rather than becoming `truncated: false` -- silence is not a claim
  that the answer was whole. The cost of not having this was measured:
  three dev-split cases scored near-zero as bad prompts when they were
  complete extractions cut off at 8,192 tokens
  (`docs/specs/output-budget.spec.md`).
- **The prompt prefix is cacheable, and its ordering is load-bearing.**
  The API renders a request `tools` -> `system` -> `messages`, and a
  cache breakpoint covers everything before it. The extraction call
  happens to put its stable content first -- the schema rides in
  `tools` as the extraction tool's `input_schema`, the prompt is
  `system` -- and the per-case transcript last, which is exactly the
  shape caching wants. **Do not move the transcript earlier or
  interpolate anything dynamic (a date, an id, a mode) into the system
  prompt**: caching is a byte-exact prefix match, so either change
  makes every request a unique prefix that pays the write premium and
  never reads.

  `CompletionRequest.cacheSystemPrompt` and `cacheUserMessage` are
  separate because their break-even conditions differ -- a write costs
  ~1.25x and a read ~0.1x, so a breakpoint pays only from the second
  request that reads it. The preamble repeats across every call a run
  makes; a transcript only repeats when the same input is sent again.
  Both are hints: OpenAI caches server-side with no client control and
  Ollama has no cache, so both providers ignore them.

  `tests/prompt/cacheablePrefix.test.ts` guards the one silent failure
  here. Below a model's minimum cacheable length nothing errors --
  `cache_creation_input_tokens` is simply 0 -- and the minimum is _not_
  monotonic across generations: Haiku 4.5 requires 4,096 where Opus 5
  requires 512. A trimmed prompt could disable caching on the model the
  eval suite runs against, with a bill as the only symptom.
- **Ollama gets the native endpoint, not the OpenAI-compatible one.**
  `/v1/chat/completions` cannot set `num_ctx`, and Ollama's own docs
  say so -- the documented workarounds are a Modelfile or a server-wide
  `OLLAMA_CONTEXT_LENGTH`, neither reachable from a library. That is
  disqualifying here rather than inconvenient: Ollama defaults to a
  4,096-token context and silently drops what does not fit, and the
  extraction system prompt alone is about 4,540 tokens, so on the
  default the _instructions_ are truncated before the transcript is
  read and the model is scored on a prompt it never saw.
  `suggestContextWindow` derives a window per call from the prompt
  length plus the output budget; `OllamaClientOptions.contextWindow`
  (reachable as `barwise prompt eval --context-window`) overrides it
  for a machine that cannot afford the derived size.

  Both endpoints do report truncation, contrary to a first reading of
  the compat layer: it passes `done_reason` through unchanged, and
  Ollama's vocabulary matches OpenAI's -- `"length"` when generation
  hits `num_predict` or exhausts the context. `describeOpenAiStop`
  therefore serves both. An empty `done_reason`, which Ollama writes on
  some paths, is mapped to absent rather than passed through: `""` as a
  stop reason looks like an answer.

  This provider streams for the same reason the Anthropic one does and
  more acutely -- a local model generating tens of thousands of tokens
  runs for many minutes, and a non-streaming request sends no headers
  until it finishes, straight past Node's 300-second header timeout.
  The NDJSON reader buffers partial lines: assuming a chunk boundary
  falls on a newline works right up until a long generation.
- **Conformance mirrors every structural rule the validator enforces.**
  `enforceConformance` exists to hand the parser something
  `constraintConsistency` will accept, so a purely structural rule with
  no counterpart here becomes a validation error the extraction cannot
  avoid -- and the eval charges 0.1 for it rather than the 0.02 a
  dropped malformed constraint costs. This went wrong three times
  (arity, frequency bounds, ring player identity), and the first two
  were each found by a live run rather than a test.
  `tests/ConstraintCorrespondence.test.ts` now asserts the property
  across the whole constraint vocabulary, so **a new rule in
  `constraintConsistency` should fail that test before it costs a
  sweep**. It asserts on severity `error` on purpose: two `constraint/*`
  rules are modeling advisories that conformance is deliberately silent
  about, and a stricter assertion would force the wrong fix. The
  enumeration and the structural/semantic split are in
  `docs/specs/constraint-conformance-audit.spec.md`.

  Anything resolving constraint roles here must resolve them the way
  `parse/helpers.ts` does -- role name first, case-insensitively, then
  player name, each match consuming a role. Resolving differently is the
  same bug one level down.
- **Observability records identities, never content, and never lives on
  the result type.** `observe/` holds two records: `callLog.ts` for what
  a call cost, `extractionLog.ts` for what the pipeline changed
  (conformance corrections **by category**, parser warnings and skipped
  constraints as counts). Neither hangs off `DraftModelResult` --
  that type answers what model a transcript produced and where each
  part came from, and corrections answer what a cleanup pass changed.
  (`modelUsed`, `usage` and `latencyMs` are still on it and are the
  counter-example, not the precedent: they are call telemetry on an
  extraction result, which is why `withCallLog` exists.)

  **A correction's `description` must never reach a record.** It quotes
  the constraint's own description, which is transcript-derived wording,
  and a telemetry file accumulating the transcripts users feed it is
  that mistake written to disk. `tests/observe/extractionLog.test.ts`
  asserts this over the serialised record rather than field by field,
  because a field added later without thought is how it would leak.

  Both emitters swallow a throwing sink deliberately: observability that
  can fail the operation it observes is worse than none, and an
  extraction that cost a paid call must not be lost to an unwritable
  log. The sink and the clock are supplied by the caller, like the
  history writer's date and build provenance.
- **Both LLM surfaces resolve their prompt through one function.**
  `selectArtifact(surface, client, options?.artifact)` in
  `src/prompt/selectArtifact.ts` owns the whole answer: the candidate
  set (`builtinArtifacts`, and nothing else), the surface guard, and
  the surface-to-default table. `processTranscript` and `reviewModel`
  each call it once and hold no resolution logic of their own. A golden
  test per surface pins the default's rendered bytes, so wiring a
  surface up is a no-op until a variant for it is authored.

  Do not re-answer any part of it at a call site. It was answered
  separately in three places, with the surface-to-default mapping
  spread across three files and restated here in prose, and the cost
  was change amplification: `PromptSurface` is shaped to grow, and a
  third surface meant editing every copy. barwise-850 is what that
  costs when it goes wrong -- two commands, one question, two answers,
  unnoticed for months, because falling back to the default is
  indistinguishable from choosing it.

  `resolveArtifact` remains the pure matcher over a caller-supplied
  list, and the `select` / `resolve` split in the names is
  load-bearing: production asks the narrow question over the shipped
  set, while `barwise prompt eval --artifacts` asks a wider one over
  candidates that are not shipped, and a reader can tell which from the
  call site. `promptlab`'s `runSuite` receives an already-resolved
  artifact and so uses the exported `assertArtifactSurface` rather than
  a fourth copy of the guard.
- **A review suggestion is validated, not cast.** `parseReviewResponse`
  drops any suggestion whose `category` or `severity` falls outside the
  enums the response schema declares, and any that is missing
  `description` or `rationale`. The rest of the array survives: one
  malformed entry is not a reason to discard a whole review. The
  enums are declared once (`REVIEW_CATEGORIES`, `REVIEW_SEVERITIES`) so
  the type, the response schema, and the check cannot drift.
- **Variants are compiled in, not read from disk.**
  `src/prompt/artifacts/builtins.generated.ts` is generated from
  `prompts/*.prompt.yaml` by `npm run regen:builtins` and committed;
  a drift test guards it. The published package ships `dist` only, so
  runtime loading is not an option.

  **What may bypass that promotion path, and what may not.** Nothing on
  a production path may: `selectArtifact` reads `builtinArtifacts` and
  has no directory override, so `barwise import transcript`, `barwise
  review`, the MCP tools and the VS Code commands can only ever send an
  artifact that went through `regen:builtins`, the drift test and
  review. The dev lane may, and that is where the seam belongs --
  `barwise prompt eval --artifacts`, `prompt artifact --artifacts` and
  `prompt run --artifacts` all resolve over `artifactCandidates(dir)`,
  which is the built-ins plus a directory. `processTranscript` and
  `reviewModel` still accept an explicit `artifact`, so an embedder can
  pass one; what does not exist is a CLI flag that makes a production
  command do it by accident.

  This is what keeps a recorded prompt identifiable. `withCallLog`
  records `hashPrompt` of the system prompt and deliberately not an
  `artifactVersion`, because with production narrow the version is
  recoverable: render every shipped artifact and match the hash. Two
  renderings per extraction artifact, since `--alternatives` appends a
  section and hashes differently -- a small search, not an ambiguity.
  `barwise prompt artifact` prints `version@hash` for exactly this
  join. Widen the override to a production surface and that recovery
  stops working, which is why the decision is recorded in the root
  `CLAUDE.md` capability matrix rather than left to taste.
- The VS Code extension also provides a `CopilotLlmClient` that
  implements this interface via the GitHub Copilot chat API -- that
  implementation lives in `packages/vscode/`, not here.
- `processTranscript()` is the main public entry point. It takes a
  transcript string and an `LlmClient` and returns a `DraftModelResult`
  containing the ORM model plus provenance metadata.
- Every extracted element carries `SourceReference` data (line numbers,
  excerpts) tracing back to the original transcript text.
- The extraction prompt uses the JSON Schema from `@barwise/core` to
  constrain LLM structured output.

## Testing

- Framework: Vitest
- Unit tests use mock `LlmClient` implementations with canned responses.
  No real API calls in the standard test suite.
- `tests/Pipeline.integration.test.ts` tests the full extraction
  pipeline with recorded fixtures.
- Live LLM tests (requiring API keys) belong in `tests/live/` and are
  excluded from CI. Run them manually during prompt engineering.

## Dependencies

| Direction  | Package              | What is used                                                                  |
| ---------- | -------------------- | ----------------------------------------------------------------------------- |
| Upstream   | `@barwise/core`      | `OrmModel`, `ObjectType`, `FactType`, `Role`, constraint types, serialization |
| Downstream | `@barwise/cli`       | `processTranscript`, `reviewModel`, `createLlmClient`, artifact resolution    |
| Downstream | `@barwise/mcp`       | `processTranscript`, `reviewModel`, `createLlmClient`                         |
| Downstream | `@barwise/promptlab` | `LlmClient`, artifacts, conformance, parsing for the eval runner              |
| Downstream | `barwise-vscode`     | `processTranscript`, `reviewModel`, `AnthropicLlmClient`, extraction types    |
