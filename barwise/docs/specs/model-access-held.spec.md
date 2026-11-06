# Keyless model access and production prompts, held by tests

Status: Draft -- no workstream implemented
Created: 2026-11-06
Last-updated: 2026-11-06
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
- MCP: `tools/import.ts` and `tools/review.ts` resolve a client with
  `resolveLlmClient` at registration, and their execute functions fall
  back to `createLlmClient` when given none.
- `@barwise/llm`: only it reads `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`
  from the environment (`providers/factory.ts`). Other packages name
  the variables only in messages.
- `selectArtifact(surface, target, override?)` returns the override after
  `assertArtifactSurface`, else resolves from `builtinArtifacts`.

## Scope

Tests, each tagged with the decision it holds:

**keyless-model-access**

1. `no-key-in-argv` (4gl, xsg): walk every command and subcommand of
   `createProgram()` and fail on any option whose long name contains
   `key`, `token`, `secret`, `password` or `credential`, other than the
   declared `--api-key` that the hook refuses.
2. `no-key-in-setting` (nw4, ybi): no file under `packages/vscode/src`
   other than `llm/anthropicKey.ts` names the `anthropicApiKey` setting
   in a configuration read; the setting's scope in `package.json` is
   `application`.
3. `keyless-defaults` (52o): `barwise.llmProvider` defaults to `copilot`;
   over an in-memory MCP connection whose client advertises
   `sampling.tools`, with no key in the environment, `import_transcript`
   and `review_model` reach the client's sampling handler (so the
   registration passes the resolved client), and the result names the
   sampling route.
4. `library-takes-key` (dxy): for every provider that takes a key
   (Anthropic, OpenAI), `createLlmClient({ provider, apiKey })` hands
   that key to the SDK constructor, observed through a module mock.
5. `measurement-key`, its first clause: no file under `packages/*/src`
   outside `packages/llm` reads `process.env` for a name containing
   `KEY`, `TOKEN` or `SECRET`. The credential fingerprint is WS3.

**production-prompt-resolution**

6. `shipped-only` (mdg): with candidate-looking environment variables
   and a temporary `XDG_CONFIG_HOME` and `HOME` holding a `prompts/`
   directory, `selectArtifact` with no override returns an element of
   `builtinArtifacts`; and `selectArtifact.ts` imports neither `node:fs`
   nor `node:process` and reads no `process.env`.
7. `candidates-in-prompt-lane` (w0p, qxt): every option of `import
   transcript`, `review` and `import batch`, hidden included, fails a
   deny pattern (`artifact`, `prompt`, `candidate`); the MCP
   `import_transcript` and `review_model` input schemas and the VS Code
   transcript and review tools' `inputSchema` carry no such property.
8. `recovered-not-recorded` (x2g): a call-log record built by the
   writer has no `artifactVersion` (nor any `artifact` key).
9. `library-seam` (29c): `processTranscript` and `reviewModel`, each
   given an explicit artifact authored for another surface, throw the
   guard's error before any client call.

The ADRs' four plus four gap entries go for the decisions these hold in
full; `measurement-key` keeps its gap entry until WS3.

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
