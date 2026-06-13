# Decouple the LLM Provider SDKs

Status: Accepted
Tracking: REPO_REVIEW-2026-06.md finding A4

## Problem

`@barwise/llm` carried both `@anthropic-ai/sdk` and `openai` as hard
runtime dependencies, and each provider module imported its SDK at the
top level:

- `providers/anthropic.ts` -- `import Anthropic from "@anthropic-ai/sdk"`
- `providers/openai.ts` -- `import OpenAI from "openai"`
- `providers/ollama.ts` -- `import OpenAI from "openai"` (Ollama reuses
  the OpenAI-compatible API)

`providers/factory.ts` statically imports all three provider modules, so
importing the factory (or the package barrel) evaluated every provider
module and pulled *both* SDKs into memory -- even though the factory
selects exactly one provider at runtime. Every command paid that cost,
including ones that never touch an LLM.

## Decision

Load each SDK lazily with a dynamic `import()` on first use, and keep
the SDKs as regular `dependencies`.

The review offered two options: lazy `import()` or optional peer
dependencies. Peer/optional dependencies would shift *installation* to
the consumer, but the realizable benefit of that is install-size
reduction for external consumers -- and all barwise packages are
private and unpublished, so the SDKs are installed once in the monorepo
regardless. The realizable win here is at runtime: a `barwise validate`
or an Ollama-only run no longer evaluates two cloud SDKs. Lazy
`import()` delivers that and keeps the default experience working with
no consumer-side boilerplate. If these packages are ever published,
moving the SDKs to optional peer dependencies becomes a follow-up that
the lazy loading already prepares for (the dynamic import is the natural
place to surface a clear "SDK not installed" error).

## Approach

In each provider:

- Change the SDK import to `import type` (erased at compile time, so no
  runtime `require`). The SDK is still referenced as a *type* (e.g.
  `private client?: Anthropic`, `Anthropic.Tool.InputSchema`).
- Move client construction out of the constructor into a private
  `getClient()` that does `const { default: Ctor } = await
  import(...)`, constructs the client once, and caches it. The
  constructor only stores options.
- Each `complete*()` path awaits `getClient()` before calling the API.

`factory.ts` is unchanged: it still statically imports the provider
classes, but those modules no longer evaluate an SDK at load time, so
the cost is deferred until a completion actually runs.

## Testing

- A regression guard per shared SDK asserts the SDK constructor does not
  run on `new XxxLlmClient()` -- only on the first `complete()`.
- The existing provider tests' `void client.complete(...)` +
  synchronous assertion pattern no longer holds (lazy `import()` adds an
  async tick before the SDK call), so those assertions now `await` the
  completion. This is the more correct pattern regardless.
- Added `anthropic.test.ts` (the provider had no dedicated test): it
  covers text and tool_use completions, the no-tool_use error, defaults,
  and lazy construction -- bringing `anthropic.ts` to full coverage and
  removing a thin functions-coverage margin.

## Verification

- `npm run build` and `npm run test:coverage` pass; `@barwise/llm`
  coverage rises (anthropic.ts to 100%) and stays above its thresholds.
- No public API change: provider class names, options, and the
  `LlmClient` contract are unchanged.
