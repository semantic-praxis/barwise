# Mirror the CLI's toolset on MCP and VS Code, and make a gap fail CI

Status: Draft -- no workstream implemented

Created: 2026-10-13
Last-updated: 2026-11-04
Tracking: barwise-0wa. Sources: `docs/cli-surface-audit-2026-10-12.md`
(option by option) and `docs/surface-parity-audit-2026-10-12.md`
(runtime behaviour, a separate same-day audit whose issues are mapped
below). The rules for the capability matrix are
`docs/adr/surface-capability-parity.md`; this spec is how its open rows
close.
Touches: barwise/packages/core/src/diff/,
barwise/packages/mcp/src/tools/,
barwise/packages/mcp/src/server.ts,
barwise/packages/mcp/tests/serverSpawn.test.ts,
barwise/packages/vscode/src/mcp/ToolRegistration.ts,
barwise/packages/vscode/src/commands/ImportDbtCommand.ts,
barwise/packages/vscode/src/commands/ImportCodeCommand.ts,
barwise/packages/vscode/package.json,
barwise/packages/vscode/tests/unit/toolRegistration.test.ts,
barwise/packages/cli/src/commands/merge.ts,
barwise/packages/cli/src/commands/import/,
barwise/packages/learn/src/exercise/catalog.ts,
barwise/docs/CLI.md,
barwise/docs/MCP.md,
+barwise/scripts/audit-surfaces.mjs,
+barwise/surface-parity-baseline.json

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

## What stays CLI-only? (resolved by the owner, 2026-10-13 and 2026-11-04)

A gap stays only if mirroring would produce a wrong or unattributable
result, or break a documented safety rule. "Nobody has asked for it"
does not qualify.

| Stays CLI-only                                      | Reason                                                                                                                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt eval`, `prompt run`                         | The only `prompt` commands that call a model. A recorded score needs an attributable model, and MCP sampling reports none (`keyless-model-access.spec.md`)                          |
| `prompt score`, `rescore`, `history`, `compare`     | Owner decision (2026-11-04). promptlab is an application built on barwise, not a library other packages reuse, and these are its commands (see the `prompt` boundary section below) |
| `--thinking-budget`                                 | Declared only on `prompt eval` and `prompt run`                                                                                                                                     |
| `--artifacts`                                       | Unshipped prompt candidates must not reach production commands (`artifact-resolution-parity.spec.md`)                                                                               |
| `import batch`                                      | An evaluation sweep across models, the same family as `prompt eval`                                                                                                                 |
| `llm-usage`                                         | Only the CLI writes the call log (`withCallLog` is used in `cli/src` alone), so a report from another surface would leave out that surface's own calls                              |
| MCP gym session log (`--emit-misses`, `--no-state`) | Owner decision. The log is the learner's history, which the `gym-coach` skill reads, and an agent's checks through MCP would be counted as the learner's                            |

The owner also decided that `merge_models` keeps the base file as its
write target; #637 made its tool description say so. How a write to an
existing model is approved is the next section.

### Rows added to the matrix since the audit

- `rename` and `--matching content` read "none": every surface has them.
- `--surrogate-keys` reaches MCP through `export_model`'s `options` and not VS Code, whose export tool drops `options`. Workstream 3 closes it.
- `migrate` keeps the reason its own spec gave ("rewrites files in place"). It post-dates the owner's 2026-10-13 calls, so this spec does not reopen it; the owner rules on it like any other row.

### Corrections to the audit

The audit is a dated record and is not edited in place. These supersede it:

- It recommended keeping all eight `prompt` subcommands CLI-only. Six call no model, so they fail the test above; the owner chose to mirror them.
- It gave `llm-usage`'s reason as "written by whichever process made the calls." The mechanism is narrower: only the CLI writes the log at all.
- It said a gym session log is "per-person state a shared server should not write." A stdio MCP server runs as the user's own process, so that reason does not hold. The reason in the table above replaces it.
- It found three bugs. The same-day surface-parity audit found more, among them barwise-fbi: the gym fails in every shipped bundle, the server VS Code embeds included. That reproduced again on 2026-11-04.

Presentation flags (`--format text|json`, `--json`) are not mirrored.
MCP and VS Code return JSON because an agent reads the result; the flag
changes the rendering, not what a caller can do.

## How does an import or merge change an existing model? (direction resolved by the owner, 2026-11-04; design provisional)

The owner's direction: a flow that lets a person mindfully allow each
change to their model, in the spirit of `git add -p`. That replaces the
earlier "refuse to overwrite unless forced" proposal (barwise-pks):
refusal is what happens without a review, and the review is the normal
path.

The pieces exist in core. `diffModels(base, incoming)` yields a list of
deltas, and `mergeAndValidate(base, incoming, deltas, accepted)`
applies only the accepted ones. VS Code's palette transcript import
already lets the user pick the deltas to keep, from a multi-select list
(`ImportTranscriptCommand.ts`). What is
missing is the same review on every surface and for every import.

- **CLI on a terminal.** `barwise merge` and `barwise import ... --output <existing>` walk the deltas one at a time, as `git add -p` walks hunks: accept, reject, accept the rest, reject the rest, or quit without writing.
- **CLI without a terminal.** A script or CI run still has a person in the loop (owner, 2026-11-04). There is a feedback loop instead of a flag that accepts changes by kind, in the shape of `terraform plan -out` and `terraform apply`:
  - `--plan <file>` writes a plan instead of the model: the numbered deltas, each verbalized and marked `pending`, plus the fingerprint and the incoming model itself. The plan carries the incoming model because an import's incoming side is an extraction a second run would not reproduce.
  - A person marks each delta `accept` or `reject`. A CI job can post the plan for review, as a Terraform plan is posted on a pull request.
  - `--apply <file>` writes exactly the accepted deltas. It refuses while any delta is still `pending`, and when the fingerprint no longer matches the target.
  - Today's merge default (additions and modifications, never removals) becomes a suggestion printed beside each delta, never a decision.
- **MCP.** Two calls. The first returns the plan, in the format the CLI writes, and writes nothing. The second names the accepted deltas and repeats the fingerprint; the tool applies exactly those, and refuses if either side changed in between. The tool description tells the agent to show the user the deltas and ask. The client's own prompt to approve a tool call is the human gate.
- **VS Code.** The same two calls. On the apply call, `prepareInvocation` returns `confirmationMessages`, so the editor shows the accepted deltas and the user confirms before anything is written. The palette's dbt and code imports, which overwrite today, get the per-delta review the transcript import already has.
- **A target that cannot be read or merged is refused, never overwritten.** Today `barwise import transcript --output` falls back to the fresh extraction in both cases (`cli/src/commands/import/transcript.ts`), and MCP's `executeImport` uses `base` only as context for the model, not as a merge target.
- **The change set is deterministic, so it lives in core:** delta ids in `diffModels`' order, valid only together with the fingerprint they were issued with. One plan format serves the CLI, MCP and VS Code.
- **An LLM may advise and never decide.** The owner asked how LLMs could help. The proposed shape, after the human-only flow ships: an annotation on each delta in the plan, saying what it means, what it affects downstream (from the deterministic impact analysis and lineage), and a suggested decision with a reason. For example, a removal and an addition may be one rename. The annotation records the model that wrote it, as other LLM output does, and lives in `@barwise/llm`, outside core. The decision field is set only by a person. This gets its own spec.

One choice inside this is the owner's (open decision 1), and the
design may graduate to its own spec when workstream 2 is grounded.

## Do the deterministic `prompt` commands cross a package boundary? (resolved: four do, and stay CLI-only)

On 2026-10-13 the owner chose to mirror the six `prompt` commands that
call no model. Two need only `@barwise/llm`, which MCP already depends
on, and are still mirrored:

- `prompt schema` (`buildResponseSchema`, `buildReviewResponseSchema`).
- `prompt artifact` (`resolveArtifact`, `builtinArtifacts`, `hashPrompt`; the hasher moved into `llm` under `artifact-resolution-parity.spec.md`, WS2).

Four need `@barwise/promptlab` and its eval suite: `score`, `rescore`,
`history`, `compare`. MCP may not depend on promptlab. The rule is
`INTENDED.mcp` in `scripts/lib/intended.cjs`, enforced by
dependency-cruiser and `check:architecture`, and two specs rely on it:

- `keyless-model-access.spec.md`: "A sampling call is not deterministic and not attributable. It must never become reachable from promptlab."
- `multi-sample-import.spec.md`: "The scorer lives in dev tooling on purpose."

None of the four calls a model, but all four are promptlab's own
commands. On 2026-11-04 the owner decided that promptlab is an
application built on barwise, not a store of logic other packages
reuse, so the four stay on its front end, the CLI. That reverses the
2026-10-13 call for these four only. The code already has this shape:

- `INTENDED` lists promptlab under `cli` alone, so the graph check enforces it.
- The optimizer reaches promptlab only through the CLI, as a subprocess.
- When another package needed promptlab code, the code moved down. `promptHash` moved into `llm` (`artifact-resolution-parity.spec.md`, WS2), and the scorer's rubric check is `evaluateCandidate` in `learn`.

If the four are ever wanted on MCP, that is the route: the logic moves
down into a library first, under its own spec. It is not recommended,
because the scorer is the application.

## Scope

In scope, as requirements:

- When `npm run audit:surfaces -- --check` runs, the system shall fail on a CLI command or option that has no MCP or VS Code counterpart and no row in the baseline, and on a baseline row no longer detected. When a built surface it reads is missing, it shall exit 2.
- When a workstream closes a behavioural gap (a difference in what a tool does, not in what it accepts), it shall land a regression test that fails on the old behaviour. The baseline records command and parameter gaps only, since a schema cannot show behaviour.
- When a VS Code language-model tool wraps an MCP tool, it shall declare every parameter that MCP tool declares, except parameters the baseline excludes with a reason.
- When `import_model`, `import_transcript` or `merge_models` receives an output path that does not exist, the system shall write the result there.
- When an import or a merge would change an existing model file, on any surface, the system shall present the change as numbered deltas and write only the ones the user accepts (barwise-pks).
- When a CLI run without a terminal would change an existing model, the system shall write a plan for a person to review instead of the model, and shall apply a plan only when no delta is pending and its fingerprint matches the target.
- When the existing target cannot be read or merged, the system shall refuse and write nothing.
- When `export_model` writes an artifact to disk, the system shall record it in the lineage manifest as `barwise export` does (barwise-ace).
- When `export_model` receives a project manifest with no `domain` and an output path, the system shall export every domain into that directory, as `barwise export` does. Today it refuses (`executeExportModel`).
- When an export format produces several files (dbt, Avro) and `export_model` has an output path, the system shall write each file under it, as `barwise export` does. Today it returns only the combined `result.text`.
- When `barwise_import_transcript` runs in VS Code, it shall accept `base`, `alternatives`, `samples` and an output path, and read `transcript` from disk when given a file path (barwise-0wa.pte).
- When `barwise_review_model` runs in VS Code, it shall accept a project manifest and a `domain`.
- When `barwise_export_model` runs in VS Code, it shall forward format options, `dialect` and `surrogateKeys` included.
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
- New options on deprecated tools (`generate_schema`, `generate_diagram`). barwise-0wa.ymj decides their future, and their option gaps take baseline rows naming it.
- The audit's section 5, capabilities MCP or VS Code has and the CLI lacks. The owner's direction is one-way.
- VS Code palette parity. The VS Code column counts a language-model tool as reach (`docs/adr/surface-capability-parity.md`, decision 3), so the palette is a separate question, lineage for its Export... commands included (barwise-ace). The one palette change here is the per-delta review for the dbt and code imports.
- Who may write `prompt eval`'s history. In an installed CLI, `prompt eval` appends beside the packaged suite (`appendRunHistory` at `historyPathFor(suitePath(...))`, which defaults to `defaultSuitePath()`). No tool this spec adds reads or writes that history.

## Inventory

| Area                                                    | Current state                                                                                                      | Verdict                                                                                                                   |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `barwise/scripts/audit-surfaces.mjs`                    | Does not exist                                                                                                     | New: reads the built CLI program, MCP server and VS Code manifest; ratchets command and parameter gaps against a baseline |
| `barwise/surface-parity-baseline.json`                  | Does not exist                                                                                                     | New: one row per gap, `gap` (names its workstream or tracking issue) or `kept` (owner-approved reason)                    |
| `vscode/tests/unit/toolRegistration.test.ts`            | Pins tool names                                                                                                    | Also pins each wrapped tool's parameters against the MCP tool's schema                                                    |
| `@barwise/core/diff`                                    | `diffModels` and `mergeAndValidate` with an accepted set                                                           | Plus a change set: delta ids and a fingerprint (provisional)                                                              |
| `mcp/src/tools/importModel.ts`, `import.ts`, `merge.ts` | No output path; `executeImport`'s `base` is extraction context only; `merge_models` writes the base at once        | Output path; an existing target changes through the reviewed change set                                                   |
| `cli/src/commands/merge.ts`, `import/*.ts`              | `--output` overwrites (`writeOutput`); `import transcript` falls back to the extraction when a merge or read fails | Interactive review on a terminal; a plan to review and apply without one; never overwrite on a failed read or merge       |
| `mcp/src/tools/exportModel.ts`                          | One domain per call; returns the combined `result.text`; records no lineage                                        | Project-wide export, multi-file write through `mcp/src/workspace/stagedWrite.ts`, and lineage on write                    |
| `vscode/src/mcp/ToolRegistration.ts`                    | Separate transcript and review bodies; export forwards three options and drops the rest                            | Transcript and review call `executeImport` and `executeReview` with the editor's client; export forwards `options`        |
| `mcp/src/tools/validate.ts`                             | Per-domain validation only                                                                                         | Also `projectRules`                                                                                                       |
| `learn/src/exercise/catalog.ts`                         | Resolves the catalog from `import.meta.url`, empty in the CJS bundle                                               | Exercises generated into a module (owner, 2026-11-04)                                                                     |
| `mcp/src/tools/`                                        | 19 tools                                                                                                           | Adds `init_project`, `lineage_show`, `gym_show`, `model_history`, `prompt_schema`, `prompt_artifact`                      |
| `cli/src/commands/history.ts`                           | Git walk (about 60 lines of subprocess) plus rendering                                                             | Walk paralleled in MCP, with a drift test (owner, 2026-11-04)                                                             |
| `docs/adr/surface-capability-parity.md`                 | Decision 1 names only `deliberate`; its open list says every row awaits the owner                                  | Names `not yet` with its workstream; the open list records the owner's calls                                              |
| `CLAUDE.md` capability matrix                           | Hand-maintained                                                                                                    | Kept, and checked by `audit:surfaces` for command and parameter reach                                                     |

## Target architecture

```
audit:surfaces (root script, reads built output only)
  CLI      createProgram() from packages/cli/dist -> commands, options
  MCP      createServer() over the SDK's in-memory transport -> tools, schemas
  VS Code  package.json contributes.languageModelTools -> tools, schemas
  correspondence.json  CLI command -> MCP tool -> VS Code tool;
                       CLI option -> parameter, where camelCase is not enough
  surface-parity-baseline.json  every command or parameter gap: gap (WS n or issue) | kept (reason)
  --check: unclassified gap -> fail; stale row -> fail; missing dist -> exit 2

reviewed change set (core, deterministic)
  propose(base, incoming) -> plan { fingerprint, incoming, deltas[] }   writes nothing
  each delta: pending | accept | reject, set by a person
  apply(base, plan)   refuses on a pending delta or a stale fingerprint
  CLI: interactive walk on a terminal, --plan / --apply without one
  MCP: two calls | VS Code: two calls + confirmation

The baseline sees what a surface accepts, not what it does. A workstream
deletes the command and parameter rows it closes, and closes each
behavioural issue with a regression test.
```

## Alternatives considered

- **Keep the hand-maintained matrix and close gaps once.** This is the status quo that went stale twice. The next new CLI option would reopen a gap that nothing reports.
- **Generate the MCP and VS Code tools from the CLI's commander definitions.** It would give one source, but CLI options are shaped for a terminal (stdout, `--format`, exit codes) and tools return JSON. One schema for both would couple the surfaces, against orthogonality. The `execute*` functions are already the shared layer; this spec checks the surfaces instead of fusing them.
- **Put the parity check in a package's test suite.** No package can see both the CLI and MCP: `cli` may not depend on `mcp`, and the reverse is also forbidden. A root script reading built output is the only vantage point that sees all three, which is why the root audits (`audit:duplication`, `audit:rubric`) live there.
- **Refuse to overwrite unless forced.** This was the earlier proposal for barwise-pks. It protects a file, but the only choices it offers a person are all or nothing. The owner asked for a review of each change.

## Workstreams (each independently shippable)

### 1. The parity check, with every current gap in its baseline (provisional: not yet grounded)

Land `audit:surfaces` and a baseline holding every command and
parameter gap the audit found, each marked `gap` with its workstream or
tracking issue, or `kept` with its reason. CI runs `--check`, and writes
go through `scripts/lib/baseline-merge.mjs`. It lands first so every
later workstream has a mechanical definition of done for what a surface
accepts: its rows disappear. Behavioural gaps (validate's project rules,
the bundled gym, export lineage, overwrite on import) are invisible to a
schema; each closes with a regression test in its own workstream. The
VS Code parameter pin in `toolRegistration.test.ts` lands with it.

### 2. Write paths and reviewed changes (provisional)

- `import_model`, `import_transcript` and `merge_models` gain an output path on MCP and VS Code. `executeImport` writes nothing today, so the transcript path is new in the shared function and its MCP registration, not only forwarded.
- A new file is written directly. An existing file changes only through the reviewed change set (above), on every surface, and a target that cannot be read or merged is refused.
- `merge_models` keeps the base as its target and already discloses that (#637, barwise-xjf).
- `export_model` writes the way `barwise export` does:
  - every domain of a project when no `domain` is given;
  - each file of a multi-file format, through MCP's staged writer, which is paired with the CLI's in `parity.manifest.json`;
  - a lineage entry for each write (barwise-ace), so the lineage tools see what the other surfaces export.
- A relative path in VS Code resolves through `resolveWriteDir` (from `split-model-tool.spec.md`).

This is the failure the user hit: `@barwise` receives only barwise-tagged
tools, so a tool that cannot write its result leaves the agent unable to
save it.

### 3. VS Code onto the shared execute functions (provisional)

`barwise_import_transcript` calls `executeImport` with the editor's
client. That function already takes a client as its last argument. The
tool gains `base`, `alternatives`, `samples` (the `--samples` row) and
the output path from workstream 2, and this fixes barwise-0wa.pte (with
barwise-6n8). `barwise_review_model` calls `executeReview` and gains
project input and `domain` (barwise-rb4). `barwise_export_model`
forwards `options`, which closes the `--surrogate-keys` row.

### 4. MCP correctness (provisional)

- `validate_model` runs `projectRules` (barwise-0wa.qh3).
- Every shipped bundle finds the gym catalog (barwise-fbi), with a test that spawns `packages/vscode/dist/mcp/index.js`: the unit suites run on source and cannot see a bundle-only failure.
- No surface's deprecation notice points at an exporter that does not exist (barwise-0wa.ymj for MCP, barwise-zir for the CLI).

### 5. New tools for the section-1 commands (provisional)

`init_project`, `lineage_show`, `gym_show`, and `catalog` on the gym
tools, on both surfaces. VS Code also gains the gym tools (after
workstream 4) and `analyze_repository`.

### 6. `history` (provisional)

`model_history` on both surfaces. MCP carries its own copy of the git
walk, with a drift test that runs it and the CLI's against one fixture
repository (owner, 2026-11-04).

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

`prompt_schema` and `prompt_artifact`, which need only `llm`. `score`,
`rescore`, `history` and `compare` stay CLI-only (owner, 2026-11-04),
so no eval suite enters a bundle.

## API and migration impact

- **`@barwise/core`:** a change-set API beside `diffModels` and `mergeAndValidate`; additive.
- **`@barwise/mcp`:** new tools and parameters. Two changes are not additive. `merge_models` stops writing in a single call and proposes first. An import onto an existing file goes through the same review. Both are behaviour changes for an agent that relied on the immediate write.
- **`barwise-vscode`:** new tools; new parameters on the transcript, review and export tools; a confirmation step before a reviewed write. The pinned tool lists and the capability matrix change in the same commit as each surface change.
- **`@barwise/learn`:** exercises generated into a module the bundle can reach.
- **`@barwise/cli`:**
  - `barwise merge --output <existing>` and `barwise import ... --output <existing>` review interactively on a terminal.
  - Without a terminal, they write a plan for a person to review, and `--apply` writes the accepted deltas.
  - `import transcript` stops overwriting an existing file it cannot read or merge.
  - Each is a behaviour change for a script that relied on the overwrite.
- **Dependency graph:** unchanged. Only the CLI depends on promptlab (owner, 2026-11-04).
- **CI:** one new step, `audit:surfaces -- --check`, plus its root forwarder (`check:root-scripts`).

## Open decisions (for review)

1. **Does `merge_models` keep a one-call write onto an existing model?** Today one call accepts every addition and modification, rejects every removal, and writes the base file (`mcp/src/tools/merge.ts`). VS Code shows no confirmation first: its tool wrapper returns only a progress message (`ToolRegistration.ts`, `register`). The question is whether a caller may still do that, by naming up front which kinds of change it accepts, or whether every write to an existing model starts with a plan.
   - Recommended: no one-call write onto an existing model. An agent offered a one-call path and a two-call path will take the one-call path, so it would become the default in practice whatever the description says. Requiring a plan's fingerprint on every write to an existing model means no change can be written unseen. This revises the earlier recommendation (keep it, never as the default), which was made before the owner asked for a person in the loop on every surface.
   - Not affected: a merge whose base is inline YAML writes nothing, and a merge or import to a new file has nothing to protect. Both stay one call.
   - Cost: an agent that relied on the immediate write now makes two calls, and an MCP client that auto-approves tool calls gets no extra gate from the second one. The plan is still shown to the person by the agent, and VS Code's confirmation step is the gate there.

### Resolved by the owner (2026-11-04)

- **How a run without a terminal accepts changes:** through a feedback loop with a person in it, not a flag that accepts by kind. Start from the expectation of a human in the loop, and consider how LLMs can help. The plan and apply mechanism and the advisory LLM annotation above are the proposed design, provisional until workstream 2 is grounded.
- **Where `history`'s git walk lives:** a copy in MCP with a drift test against the CLI's (workstream 6). No existing package fits both without coupling, and `core` keeps the diff and stays pure.
- **Where `score`, `rescore`, `history` and `compare` live:** on the CLI only. promptlab is an application built on barwise, not a library other packages reuse. This replaced the question of how they would reach MCP, and both options for it (a promptlab subpath export MCP could import, or a split package).
- **Data files in the VS Code bundle:** gym exercises generated into a module, as `llm/src/prompt/artifacts/builtins.generated.ts` did for the same bundle failure. The owner also accepted that a bundled eval suite would default to the packaged one; since the promptlab commands stay CLI-only, no bundle loads the suite, and that half no longer applies.

## Risks and testing

- **The correspondence file is itself a copy that must agree with the code.** `audit:surfaces` fails on a CLI command with no correspondence entry, so a new command must be classified before it merges.
- **Unit tests run on source; users run bundles.** barwise-fbi shipped because no test spawned a bundle. Workstream 4's spawn test is the guard, and workstream 1 should read the bundled server too, not only `packages/mcp/dist`.
- **Every new guard is seen failing on its defect** through `scripts/mutate.mjs` before its workstream merges.
- **Premortem: the check passes while a gap exists.** This happens if the option-to-parameter mapping maps a CLI option onto an unrelated parameter. Mapping rows name both sides explicitly, and a test plants an unmapped option and expects a failure.
- **Premortem: a review that nobody reviewed.**
  - An agent may accept every delta without showing them. VS Code's confirmation step and the MCP client's approval prompt are the gates a person sees. The tool description is guidance only.
  - A delta id from a stale proposal could apply the wrong change. The fingerprint check refuses it, and a test applies a proposal after the target changed and expects a refusal.
  - A person may mark every delta `accept` without reading. Nothing prevents that. A plan at least makes the choice visible and recorded, which a flag accepting by kind would not.

## Non-goals

- No change to what any existing tool returns, beyond the parameters and behaviours named here.
- No mirroring of what stays CLI-only above, and no reopening of those decisions without the owner.
