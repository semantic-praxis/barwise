# Keyless model access and production prompts, held by tests

Status: WS1 and WS2 implemented 2026-11-06 (nine Scope items as tagged tests, each seen red on a planted violation; the ADRs drop the gap entries for no-key-in-argv, library-takes-key, shipped-only, candidates-in-prompt-lane and library-seam); WS3 provisional
Created: 2026-11-06
Last-updated: 2026-11-06
Plan-reviewed: ee781594 (code-review, pr-review)
Tracking: barwise-ym8.gc9 (adr-refactor batch 7), barwise-ym8.4gl,
barwise-ym8.nw4, barwise-ym8.52o, barwise-ym8.dxy, barwise-ym8.esi,
barwise-ym8.mdg, barwise-ym8.w0p, barwise-ym8.x2g, barwise-ym8.29c,
barwise-xsg, barwise-qxt, barwise-ybi
Touches: barwise/packages/cli/tests/, barwise/packages/vscode/tests/unit/,
barwise/packages/mcp/tests/, barwise/packages/llm/tests/,
barwise/docs/adr/keyless-model-access.md,
barwise/docs/adr/production-prompt-resolution.md,
barwise/docs/ARCHITECTURE.md

## Principle

`docs/adr/keyless-model-access.md` and
`docs/adr/production-prompt-resolution.md` already declare their
decisions under `tests`, and each gap issue names a violation the tagged
tests miss: a test that checks one spelling (`--api-key`), one provider
(Anthropic) or one call site, where the decision covers all of them.
The fix is the same each time: enumerate what the decision covers and
test every member, so a new member is covered without anyone writing a
test for it. No product code changes in WS1 and WS2.

## The reading this spec starts from (main at a53b57e4)

- CLI: one `preAction` hook refuses `--api-key`; `createProgram()`
  registers every command, and commander lists every option, hidden or
  not.
- VS Code: `getAnthropicApiKey` in `src/llm/anthropicKey.ts` is the one
  reader of the deprecated `anthropicApiKey` setting; `package.json`
  declares it `application`-scoped and `barwise.llmProvider` defaulting
  to `copilot`.
- MCP: `tools/import.ts` and `tools/review.ts` call `resolveLlmClient`
  inside each tool callback, per call, with that call's provider and
  model; their execute functions fall back to `createLlmClient` when
  given no client (plan review corrected "at registration").
- `@barwise/llm`: only `providers/factory.ts` reads `ANTHROPIC_API_KEY`
  or `OPENAI_API_KEY`. Other packages name the variables only in
  messages. `PROVIDER_NAMES` is anthropic, openai, ollama.
- `selectArtifact(surface, target, override?)` returns the override after
  `assertArtifactSurface`, else resolves from `builtinArtifacts`; it
  imports five modules, none touching the file system.
  `processTranscript` and `reviewModel` route `options.artifact`
  through it before any client call.
- No option of `import transcript`, `review` or `import batch`, and no
  input of the MCP or VS Code transcript and review tools, names an
  artifact, prompt or candidate today. `--max-tokens` (prompt eval) and
  `--surrogate-keys` (export) exist, so a substring match on "token" or
  "key" would fail on main (plan review).

## Scope

Tests, each tagged with the decision it holds:

**keyless-model-access**

1. `no-key-in-argv` (4gl, xsg): walk every command and subcommand of
   `createProgram()` and fail on an option whose long name has a
   hyphen-separated word `key`, `secret`, `password` or `credential`,
   or ends in `-token`, other than the declared `--api-key`. This is
   barwise-xsg's own rule, so `--max-tokens` and `--surrogate-keys` pass.
2. `no-key-in-setting` (nw4, in part): with comments stripped, no file
   under `packages/vscode/src` other than `llm/anthropicKey.ts` contains
   the literal `anthropicApiKey` (its constant there is not exported, so
   any other reader must spell it); the setting's scope in `package.json`
   is `application`.
3. `keyless-defaults` (52o, in part): `barwise.llmProvider` defaults to
   `copilot`; over an in-memory MCP connection whose client advertises
   `sampling.tools`, with no key in the environment and no `provider`
   argument, `import_transcript` and `review_model` reach the client's
   sampling handler and the result names the sampling route.
4. `library-takes-key` (dxy): `PROVIDER_NAMES` equals exactly anthropic,
   openai, ollama, so a new provider fails the test until it is added
   here; for each keyed one, `createLlmClient({ provider, apiKey })`
   hands the key to the SDK constructor, observed through a module mock.
5. `measurement-key`, first clause: no file under `packages/*/src`
   outside `packages/llm` reads a key from the environment, in any of the
   forms `process.env.X`, `process.env["X"]`, `const { X } = process.env`,
   `env.X` after importing `env` from `node:process`, with X containing
   `KEY`, `TOKEN` or `SECRET`; and none indexes `process.env` with a
   computed name. The credential fingerprint is WS3.

**production-prompt-resolution**

6. `shipped-only` (mdg): `selectArtifact.ts`'s imports equal exactly the
   five it has today, so a new import (a loader, `node:os`) fails until
   reviewed; with candidate-looking environment variables and temporary
   `HOME` and `XDG_CONFIG_HOME` holding prompt directories, it returns
   an element of `builtinArtifacts`; and the production call sites (CLI
   `import/transcript.ts`, `import/batch.ts`, `review.ts`; MCP
   `tools/import.ts`, `tools/review.ts`; VS Code `ToolRegistration.ts`
   and `ImportTranscriptCommand.ts`) pass no `artifact` property, read
   with comments stripped.
7. `candidates-in-prompt-lane` (w0p, qxt): every option of `import
   transcript`, `review` and `import batch`, hidden included, has no
   word `artifact`, `artifacts`, `prompt` or `candidate`; the MCP
   `import_transcript` and `review_model` input schemas and the VS Code
   transcript and review tools' `inputSchema` carry no such property.
8. `recovered-not-recorded` (x2g, in part): a call-log record built by
   the writer has no key containing `artifact`.
9. `library-seam` (29c): `processTranscript` and `reviewModel`, each
   given an explicit artifact authored for another surface, throw the
   guard's error and never call the client.

**What closes and what narrows.** The ADRs drop the gap entries for
`no-key-in-argv`, `library-takes-key`, `shipped-only`,
`candidates-in-prompt-lane` and `library-seam`, which these tests hold
in full. Three stay, narrowed in a tracker PR, because their issues name
violations a test cannot hold (plan review): `no-key-in-setting` (a
workspace copy of the key survives on the Copilot path until migration
clears it regardless of provider, barwise-ybi, a product change);
`keyless-defaults` (a calling model's `provider: "anthropic"` skips
sampling, and the Ollama fallback's route note, barwise-2n1);
`recovered-not-recorded` (other record writers, an `--alternatives`
hash with no command to print it, prompt-lane rows indistinguishable
from production, barwise-49k). `measurement-key` keeps its entry until
WS3.

## Alternatives considered

- **Gates instead of tests.** The decisions are already declared under
  `tests`, and every property here is a fact about one package's code
  that its own suite can read. Rejected.
- **Spelling lists** (`--api-key`, `--artifacts`). That is the shape
  each gap issue records as the hole. The tests enumerate the surface
  and match a pattern instead.

## Workstreams

### 1. keyless-model-access tests (Scope 1 to 5)

### 2. production-prompt-resolution tests (Scope 6 to 9)

Each test seen red on its planted violation before it lands.

### 3. The credential fingerprint (provisional: not yet grounded)

Decision 4's record clause: every call-log and score-history entry
carries the provider, the model and a non-reversible credential
identifier, and a comparison reports a change in any of them beside the
scores. New behaviour in `@barwise/llm` and `promptlab`; it needs its
own design pass (where the fingerprint is computed, what it is for a
keyless route, how old rows read).

## Risks and testing

- A deny pattern can catch an innocent name later (an option named
  `--prompt-file` on an unrelated command). The pattern applies only to
  the production commands the decision names.
- The MCP sampling test needs the SDK's in-memory transport; the tool
  tests already use it.
