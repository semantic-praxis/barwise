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
barwise/packages/mcp/src/workspace/,
barwise/packages/vscode/src/mcp/ToolRegistration.ts,
barwise/packages/vscode/src/chat/chatPrompts.ts,
barwise/packages/vscode/src/commands/ImportTranscriptCommand.ts,
barwise/packages/vscode/src/commands/ImportDbtCommand.ts,
barwise/packages/vscode/src/commands/ImportCodeCommand.ts,
barwise/packages/vscode/package.json,
barwise/packages/vscode/tests/,
barwise/packages/cli/src/commands/merge.ts,
barwise/packages/cli/src/commands/analyze.ts,
barwise/packages/cli/src/commands/import/,
barwise/packages/learn/src/exercise/,
barwise/docs/CLI.md,
barwise/docs/MCP.md,
barwise/package.json,
package.json,
.github/workflows/ci.yml,
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
result, break a documented safety rule, or cross a package boundary the
owner has kept closed (promptlab, below). "Nobody has asked for it"
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

- It recommended keeping all eight `prompt` subcommands CLI-only, on the ground that a score needs an attributable model and a run costs API spend. Six call no model, so that ground fails the test above for them, and the owner chose on 2026-10-13 to mirror all six. On 2026-11-04 the owner kept four of them CLI-only for a different reason, the promptlab boundary (below), so the audit's conclusion stands for those four and only `prompt schema` and `prompt artifact` are mirrored.
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

What the review covers: a write onto an existing model file by `barwise merge --output`, `barwise import ... --output` and `barwise analyze --output`, and by their MCP and VS Code counterparts. `barwise merge` without `--output` prints to stdout, modifies nothing, and is unchanged.

- **The deltas are computed against the model at the write target.** That is the existing file the write would change, whatever `base` names. A merge whose output path names an existing file other than its base is refused, because the deltas it would show describe a different model from the one it would change. For `import_transcript`, `base` stays extraction context, and the plan diffs the extraction against the target file.
- **CLI on a terminal.** When stdin is a terminal, the CLI walks the deltas one at a time, as `git add -p` walks hunks: accept, reject, accept the rest, reject the rest, or quit without writing. Prompts go to stderr. `--plan` and `--apply` take precedence: with either, the CLI does not walk the deltas, on a terminal or not.
- **CLI without a terminal.** A script or CI run still has a person in the loop (owner, 2026-11-04). There is a feedback loop instead of a flag that accepts changes by kind, in the shape of `terraform plan -out` and `terraform apply`:
  - `--plan <file>` writes a plan instead of the model: the numbered deltas, each verbalized and marked `pending`, plus the fingerprint and the incoming model itself. Every delta starts `pending`, never pre-filled with its suggestion (owner, 2026-11-04), so a plan nobody opened cannot be applied. The plan carries the incoming model because an import's incoming side is an extraction a second run would not reproduce.
  - A person marks each delta `accept` or `reject`. A CI job can post the plan for review, as a Terraform plan is posted on a pull request.
  - `--apply <file>` writes exactly the accepted deltas. It refuses while any delta is still `pending`, and when the fingerprint no longer matches.
  - A run with no terminal, an existing target and neither `--plan` nor `--apply` refuses, writes nothing, exits non-zero, and names `--plan`.
  - Today's merge default (additions and modifications, never removals) becomes a suggestion printed beside each delta, never a decision within a review. A merge to stdout or to a new file changes no existing model and keeps today's rule.
- **What a delta shows, from core and deterministic.** Its label and change (`deltaLabel`, `describeChange`), its breaking level (`classifyBreakingLevel`), and any rename candidate (`diff/synonyms.ts`). The VS Code transcript picker already shows the breaking level and the rename candidates; the plan carries all of it on every surface.
- **The fingerprint covers everything the decisions were made against:** the target file, the incoming model the plan carries, the delta list, the diff options, and the plan format's version. `--apply` recomputes the deltas from the target and the carried incoming model and refuses unless every part matches. An edited plan, a changed target, or a barwise version that orders the deltas differently is refused, not applied.
- **MCP.** Two calls. The first writes the plan beside the target file (a plan exists only when there is one) and returns the numbered deltas, the fingerprint and the plan's path; it does not change the model. The second names the plan's path, repeats the fingerprint the first call returned, and gives every delta a decision, `accept` or `reject`. It refuses when the plan's fingerprint differs from the one repeated, so decisions never land on a plan other than the one the user was shown, and when a delta is left without a decision, as `--apply` does.
  - The plan file is named by its target and fingerprint (`<target>.<fingerprint prefix>.plan.yaml`), so a second proposal writes a second file instead of replacing the first. A successful apply deletes it. An abandoned plan stays until someone deletes it, and the first call's result says where it is. The CLI's `--plan <file>` writes where it is told. The plan travels as a file, not through the agent's context, so the incoming model is never copied back by hand. The tool description tells the agent to show the user the deltas and ask; the client's own prompt to approve a tool call is the human gate. There is no one-call write onto an existing model (owner, 2026-11-04). A merge whose base is inline YAML and has no output path writes nothing, and a write to a new file has nothing to protect, so both stay one call.
- **VS Code language-model tools.** The same two calls as MCP; the agent asks the user in chat and passes the decisions. On the apply call, `prepareInvocation` returns `confirmationMessages`, so the editor shows the accepted deltas and the user confirms before anything is written.
- **VS Code palette imports.** The palette's dbt and code imports, which overwrite today, get the quick pick of deltas the transcript import has, then write the accepted ones. Every palette pick starts with nothing selected (owner, 2026-11-04), and its title says to check what to accept. The transcript import's picker, which pre-selects every addition and modification today and is titled "uncheck to reject" (`ImportTranscriptCommand.ts`), stops pre-selecting. A pick that accepts nothing writes nothing: today the transcript import rewrites the file even then, re-serialized and annotated with the rejected extraction (its `accepted.size === 0` branch returns the existing model, which the command then writes), and that stops.
- **A target that cannot be read or merged is refused, never overwritten.** Today `barwise import transcript --output` falls back to the fresh extraction in both cases (`cli/src/commands/import/transcript.ts`), and MCP's `executeImport` uses `base` only as context for the model, not as a merge target.
- **The change set is deterministic, so it lives in core:** delta ids in `diffModels`' order, valid only together with the fingerprint they were issued with. One plan format serves the CLI, MCP and the VS Code tools.
- **An LLM may advise and never decide.** The owner asked how LLMs could help. The proposed shape, after the human-only flow ships: an annotation on each delta in the plan for what core cannot judge, such as whether a change matches what the transcript says, or whether a new name follows the model's conventions. Breaking level and rename candidates already come from core. The annotation records the model that wrote it, as other LLM output does, and lives in `@barwise/llm`, outside core. The decision field is set only by a person. This gets its own spec.

The design may graduate to its own spec when workstream 2 is grounded.

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

- When `npm run audit:surfaces -- --check` runs, the system shall fail on a CLI command or option that lacks a counterpart on either MCP or VS Code and has no row in the baseline for that surface, and on a baseline row no longer detected. When a built surface it reads is missing, it shall exit 2.
- When a workstream closes a behavioural gap (a difference in what a tool does, not in what it accepts), it shall land a regression test that fails on the old behaviour. The baseline records command and parameter gaps only, since a schema cannot show behaviour.
- When a VS Code language-model tool wraps an MCP tool, it shall declare every parameter that MCP tool declares, except parameters the baseline excludes with a reason.
- When `import_model`, `import_transcript` or `merge_models` receives an output path that does not exist, the system shall write the result there.
- When an import, an analyze or a merge would change an existing model file, on any surface, the system shall present the change as numbered deltas against that file and write only the ones the user accepts (barwise-pks).
- When a CLI run without a terminal would change an existing model, the system shall write a plan for a person to review instead of the model when `--plan` names a file, apply a plan when `--apply` names one, and refuse, write nothing and exit non-zero when neither is given.
- When a plan is applied, on any surface, the system shall refuse while any delta is pending or any part of its fingerprint no longer matches.
- When a merge's output path names an existing file other than its base, the system shall refuse and write nothing.
- When a VS Code palette import shows its pick of deltas, the system shall pre-select none; when the user accepts none, it shall write nothing.
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
- VS Code palette parity. The VS Code column counts a language-model tool as reach (`docs/adr/surface-capability-parity.md`, decision 3), so the palette is a separate question, lineage for its Export... commands included (barwise-ace). The palette changes here are the per-delta review for the dbt and code imports and the transcript picker's default.
- Who may write `prompt eval`'s history. In an installed CLI, `prompt eval` appends beside the packaged suite (`appendRunHistory` at `historyPathFor(suitePath(...))`, which defaults to `defaultSuitePath()`). No tool this spec adds reads or writes that history.

## Inventory

| Area                                                     | Current state                                                                                                      | Verdict                                                                                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `barwise/scripts/audit-surfaces.mjs`                     | Does not exist                                                                                                     | New: reads the built CLI program, MCP server and VS Code manifest; ratchets command and parameter gaps against a baseline                         |
| `barwise/surface-parity-baseline.json`                   | Does not exist                                                                                                     | New: one row per gap, `gap` (names its workstream or tracking issue) or `kept` (owner-approved reason)                                            |
| `vscode/tests/unit/toolRegistration.test.ts`             | Pins tool names                                                                                                    | Also pins each wrapped tool's parameters against the MCP tool's schema                                                                            |
| `@barwise/core/diff`                                     | `diffModels` and `mergeAndValidate` with an accepted set                                                           | Plus a change set: delta ids and a fingerprint (provisional)                                                                                      |
| `mcp/src/tools/importModel.ts`, `import.ts`, `merge.ts`  | No output path; `executeImport`'s `base` is extraction context only; `merge_models` writes the base at once        | Output path; an existing target changes through the reviewed change set                                                                           |
| `cli/src/commands/merge.ts`, `import/*.ts`, `analyze.ts` | `--output` overwrites (`writeOutput`); `import transcript` falls back to the extraction when a merge or read fails | Interactive review on a terminal; a plan to review and apply without one; never overwrite on a failed read or merge                               |
| `vscode/src/commands/ImportTranscriptCommand.ts`         | Picker pre-selects every addition and modification                                                                 | Nothing pre-selected (owner, 2026-11-04)                                                                                                          |
| `vscode/src/chat/chatPrompts.ts`, `docs/MCP.md`          | Describe `merge_models` as one call                                                                                | Describe the two calls and tell the agent to show the deltas and ask                                                                              |
| `mcp/src/tools/exportModel.ts`                           | One domain per call; returns the combined `result.text`; records no lineage                                        | Project-wide export, multi-file write through `mcp/src/workspace/stagedWrite.ts`, and lineage on write                                            |
| `vscode/src/mcp/ToolRegistration.ts`                     | Separate transcript and review bodies; export forwards three options and drops the rest                            | Transcript and review call `executeImport` and `executeReview` with the editor's client; export forwards `options`                                |
| `mcp/src/tools/validate.ts`                              | Per-domain validation only                                                                                         | Also `projectRules`                                                                                                                               |
| `learn/src/exercise/catalog.ts`                          | Resolves the catalog from `import.meta.url`, empty in the CJS bundle                                               | Exercises generated into a module (owner, 2026-11-04)                                                                                             |
| `mcp/src/tools/`                                         | 19 tools                                                                                                           | Adds `init_project`, `lineage_show`, `gym_show`, `model_history`, `prompt_schema`, `prompt_artifact`                                              |
| `cli/src/commands/history.ts`                            | Git walk (about 60 lines of subprocess) plus rendering                                                             | Walk paralleled in MCP, with a drift test (owner, 2026-11-04)                                                                                     |
| `docs/adr/surface-capability-parity.md`                  | Decision 1 names only `deliberate`; its open list says every row awaits the owner                                  | Names `not yet` with its workstream; the open list records the owner's calls                                                                      |
| `CLAUDE.md` capability matrix                            | Hand-maintained                                                                                                    | Kept and still hand-maintained: `audit:surfaces` checks the surfaces against each other and the baseline, not this table (barwise-xpt stays open) |

## Target architecture

```
audit:surfaces (root script, reads built output only)
  CLI      createProgram() from packages/cli/dist -> commands, options
  MCP      createServer() over the SDK's in-memory transport -> tools, schemas
  VS Code  package.json contributes.languageModelTools -> tools, schemas
  correspondence.json  every CLI command -> MCP tool -> VS Code tool, or a baseline row;
                       CLI option -> parameter only where camelCase is not enough
  surface-parity-baseline.json  every command or parameter gap: gap (WS n or issue) | kept (reason)
  --check: unclassified gap -> fail; stale row -> fail; missing dist -> exit 2

reviewed change set (core, deterministic)
  propose(target, incoming, options) -> plan { fingerprint, incoming, deltas[] }   pure
  fingerprint: target, incoming, delta list, diff options, plan format version
  each delta: pending | accept | reject, set by a person; label, breaking level, rename candidate
  apply(target, plan)   refuses on a pending delta or any fingerprint mismatch
  CLI: interactive walk on a terminal, --plan / --apply without one
  MCP: propose writes the plan file beside the target; apply names it, repeats its fingerprint, decides every delta
  VS Code tools: the MCP calls + confirmation | palette: a quick pick with nothing pre-selected

The baseline sees what a surface accepts, not what it does. A workstream
deletes the command and parameter rows it closes, and closes each
behavioural issue with a regression test.
```

## Alternatives considered

- **Keep the hand-maintained matrix and close gaps once.** This is the status quo that went stale twice. The next new CLI option would reopen a gap that nothing reports.
- **Generate the MCP and VS Code tools from the CLI's commander definitions.** It would give one source, but CLI options are shaped for a terminal (stdout, `--format`, exit codes) and tools return JSON. One schema for both would couple the surfaces, against orthogonality. The `execute*` functions are already the shared layer; this spec checks the surfaces instead of fusing them.
- **Put the parity check in a package's test suite.** No package can see both the CLI and MCP: `cli` may not depend on `mcp`, and the reverse is also forbidden. A root script reading built output is the only vantage point that sees all three, which is why the root audits (`audit:duplication`, `audit:rubric`) live there.
- **Refuse to overwrite unless forced.** This was the earlier proposal for barwise-pks. It protects a file, but the only choices it offers a person are all or nothing. The owner asked for a review of each change.
- **Return the MCP plan inline and take it back on the apply call.** It keeps the server from writing anything on the first call, but a large import's model then travels through the agent's context twice and must come back byte for byte; an agent that reformats it makes every apply refuse on the fingerprint. A plan exists only when there is a target file, so there is always a directory to write it into.

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
- A new file is written directly. An existing file changes only through the reviewed change set (above), on every surface, and a target that cannot be read or merged is refused. That covers `barwise analyze --output`, which overwrites today (`analyze.ts`, `writeOutput`), and the `analyze_repository` output path workstream 7 adds.
- The VS Code palette's transcript, dbt and code imports onto an existing model get the per-delta pick, with nothing pre-selected (owner, 2026-11-04), and write nothing when the user accepts none. An import into a new file shows no pick.
- The agent guidance moves with the behaviour: `chatPrompts.ts`'s merge instruction and `docs/MCP.md`'s `merge_models` section describe the two calls, in the commit that changes them.
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

`model_history` on both surfaces. This is `model-history.spec.md`'s
open WS2, which it closes, and it keeps that spec's requirement that
the output is bounded through `boundedTextResult`. MCP carries its own
copy of the git walk, with a drift test that runs it and the CLI's
against one fixture repository (owner, 2026-11-04).

### 7. Remaining option mirrors (provisional)

| CLI option                 | Tool                                                                            |
| -------------------------- | ------------------------------------------------------------------------------- |
| `--infer-references`       | `import_model`                                                                  |
| `--lsp-command`            | `import_model`, for the code importers                                          |
| `--base-url`               | `import_transcript`, `review_model`                                             |
| `--no-annotate`, `--trail` | `import_transcript`                                                             |
| `--depth`, `--output`      | `analyze_repository`; an existing output goes through the review (workstream 2) |
| `--no-synonyms`            | `diff_models`                                                                   |
| `--no-warnings`            | `validate_model`                                                                |
| `--verbose`                | `describe_domain`, if it changes content rather than rendering                  |

### 8. Deterministic `prompt` commands (provisional)

`prompt_schema` and `prompt_artifact`, which need only `llm`. `score`,
`rescore`, `history` and `compare` stay CLI-only (owner, 2026-11-04),
so no eval suite enters a bundle.

## API and migration impact

- **`@barwise/core`:** a change-set API beside `diffModels` and `mergeAndValidate`; additive.
- **`@barwise/mcp`:** new tools and parameters. Two changes are not additive. `merge_models` stops writing in a single call: the first call writes a plan file beside the target, and the second applies the decisions. An import onto an existing file goes through the same review. Both are behaviour changes for an agent that relied on the immediate write.
- **`barwise-vscode`:** new tools; new parameters on the transcript, review and export tools; a confirmation step before a reviewed write. The palette transcript import stops pre-selecting deltas (owner, 2026-11-04), a behaviour change for a user used to pressing Enter. The `@barwise` participant's merge instruction changes with `merge_models`. The pinned tool lists and the capability matrix change in the same commit as each surface change.
- **`@barwise/learn`:** exercises generated into a module the bundle can reach.
- **`@barwise/cli`:**
  - `barwise merge --output <existing>`, `barwise import ... --output <existing>` and `barwise analyze --output <existing>` review interactively on a terminal.
  - Without a terminal, they write a plan for a person to review when given `--plan`, and refuse otherwise; `--apply` writes the accepted deltas.
  - `barwise merge --output` naming an existing file other than its base is refused.
  - `import transcript` stops overwriting an existing file it cannot read or merge.
  - Each is a behaviour change for a script that relied on the overwrite.
- **Dependency graph:** unchanged. Only the CLI depends on promptlab (owner, 2026-11-04).
- **CI:** one new step, `audit:surfaces -- --check`, plus its root forwarder (`check:root-scripts`).

## Open decisions (for review)

None. Every decision this spec needed is resolved below.

### Resolved by the owner (2026-11-04)

- **`merge_models` has no one-call write onto an existing model.** Today one call accepts every addition and modification, rejects every removal, and writes the base file (`mcp/src/tools/merge.ts`), and VS Code confirms nothing first: its tool wrapper returns only a progress message (`ToolRegistration.ts`, `register`).
  - Why: an agent offered a one-call path and a two-call path takes the one-call path, so a shortcut would become the default in practice whatever the description says. Requiring a plan's fingerprint on every write to an existing model means no change is written unseen.
  - Not affected: a merge whose base is inline YAML writes nothing, and a merge or import to a new file has nothing to protect. Both stay one call.
  - Cost: an agent that relied on the immediate write now makes two calls, and an MCP client that auto-approves tool calls gets no extra gate from the second one. The agent still shows the plan to the person, and VS Code's confirmation step is the gate there.
- **Deltas start `pending`.** A plan is never pre-filled with its suggestions, so `--apply` cannot run on a plan nobody opened. That covers every surface that uses a plan: an MCP or VS Code tool apply call decides every delta.
- **The VS Code palette's import pickers start with nothing selected**, in the transcript, dbt and code imports alike. The quick pick has no plan, and an unselected delta is rejected, so a pre-selected pick is the pre-filled plan ruled out above in another form. The transcript import pre-selects every addition and modification today, so pressing Enter there stops accepting them. The alternative, keeping the pre-selection and extending it to the dbt and code imports, was rejected: it would leave the palette the one place a change is accepted without being picked.

- **How a run without a terminal accepts changes:** through a feedback loop with a person in it, not a flag that accepts by kind. Start from the expectation of a human in the loop, and consider how LLMs can help. The plan and apply mechanism and the advisory LLM annotation above are the proposed design, provisional until workstream 2 is grounded.
- **Where `history`'s git walk lives:** a copy in MCP with a drift test against the CLI's (workstream 6). No existing package fits both without coupling, and `core` keeps the diff and stays pure.
- **Where `score`, `rescore`, `history` and `compare` live:** on the CLI only. promptlab is an application built on barwise, not a library other packages reuse. This replaced the question of how they would reach MCP, and both options for it (a promptlab subpath export MCP could import, or a split package).
- **Data files in the VS Code bundle:** gym exercises generated into a module, as `llm/src/prompt/artifacts/builtins.generated.ts` did for the same bundle failure. The owner also accepted that a bundled eval suite would default to the packaged one; since the promptlab commands stay CLI-only, no bundle loads the suite, and that half no longer applies.

## Risks and testing

- **The correspondence file is itself a copy that must agree with the code.** Every CLI command needs an entry or a baseline row, and `audit:surfaces` fails on one with neither, so a new command is classified before it merges. Options pair by camelCase unless an entry says otherwise.
- **Tripwires for the provisional change-set design.** Each reopens the design before workstream 2 is built on it:
  - `diffModels` returns a different delta order for the same target, incoming model and options (a property test in workstream 2). Index ids would then not survive between the two calls, and the plan needs content-derived ids.
  - The VS Code version the extension supports does not show `confirmationMessages` for a language-model tool. The quick pick is then the only gate in VS Code, and the spec says so.
  - A realistic transcript import yields more deltas than a person will read one at a time. The review then needs grouping (by element, or by breaking level) before it ships.
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
