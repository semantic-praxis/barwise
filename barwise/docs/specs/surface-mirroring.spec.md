# Mirror the CLI's toolset on MCP and VS Code, and make a gap fail CI

Status: Draft -- no workstream implemented

Created: 2026-10-13
Last-updated: 2026-10-13
Tracking: barwise-0wa. Sources: `docs/cli-surface-audit-2026-10-12.md`
(option by option) and `docs/surface-parity-audit-2026-10-12.md`
(runtime behaviour, a separate same-day audit whose issues are mapped
below).

## Principle

The owner directed on 2026-10-12 that MCP and VS Code mirror the CLI.
The audit counted 38 CLI leaf commands. MCP reaches 24 and VS Code 22,
and option-level gaps sit under matrix rows that read "none." Composability
says one `@barwise/core` powers three surfaces; a capability that two
surfaces lack, with no reason that holds, is an omission.

Closing today's gaps is half of it. The capability matrix has been wrong
twice, first claiming parity and then claiming deliberate divergence
(barwise-988), because it is hand-maintained and checks commands, not
options. This spec closes the gaps and lands a check that fails when
a CLI option has no counterpart and no recorded reason.

## What stays CLI-only? (resolved by the owner, 2026-10-13)

A gap stays only if mirroring would produce a wrong or unattributable
result, or break a documented safety rule. "Nobody has asked for it"
does not qualify.

| Stays CLI-only                                      | Reason                                                                                                                                                     |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt eval`, `prompt run`                         | The only `prompt` commands that call a model. A recorded score needs an attributable model, and MCP sampling reports none (`keyless-model-access.spec.md`) |
| `--thinking-budget`                                 | Declared only on `prompt eval` and `prompt run`                                                                                                            |
| `--artifacts`                                       | Unshipped prompt candidates must not reach production commands (`artifact-resolution-parity.spec.md`)                                                      |
| `import batch`                                      | An evaluation sweep across models, the same family as `prompt eval`                                                                                        |
| `llm-usage`                                         | Only the CLI writes the call log (`withCallLog` is used in `cli/src` alone), so a report from another surface would leave out that surface's own calls     |
| MCP gym session log (`--emit-misses`, `--no-state`) | Owner decision. The log is the learner's history, which the `gym-coach` skill reads, and an agent's checks through MCP would be counted as the learner's   |

The owner also decided that `merge_models` keeps writing back to `base`
by default. Workstream 2 adds an explicit output path beside it.

### Corrections to the audit

The audit is a dated record and is not edited in place. These supersede it:

- It recommended keeping all eight `prompt` subcommands CLI-only. Six call no model, so they fail the test above; the owner chose to mirror them.
- It gave `llm-usage`'s reason as "written by whichever process made the calls." The mechanism is narrower: only the CLI writes the log at all.
- It said a gym session log is "per-person state a shared server should not write." A stdio MCP server runs as the user's own process, so that reason does not hold. The reason in the table above replaces it.
- It found three bugs. The same-day surface-parity audit found more, among them barwise-fbi: the gym fails in every shipped bundle, the server VS Code embeds included. That was reproduced again while grounding this spec.

Presentation flags (`--format text|json`, `--json`) are not mirrored.
MCP and VS Code return JSON because an agent reads the result; the flag
changes the rendering, not what a caller can do.

## Do the deterministic `prompt` commands cross a package boundary? (resolved: four of six do)

The owner chose to mirror the six `prompt` commands that call no model.
Two need only `@barwise/llm`, which MCP already depends on:

- `prompt schema` (`buildResponseSchema`, `buildReviewResponseSchema`).
- `prompt artifact` (`resolveArtifact`, `builtinArtifacts`, `hashPrompt`; the hasher moved into `llm` under `artifact-resolution-parity.spec.md`, WS2).

Four need `@barwise/promptlab` and its eval suite: `score`, `rescore`,
`history`, `compare`. MCP may not depend on promptlab. That rule is
enforced by dependency-cruiser (`.dependency-cruiser.cjs`, `INTENDED.mcp`),
stated in `mcp/CLAUDE.md`, and relied on by two specs:

- `keyless-model-access.spec.md`: "A sampling call is not deterministic and not attributable. It must never become reachable from promptlab."
- `multi-sample-import.spec.md`: "The scorer lives in dev tooling on purpose."

None of the four calls a model. The decision is whether to admit them
across the boundary, and how; it is open decision 1.

## Scope

In scope, as requirements:

- When `npm run audit:surfaces -- --check` runs, the system shall fail on a CLI command or option that has no MCP or VS Code counterpart and no row in the baseline, and on a baseline row no longer detected. When a built surface it reads is missing, it shall exit 2.
- When a VS Code language-model tool wraps an MCP tool, it shall declare every parameter that MCP tool declares, except parameters the baseline excludes with a reason.
- When `import_model` or `merge_models` receives an output path, the system shall write the result there under the posture open decision 2 settles (barwise-pks).
- When `merge_models` is described to a client, its description shall say that it writes back to `base` (barwise-xjf).
- When `export_model` writes an artifact to disk, the system shall record it in the lineage manifest as `barwise export` does (barwise-ace).
- When `barwise_import_transcript` runs in VS Code, it shall accept `base`, `alternatives`, `samples` and an output path, and read `transcript` from disk when given a file path (barwise-0wa.pte).
- When `barwise_review_model` runs in VS Code, it shall accept a project manifest and a `domain`.
- When `barwise_export_model` runs in VS Code, it shall forward format options, `dialect` included.
- When `validate_model` receives a project manifest, it shall report the cross-domain project rules the CLI reports (barwise-0wa.qh3).
- When an MCP client calls `gym_list` or `gym_check` on the server bundled with VS Code, it shall get the same answer as from `packages/mcp` (barwise-fbi).
- When a CLI command in the audit's section 1 has no counterpart, the system shall gain one on both surfaces:
  - `project init`
  - `lineage show`
  - `gym show`, plus `--catalog` on the gym tools
  - `history`
  - gym in VS Code
  - an analyze tool in VS Code
- When `prompt schema` or `prompt artifact` is called on MCP or VS Code, the system shall return what the CLI prints, without `--artifacts`.

Out of scope:

- Issues from the same-day surface-parity audit that are not mirroring the CLI:
  - barwise-c2e (starting a model from nothing) runs the other direction, from VS Code to the CLI.
  - barwise-i22 is about palette pickers (below).
  - barwise-vqc is about which id generator the bundles install.
  - barwise-ntw is documentation; each workstream updates `docs/CLI.md` and `docs/MCP.md` for what it changes, which narrows that issue without closing it.
- New options on deprecated tools (`generate_schema`, `generate_diagram`). barwise-0wa.ymj decides their future.
- The audit's section 5, capabilities MCP or VS Code has and the CLI lacks. The owner's direction is one-way.
- VS Code palette commands. The VS Code column counts a language-model tool as reach (`CLAUDE.md`, barwise-988), so palette parity is a separate question.

## Inventory

| Area                                         | Current state                                                        | Verdict                                                                                                                              |
| -------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `barwise/scripts/audit-surfaces.mjs`         | Does not exist                                                       | New: reads the built CLI program, MCP server and VS Code manifest; ratchets gaps against a baseline                                  |
| `barwise/surface-parity-baseline.json`       | Does not exist                                                       | New: one row per gap, `gap` (names its workstream) or `kept` (owner-approved reason)                                                 |
| `vscode/tests/unit/toolRegistration.test.ts` | Pins tool names                                                      | Also pins each wrapped tool's parameters against the MCP tool's schema                                                               |
| `mcp/src/tools/importModel.ts`, `merge.ts`   | No output path                                                       | Output path                                                                                                                          |
| `vscode/src/mcp/ToolRegistration.ts`         | Bespoke transcript and review bodies; export drops `options`         | Transcript and review call `executeImport`/`executeReview` with the editor's client; export forwards options                         |
| `mcp/src/tools/validate.ts`                  | Per-domain validation only                                           | Also `projectRules`                                                                                                                  |
| `learn/src/exercise/catalog.ts`              | Resolves the catalog from `import.meta.url`, empty in the CJS bundle | A catalog the bundle can reach (open decision 4)                                                                                     |
| `mcp/src/tools/`                             | 18 tools                                                             | Adds `init_project`, `lineage_show`, `gym_show`, `model_history`, `prompt_schema`, `prompt_artifact`, and up to four promptlab tools |
| `cli/src/commands/history.ts`                | Git walk (about 60 lines of subprocess) plus rendering               | Walk shared or paralleled (open decision 3)                                                                                          |
| `CLAUDE.md` capability matrix                | Hand-maintained                                                      | Kept, and checked by `audit:surfaces`                                                                                                |

## Target architecture

```
audit:surfaces (root script, reads built output only)
  CLI      createProgram() from packages/cli/dist -> commands, options
  MCP      createServer() over the SDK's in-memory transport -> tools, schemas
  VS Code  package.json contributes.languageModelTools -> tools, schemas
  correspondence.json  CLI command -> MCP tool -> VS Code tool;
                       CLI option -> parameter, where camelCase is not enough
  surface-parity-baseline.json  every remaining gap: gap (WS n) | kept (reason)
  --check: unclassified gap -> fail; stale row -> fail; missing dist -> exit 2

Each workstream below deletes the baseline rows it closes, so "done" is
the baseline, not a claim in a PR body.
```

## Alternatives considered

- **Keep the hand-maintained matrix and close gaps once.** This is the status quo that went stale twice. The next new CLI option would reopen a gap that nothing reports.
- **Generate the MCP and VS Code tools from the CLI's commander definitions.** It would give one source, but CLI options are shaped for a terminal (stdout, `--format`, exit codes) and tools return JSON. One schema for both would couple the surfaces, against orthogonality. The `execute*` functions are already the shared layer; this spec checks the surfaces instead of fusing them.
- **Put the parity check in a package's test suite.** No package can see both the CLI and MCP: `cli` may not depend on `mcp`, and the reverse is also forbidden. A root script reading built output is the only vantage point that sees all three, which is why the root audits (`audit:duplication`, `audit:rubric`) live there.

## Workstreams (each independently shippable)

### 1. The parity check, with every current gap in its baseline (provisional: not yet grounded)

Land `audit:surfaces` and a baseline holding every gap the audit found,
each marked `gap` with its workstream or `kept` with its reason. CI runs
`--check`, and writes go through `scripts/lib/baseline-merge.mjs`. It
lands first so every later workstream has a mechanical definition of
done: its rows disappear. The VS Code parameter pin in
`toolRegistration.test.ts` lands with it.

### 2. Write paths (provisional)

`import_model` and `merge_models` gain an output path on MCP and VS
Code, and `merge_models` states its write-back in its description
(barwise-xjf). An `export_model` write records lineage (barwise-ace),
so the lineage tools can see what the other surfaces export. A relative path in VS Code resolves through `resolveWriteDir`
(from `split-model-tool.spec.md`). This is the failure the user hit:
`@barwise` receives only barwise-tagged tools, so a tool that cannot
write its result leaves the agent unable to save it.

### 3. VS Code onto the shared execute functions (provisional)

`barwise_import_transcript` calls `executeImport` with the editor's
client. That function already takes a client as its last argument, so
this gains `base`, `alternatives`, `samples` (the `--samples` row) and
an output path, and fixes barwise-0wa.pte (with barwise-6n8).
`barwise_review_model` calls `executeReview` and gains project input and
`domain` (barwise-rb4). `barwise_export_model`
forwards `options`.

### 4. MCP correctness (provisional)

- `validate_model` runs `projectRules` (barwise-0wa.qh3).
- Every shipped bundle finds the gym catalog (barwise-fbi), with a test that spawns `packages/vscode/dist/mcp/index.js`: the unit suites run on source and cannot see a bundle-only failure.
- No surface's deprecation notice points at an exporter that does not exist (barwise-0wa.ymj for MCP, barwise-zir for the CLI).

### 5. New tools for the section-1 commands (provisional)

`init_project`, `lineage_show`, `gym_show`, and `catalog` on the gym
tools, on both surfaces. VS Code also gains the gym tools (after
workstream 4) and `analyze_repository`.

### 6. `history` (provisional)

`model_history` on both surfaces, after open decision 3.

### 7. Remaining option mirrors (provisional)

| CLI option                 | Tool                                                           |
| -------------------------- | -------------------------------------------------------------- |
| `--infer-references`       | `import_model`                                                 |
| `--lsp-command`            | `import_model`, for the code importers                         |
| `--base-url`               | `import_transcript`, `review_model`                            |
| `--no-annotate`, `--trail` | `import_transcript`                                            |
| `--depth`, `--output`      | `analyze_repository`                                           |
| `--no-synonyms`            | `diff_models`                                                  |
| `--no-warnings`            | `validate_model`                                               |
| `--verbose`                | `describe_domain`, if it changes content rather than rendering |

### 8. Deterministic `prompt` commands (provisional)

`prompt_schema` and `prompt_artifact` first; they need only `llm`. Then
`score`, `rescore`, `history` and `compare`, per open decisions 1 and 4.

## API and migration impact

- **`@barwise/mcp`:** new tools and parameters, all additive. `merge_models` keeps its write-back default.
- **`barwise-vscode`:** new tools, and new parameters on the transcript, review and export tools. The pinned tool lists and the capability matrix change in the same commit as each surface change.
- **`@barwise/learn`:** a catalog the bundle can reach.
- **`@barwise/cli`:** unchanged, unless open decision 2 takes its recommended option. Then `barwise import model --output` refuses an existing file without `--force`, a behaviour change for anyone who relied on the overwrite.
- **Dependency graph:** unchanged, unless open decision 1 takes option A or C.
- **CI:** one new step, `audit:surfaces -- --check`, plus its root forwarder (`check:root-scripts`).

## Open decisions (for review)

1. **The promptlab boundary, for `score`, `rescore`, `history`, `compare`.**
   - (A, recommended) Give promptlab a subpath export of its no-client functions (`loadSuite`, `scoreExtraction`, `readHistory`, `compareRows`, `rescoreDirectory`, `diffRescores`). Let MCP import only that subpath, and add a dependency-cruiser rule forbidding the root and `runSuite`. The guard stays structural: MCP still cannot reach the one function that takes a client. `@barwise/core`'s subpath exports are the precedent.
   - (B) Keep the four CLI-only, with the boundary as the reason.
   - (C) Split promptlab into a no-client package and a runner package. This is the cleanest boundary, but it adds a thirteenth package for four tools.
2. **Overwrite posture for imports and merges onto an existing file.** barwise-pks asks for one rule on every surface, the CLI included: merge into the existing model, or refuse.
   - (Recommended) Adopt pks's rule everywhere. Transcript import keeps merging into an existing model, which never removes anything. `import_model` and `merge_models` with an output path refuse an existing file unless `force` is set, as `split_model` and `barwise project split` already do. This changes the CLI: `barwise import model --output` stops overwriting silently.
   - (Alternative) Refuse only on MCP and VS Code, and leave the CLI overwriting. An overwrite is ordinary for a path a person typed, and riskier for one an agent chose. This leaves pks open.
3. **Where `history`'s git walk lives.**
   - (Recommended) Parallel the roughly 60-line walk in MCP, with a drift test that runs both against one fixture repository. `core` keeps the diff and stays pure.
   - (Alternative) Move the walk into a package both can import. No existing package fits without coupling: `code-analysis` does git I/O for a different concern, and a new package for one function is shallow.
4. **Data files in the VS Code bundle.**
   - Gym exercises: generate them into a module, as `llm/src/prompt/artifacts/builtins.generated.ts` did for the same bundle failure (recommended), or ship the directory and pass its path through `McpServerProvider`.
   - The eval suite, if open decision 1 admits it: take an explicit suite path, defaulting to the workspace's `barwise/packages/promptlab/evals` when it exists (recommended). `prompt eval` appends to the history beside the suite, so a copy generated into the bundle would be a stale snapshot.

## Risks and testing

- **The correspondence file is itself a copy that must agree with the code.** `audit:surfaces` fails on a CLI command with no correspondence entry, so a new command must be classified before it merges.
- **Unit tests run on source; users run bundles.** barwise-fbi shipped because no test spawned a bundle. Workstream 4's spawn test is the guard, and workstream 1 should read the bundled server too, not only `packages/mcp/dist`.
- **Every new guard is seen failing on its defect** through `scripts/mutate.mjs` before its workstream merges.
- **Premortem: the check passes while a gap exists.** This happens if the option-to-parameter mapping maps a CLI option onto an unrelated parameter. Mapping rows name both sides explicitly, and a test plants an unmapped option and expects a failure.

## Non-goals

- No change to what any existing tool returns, beyond the parameters named here.
- No mirroring of what stays CLI-only above, and no reopening of those decisions without the owner.
