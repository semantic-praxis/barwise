# Keyless by default: remove the places an API key can live

Status: WS1 (the key leaves VS Code settings for the OS keychain) and WS3
(`--api-key` refused) landed with this spec. WS2 (MCP sampling) is open --
barwise-1030.

Created: 2026-09-12
Last-updated: 2026-09-12
Tracking: barwise-1029 (WS1, the VS Code setting and SecretStorage);
barwise-1030 (WS2, MCP sampling); barwise-1031 (WS3, retire `--api-key`).
Follows `docs/specs/credential-scanning.spec.md`, which added the detector.
This is its counterpart: that spec catches a leaked key, this one removes the
places a key can sit in order to leak.

In one sentence: the editor already gets its model from the host and needs no
key, so extend that to the MCP server and delete the two file- and
argv-shaped homes a key can occupy, leaving the measurement lane as the only
surface that must hold one.

## Principle

**Define errors out of existence.** `credential-scanning.spec.md` is a
detector, and a detector is the weaker instrument: it fires after the key is
already in the tree, and its verdict depends on a rule set tracking every
provider in the world. The stronger move is to remove the locations a
credential can occupy, so there is nothing for the detector to find.

**Composability** is what makes it cheap here, and it is already built.
`LlmClient` is a narrow interface -- `provider`, `model`, `complete(request)`
-- and `packages/vscode/src/llm/CopilotLlmClient.ts` already implements it
against the host's model access (`vscode.lm`) instead of an API. Its header
states the payoff: users "leverage their existing Copilot subscription
without needing a separate API key." `resolveLlmClient()` in
`ToolRegistration.ts` prefers it and falls back to Anthropic only when the
user configures one. The interface that made that possible makes the same
move available to the MCP server for the price of one more implementation.

## What actually holds a key today (measured, not assumed)

| Surface                                            | How it gets a model                         | Needs a key      |
| -------------------------------------------------- | ------------------------------------------- | ---------------- |
| VS Code `import_transcript`, `review_model`        | `CopilotLlmClient` via `vscode.lm`          | **no**           |
| VS Code, `llmProvider: "anthropic"`                | `barwise.anthropicApiKey` setting, else env | yes, opt-in      |
| MCP server `import_transcript`, `review_model`     | `createLlmClient()` -> `ANTHROPIC_API_KEY`  | **yes**          |
| CLI `import transcript`, `import batch`, `review`  | env var, or `--api-key <key>`               | yes              |
| promptlab eval suite, `prompt run`, optimizer lane | env var                                     | yes, unavoidably |

`detectProvider()` in `packages/llm/src/providers/factory.ts` resolves
`ANTHROPIC_API_KEY`, then `OPENAI_API_KEY`, then falls back to Ollama, which
needs no key at all. So the fallback path is already keyless; what this spec
removes is the two places a key gets _written down_.

## Should subagent-style delegation replace the API everywhere? (resolved: no -- the measurement lane cannot)

No, and the reason is recorded in `CopilotLlmClient` itself.

Delegation means the host picks the model. `CopilotLlmClient.model` returns
the _family_ the caller asked for and `undefined` when the caller took the
default, and its own comment says prompt-variant resolution "treats that
absence as 'no variant applies' and renders the default artifact, which is
the honest outcome: the model is unknown."

That is fatal for promptlab. `artifact-resolution-in-production.spec.md`
makes the recorded `promptHash` a pure function of barwise version, surface,
provider and model, which is what makes any run's prompt recoverable
afterwards. A host-mediated call has no attributable model, so a score
computed through one measures nothing and cannot be compared against the
score history. The eval suite, `prompt run` and the DSPy optimizer therefore
keep direct API access, and that is the honest ceiling on this spec:
**delegation shrinks the key's blast radius to the measurement lane; it does
not eliminate the key.**

The consolation is that the lane which must hold a key is the one where the
key is least exposed: it is dev-time only, it is not a shipped surface, and
its credential can be a separate workspace-scoped key with its own spend
limit.

## Scope

In scope, as requirements:

- When the `barwise.anthropicApiKey` setting is declared, the system shall
  declare it at `application` scope, so VS Code does not honour it from
  workspace settings. (WS1)
- When a user supplies an Anthropic key to the extension, the system shall
  store it in `ExtensionContext.secrets` and shall read it from there. (WS1)
- When the extension reads a key and the deprecated setting still holds one,
  the system shall migrate it into secret storage and clear the setting. (WS1)
- When an eval or extraction artifact is written, the system shall not write
  the value of `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` into it. (WS1, as a
  test over a sentinel.)
- When the MCP client advertises the `sampling` capability, the MCP server
  shall obtain completions through `server.createMessage` rather than an API
  key. (WS2)
- When the MCP client does not advertise `sampling`, the system shall fall
  back to `createLlmClient()` and shall say which path it took. (WS2)
- When a structured response is required over sampling, the system shall
  request it through sampling's tool support rather than by asking for JSON
  in prose. (WS2)
- When `--api-key` is passed to any CLI command, the system shall exit
  non-zero naming the environment variable to use instead, and shall not
  accept the value. (WS3)

Out of scope:

- **The measurement lane's key.** Resolved above: it cannot be delegated
  without destroying the attribution the eval design rests on.
- **Short-lived or federated credentials.** There is no OIDC/STS exchange for
  an Anthropic API key to trade a workflow identity for a scoped token, so
  "make it expire" is not available. Workspace-scoped keys with spend limits
  are an operator control rather than a code change; noted in Open decisions.
- **The `OPENAI_API_KEY` and Ollama paths.** Ollama needs no key; OpenAI
  follows whatever WS3 establishes with no separate argument.
- **Detection.** That is `credential-scanning.spec.md`, already landed.

## Inventory

| File                                                                                               | Current state                                                                                                | Verdict                                                                          |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| `packages/vscode/package.json`                                                                     | `barwise.anthropicApiKey`, no `scope`                                                                        | WS1: `scope: "application"`, deprecation note                                    |
| `packages/vscode/src/mcp/ToolRegistration.ts`                                                      | `resolveLlmClient()` reads the setting; `registerLanguageModelTools(context)` already has `ExtensionContext` | WS1: read from `context.secrets`                                                 |
| `packages/vscode/src/commands/ImportTranscriptCommand.ts`                                          | `buildLlmClientWithPicker()` reads the setting                                                               | WS1: same, threaded from the command's context                                   |
| `packages/vscode/src/llm/CopilotLlmClient.ts`                                                      | host-backed `LlmClient`                                                                                      | untouched -- the model WS2 copies                                                |
| `packages/mcp/src/SamplingLlmClient.ts`                                                            | does not exist                                                                                               | WS2: new, host-backed via `createMessage`                                        |
| `packages/mcp/src/tools/import.ts`, `tools/review.ts`                                              | call `createLlmClient()` directly                                                                            | WS2: prefer sampling, fall back                                                  |
| `packages/mcp/src/server.ts`                                                                       | `new McpServer({...})`                                                                                       | WS2: the `server` handle sampling needs                                          |
| `packages/cli/src/commands/import/transcript.ts`, `import/batch.ts`, `review.ts`, `prompt.ts` (x2) | five `--api-key <key>` options                                                                               | WS3: refuse                                                                      |
| `docs/CLI.md`                                                                                      | documents the flag in five places                                                                            | WS3: updated                                                                     |
| `docs/local-eval-runbook.md`, `docs/handoff-2026-08-23.md`                                         | already warn never to pass it                                                                                | WS3: the warning becomes a statement of fact                                     |
| `packages/llm/src/providers/factory.ts`                                                            | `apiKey?: string` option, env fallback                                                                       | untouched -- the library option is legitimate; WS3 removes only the argv surface |
| `packages/llm/src/observe/callLog.ts`                                                              | records provider, model, tokens, latency, `ok`, `errorKind`, `promptHash`                                    | untouched, and WS1's sentinel test pins that it stays metadata-only              |

Two rows that look affected and are not. `@barwise/llm` keeps its `apiKey`
option: a library taking a credential from its caller is correct, and the
hazard WS3 removes is specifically a value in `process.argv`. And
`AnthropicLlmClient` is unchanged throughout -- every workstream changes
where a key comes from, never how a call is made.

## Target architecture

```
LlmClient  (packages/llm)  -- provider, model, complete(request)
   |
   |-- AnthropicLlmClient / OpenAILlmClient   key: env var only, after WS3
   |-- OllamaLlmClient                        no key, local
   |-- CopilotLlmClient   (packages/vscode)   host-backed: vscode.lm
   `-- SamplingLlmClient  (packages/mcp)      host-backed: server.createMessage
                                              <- WS2 adds this

Host-backed clients live with their host adapter, never in @barwise/llm:
the one-way dependency graph keeps `llm` free of both vscode and the MCP
SDK, which is why CopilotLlmClient sits in packages/vscode and the new one
sits in packages/mcp.

Key resolution after this spec:
  VS Code   ExtensionContext.secrets  (OS keychain), never a settings string
  MCP       nothing, when the client advertises sampling
  CLI       ANTHROPIC_API_KEY only -- no argv path
  promptlab ANTHROPIC_API_KEY, deliberately, because the model must be pinned
```

## Alternatives considered

- **Leave the VS Code setting and rely on the new scanner.** This is what
  prompted the spec and it is the weaker half: the scanner fires after the
  key is committed, and by then the remedy is rotation. `scope: "application"`
  makes the committed case unreachable instead of detectable. Both, not
  either: the scanner still covers the paths a scope cannot.

- **`machine` scope rather than `application`.** Both stop workspace
  settings. `machine` is for per-machine values that a remote/WSL window
  should not inherit from the client, which is not what a key is; a key is a
  per-user credential, so `application` says the true thing. Either would fix
  the leak, and this is a wording choice more than a security one.

- **Delete the Anthropic path from the extension entirely** and require
  Copilot. Simplest and removes the setting outright, and it is a capability
  removal for users who have an Anthropic key but no Copilot subscription.
  Rejected as out of proportion; `secrets` gets the same safety without
  taking a feature away.

- **Have the MCP server shell out to the CLI** rather than implement
  sampling. Would inherit whatever the CLI resolves and nothing else, and it
  puts a subprocess and a second key resolution in the path. Sampling is the
  protocol's own answer to exactly this question.

- **Deprecate `--api-key` with a warning and keep accepting it.** Rejected:
  the hazard is the value reaching `process.argv`, and a warning printed
  after that has already happened removes nothing. Two docs have carried that
  warning since August while the flag kept working, which is this
  repository's own rule that a finding is closed by a check or a fix rather
  than by a document.

## Workstreams (each independently shippable)

### 1. VS Code: the key stops being a settings string (barwise-1029)

Smallest blast radius -- one package, no interface change. `scope:
"application"` on the setting, `markdownDeprecationMessage` pointing at the
new command, and both read sites switched to `context.secrets`. A one-time
migration reads the old setting, writes it to secrets and clears it, so
nobody silently loses a working configuration.

`registerLanguageModelTools(context)` already receives `ExtensionContext`, so
WS1 threads it into `resolveLlmClient()` rather than inventing a holder.

Also here, because it is the same question asked of the recorder rather than
of the config: a test that sets `ANTHROPIC_API_KEY` to a sentinel, drives an
artifact write, and asserts the sentinel appears in no written file. That is a
property rather than a detector -- it cannot go stale as providers change --
and it pins the metadata-only shape `callLog.ts` already has.

### 2. MCP: sampling, so the server needs no key (barwise-1030)

`packages/mcp/src/SamplingLlmClient.ts` implements `LlmClient` over
`server.createMessage(params)`. `CreateMessageRequestParams` carries
`systemPrompt`, `messages` and `maxTokens`, which covers
`CompletionRequest`; `responseSchema` maps to sampling's `tools` /
`toolChoice`, the same way `CopilotLlmClient` uses `vscode.lm`'s tool_use for
structured output.

The prefer-then-fall-back decision reads
`server.getClientCapabilities()?.sampling`, and the chosen path is reported
in the tool result, because a silent fallback to a key is the reading this
spec exists to prevent.

Verified available before this was written: the SDK is `^1.30.0`,
`server/index.d.ts` exports `createMessage` in three overloads and
`getClientCapabilities()`, and the SDK ships
`examples/server/toolWithSampleServer.js` doing exactly this shape.

### 3. CLI: no key in argv (barwise-1031)

Five `--api-key <key>` options become a refusal: the option stays declared so
the error can name it, and supplying it exits non-zero pointing at
`ANTHROPIC_API_KEY`. Loud beats silent, and a removed-but-undeclared flag
would be reported by commander as an unknown option without saying why.

`docs/CLI.md` loses the five entries; the two documents that already warn
against the flag get to state that it no longer exists.

## API and migration impact

- No change to `LlmClient`, `CompletionRequest` or `CompletionResponse`, so
  no downstream package rebuilds against a changed type.
- `@barwise/mcp` gains a dependency on nothing new: the MCP SDK is already
  there.
- **User-visible:** a VS Code user with the key in settings has it migrated
  once, silently, and the setting cleared. A script passing `--api-key` breaks
  loudly with a message naming the replacement. That is the only breaking
  change, and Open decisions asks whether it wants a version bump.
- The capability matrix in `CLAUDE.md` is untouched: no surface gains or
  loses a capability. What changes is where each surface gets a credential.

## Open decisions (for review)

- **Does retiring `--api-key` need a major version?** Options: (a) ship it in
  a minor, on the grounds that it is a security fix and the flag was already
  documented as never-to-be-used; (b) hold WS3 for 2.0.0. Recommended: (a),
  because holding it keeps the hazard for the sake of a number, and the
  failure is loud and self-explaining rather than silent.

- **Should the MCP server prefer sampling even when a key is present?**
  Options: (a) yes, always prefer the host, matching VS Code's default;
  (b) prefer an explicitly configured key, on the grounds that an operator
  who set one meant it. Recommended: (a), with the path reported, so the
  keyless route is the default everywhere it exists.

- **Workspace-scoped key with a spend limit for the eval lane.** Not a code
  change and not assertable from this tree, so it cannot be a workstream.
  Recommended: yes -- it is the one control that bounds the damage of the key
  this spec cannot remove.

- **Should `detectProvider()`'s env-var precedence be narrowed** so only
  promptlab reads a key and the other surfaces refuse one? It would make the
  blast radius structural rather than conventional, and it would break a
  legitimate offline CLI use. Recommended: no, and revisit if WS2 makes the
  keyed MCP path genuinely unused.

## Risks and testing

- **The migration must not lose a working key.** Test both directions: a
  setting-only user ends up with a secret and an empty setting, and a
  secrets-only user is untouched. A migration that runs twice must be a
  no-op.
- **`scope: "application"` silently stops honouring an existing workspace
  setting.** That is the point, and it is also a behaviour change a user
  could experience as "it stopped working". The deprecation message and the
  migration are what make it legible rather than mysterious.
- **Sampling support is uneven across clients.** The fallback is the whole
  design, and the capability check must be shown to select correctly in both
  directions -- a client advertising sampling and one not -- rather than only
  on whichever client happens to be to hand.
- **A sampling call is not deterministic and not attributable.** It must never
  become reachable from promptlab. WS2 touches `packages/mcp` only, and
  `check-core-purity` plus the dependency-cruiser gate keep the eval lane
  from importing it.
- **The sentinel test must be able to fail.** Establish red first by writing
  the key into an artifact deliberately, per assertion-audit rule 0.
- **Behaviour that must not change:** every existing gate's reading, and the
  extraction and review output for a given model. This spec changes credential
  provenance, not results.

## Non-goals

- No new capability on any surface.
- No change to how a completion is requested from Anthropic or OpenAI.
- No removal of the Anthropic path from any surface; only of the places a key
  is written down.
- No attempt to make the promptlab lane keyless.
