# @barwise/llm

LLM-powered transcript extraction for ORM models. Takes plain-text or
markdown transcripts of business working sessions and produces draft
ORM models using structured LLM output.

## Dependency Rule

This package depends on `@barwise/core` (model types, serializers) and
the provider SDKs `@anthropic-ai/sdk` and `openai` (the latter also
powers the Ollama provider via its OpenAI-compatible API). It has ZERO
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
