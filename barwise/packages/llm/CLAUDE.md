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
  ExtractionPrompt.ts     System prompt construction and response schema
  DraftModelParser.ts     Converts extraction response into an OrmModel with provenance tracking
  TranscriptProcessor.ts  Pipeline orchestrator: transcript -> LLM -> draft model
  providers/
    anthropic.ts          Anthropic Claude implementation of LlmClient
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
  `processTranscript` uses them to resolve a per-model prompt variant
  from `builtinArtifacts` and nothing else knows the resolved model
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
- **Variants are compiled in, not read from disk.**
  `src/prompt/artifacts/builtins.generated.ts` is generated from
  `prompts/*.prompt.yaml` by `npm run regen:builtins` and committed;
  a drift test guards it. The published package ships `dist` only, so
  runtime loading is not an option.
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

| Direction  | Package          | What is used                                                                  |
| ---------- | ---------------- | ----------------------------------------------------------------------------- |
| Upstream   | `@barwise/core`  | `OrmModel`, `ObjectType`, `FactType`, `Role`, constraint types, serialization |
| Downstream | `barwise-vscode` | `processTranscript`, `AnthropicLlmClient`, extraction types                   |
