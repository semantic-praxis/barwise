# Keyless model access

Scope: architecture
Date: 2026-09-12
Tracking: barwise-ubc, barwise-1029, barwise-1030, barwise-1031, barwise-ybi, barwise-xsg,
barwise-ppb, barwise-2n1,
docs/specs/keyless-model-access.spec.md,
docs/specs/model-access-held.spec.md
Enforced-by: tests (no-key-in-argv, no-key-in-setting, keyless-defaults, library-takes-key,
measurement-key), none (barwise-ym8.nw4: no-key-in-setting),
none (barwise-ym8.52o: keyless-defaults), none (barwise-ym8.esi: measurement-key)

## Context

A credential scanner fires after a key is already in the tree, when the
only remedy is rotation. The stronger move is to remove the places a key
can be written down, so there is nothing to find. Two such places existed:
`barwise.anthropicApiKey` was a window-scoped VS Code setting, so it could
land in a committed `.vscode/settings.json`, and five CLI commands took
`--api-key`, which puts the value in shell history, CI logs and
`/proc/<pid>/cmdline`. The rule is stated in the root `CLAUDE.md`
conventions ("A key has nowhere to be written down"). The measurements,
the alternatives and the reason the measurement lane cannot go keyless are
in `keyless-model-access.spec.md`; detecting a key that leaks anyway is
`docs/specs/credential-scanning.spec.md`.

## Decision

1. **No key in argv.**{#no-key-in-argv} `--api-key` is refused on every CLI command. The
   five commands that took it still declare it, so the error can name
   `ANTHROPIC_API_KEY` as the replacement, and one `preAction` hook on the
   root program refuses it before any command body sees the value; every
   other command rejects it as an unknown option.
2. **No key in an editor setting.**{#no-key-in-setting} VS Code keeps the Anthropic key in
   `ExtensionContext.secrets`. The old setting is `application`-scoped and
   deprecated, and is read only to migrate a value into secret storage and
   clear it.
3. **The default paths need no key.**{#keyless-defaults} VS Code defaults to
   `CopilotLlmClient` over `vscode.lm`. The MCP server uses MCP sampling
   when the client advertises `sampling.tools`, falls back to
   `createLlmClient()` otherwise, and appends the route to the tool result.
4. **Only `@barwise/llm` reads a model key (the Python optimizer lane is
   the one declared exception). Every call records the provider, the
   model and a non-reversible identifier of the credential, and a change
   in any of them between compared runs is reported beside the
   scores.**{#measurement-key} The measurement lane (promptlab, `prompt
   run`, the optimizer) keeps direct API access because a host-mediated
   call has no attributable model, and a score through one measures
   nothing. The credential identifier is a one-way fingerprint or the
   provider's workspace id, never the key.
5. **The library may take a key from its caller.**{#library-takes-key} `@barwise/llm` keeps its
   `apiKey` option; the hazard removed is a value in `process.argv` or a
   committable file, not a credential passed in code.

## Consequences

- Other paths may still read a key from the environment, which is not a
  place it is written down: the CLI's LLM commands and the MCP fallback
  through `detectProvider()`, and VS Code with `llmProvider: "anthropic"`
  and no stored secret, whose `AnthropicLlmClient` falls back to
  `ANTHROPIC_API_KEY`.
- A script passing `--api-key` fails with exit 1 and the key is not
  used. On the five declaring commands the message names the variable and
  says to rotate, unless commander reports another argument or option
  error first (a missing required one, an unknown one, an invalid
  choice); every other command reports an unknown option.
- No gate script checks this rule. Each decision is held by unit tests,
  run in CI by `npm run test:coverage` (`if:
  steps.changes.outputs.docs_only != 'true'`, so skipped on a docs-only
  pull request and, like any step, once an earlier step fails), or by
  nothing:
  - 1: `cli/tests/commands/apiKeyFlag.test.ts`. The hook matches the
    spelling `--api-key` only, and a tagged test walks every command
    and subcommand of `createProgram()` and fails on any other option
    with a word `key`, `secret`, `password` or `credential`, or ending
    in `-token` (barwise-xsg's rule; `model-access-held.spec.md`).
  - 2: `vscode/tests/unit/anthropicKey.test.ts` covers the migration,
    that no file under `vscode/src` but `llm/anthropicKey.ts` names the
    setting outside a comment, and the setting's `application` scope.
    The migration runs
    only when the Anthropic path reads a key and secret storage is empty,
    so a legacy workspace key is never moved or cleared for a user on the
    default Copilot path, or for one who already stored a key with the
    set-key command (barwise-ybi).
  - 3: `mcp/tests/llm/samplingClient.test.ts` covers the `sampling.tools`
    check both ways and the fallback; two of its tests also pin, as
    correct, the provider bypass and the route note below, and would
    change with barwise-2n1. `vscode/tests/unit/modelAccessDefaults.test.ts`
    pins `barwise.llmProvider`'s `copilot` default, and
    `mcp/tests/tools/modelAccessHeld.test.ts` shows `import_transcript`
    and `review_model`, with no key and no provider, reaching a sampling
    client's handler and naming the sampling route. An
    explicit `provider` input to the MCP tools, which the calling model
    can supply, skips sampling, and the route note says "this server's own
    API key" even when the fallback reached keyless Ollama (barwise-2n1).
  - 4: the measurement lane cannot reach a host-backed client:
    `npm run depcruise` (CI, under the same docs-only guard) holds promptlab to core, llm and learn, and both host-backed
    clients live in `mcp` and `vscode`. Decision 4 was restated on
    2026-11-06 (`adr-refactor.spec.md`, row 6) from "the measurement
    lane is the one lane that must hold a key", which also asked for a
    workspace-scoped key with a spend limit. That is now guidance, not a
    rule: it lives in the provider console, not in this tree. Its checks
    (a pattern check that only `@barwise/llm` reads
    `ANTHROPIC_API_KEY` or `OPENAI_API_KEY`, matching reads rather
    than mentions, and a schema test that each call-log and
    score-history entry carries all three fields) are batch 7 of that
    spec. The first holds: `llm/tests/keyFromEnvironment.test.ts` fails
    when a package's `src` outside `llm` reads a `KEY`, `TOKEN` or
    `SECRET` variable (dotted, indexed, destructured, or through
    `node:process`'s `env`) or indexes `process.env` by a computed
    name. The credential fingerprint is `model-access-held.spec.md` WS3,
    and the gap issue in the header stands for it.
  - 5: `llm/tests/providers/factory.test.ts` pins `PROVIDER_NAMES` to
    exactly anthropic, openai and ollama, and shows each keyed provider
    handing a caller's `apiKey` to its SDK constructor.
- The spec requires that no eval or extraction artifact contains a
  provider key, shown by a sentinel test over written files. Only the
  call log has a related test, over one record
  (`llm/tests/observe/callLog.test.ts`) (barwise-ppb).
- Left to the owner: the spec marks none of its Open decisions resolved,
  and the code follows each recommendation. Whether retiring `--api-key`
  needed a major version (moot: it first ships in v2.0.0, a major);
  whether MCP sampling should be preferred even when a key is also
  configured (the root `CLAUDE.md` says only that the MCP path needs no
  key where the client advertises sampling); and whether
  `detectProvider()` should refuse a key outside promptlab ("Recommended:
  no").
- Until they are replaced with links (barwise-5h3; the root `CLAUDE.md` states
  the rule in one line with a link since architecture-index WS5), these places
  also state this rule:
  - `keyless-model-access.spec.md`;
  - `packages/mcp/CLAUDE.md`, `packages/vscode/CLAUDE.md` and
    `packages/promptlab/CLAUDE.md`;
  - comments in `cli/src/cli.ts`, `cli/src/commands/apiKeyFlag.ts`,
    `vscode/src/llm/anthropicKey.ts`, `vscode/src/client/extension.ts`,
    `vscode/src/mcp/ToolRegistration.ts`,
    `vscode/src/commands/ImportTranscriptCommand.ts`,
    `mcp/src/llm/resolveClient.ts`, `mcp/src/llm/SamplingLlmClient.ts`,
    `mcp/src/tools/import.ts` and `optimizer/barwise_optimizer/compile.py`;
  - the setting's deprecation message in `vscode/package.json`;
  - the user docs: `README.md`, `packages/vscode/README.md`,
    `docs/CLI.md`, `docs/MCP.md`, `docs/getting-started/cli.md`,
    `docs/getting-started/vscode.md`, `examples/README.md` and
    `docs/local-eval-runbook.md`.
