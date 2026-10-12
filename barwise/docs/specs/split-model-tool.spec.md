# Let an agent split a model into a project: `split_model` on MCP and VS Code

Status: Workstream 1 implemented (core and CLI); 2 and 3 not yet

Created: 2026-10-12
Last-updated: 2026-10-12
Tracking: barwise-knq.z9s (child of the barwise-knq multi-file project
epic)

## Principle

Composability. `splitModel` is pure core: it takes model YAML and a
domain assignment and returns the manifest, domain files, mappings and
warnings as strings. Only the CLI calls it. A user asked the `@barwise`
chat participant to "create a .orm-project.yaml and then split our
giant auction.orm.yaml into domain-specific files", and the agent
answered that no tool could, then proposed calling `merge_models` once
per domain with a hand-cut fragment and a not-yet-existing `base` path,
so the merge would write a new file. That workaround loses everything
`splitModel` does: value-type inference, shadow object types, dropped
cross-domain constraints, generated mappings, and the manifest.

The capability matrix in `CLAUDE.md` marks `project` CLI-only as
"deliberate: repository operations". That reason does not hold for
`split`. Two MCP tools already write files (`merge_models` writes back
to its base, `export_model` writes to `outputPath`), and splitting a
model is a modelling operation, not a repository one. The gap is an
omission recorded as intent, which is the failure barwise-988 named.

## Should `project init` come along? (resolved: no)

`split` writes a complete manifest, so the user's request needs only
`split`. `init` writes an empty manifest and two empty directories. A
chat agent can do nothing further with that manifest, because no tool
adds a domain to an existing manifest. `init` stays CLI-only and gets
its own matrix row with that reason. `history` keeps "repository
operations" (it shells out to git), which is the reason the shared row
was written for.

## Scope

In scope:

- When `split_model` is called without `outDir`, the system shall
  write nothing and return, per domain, the context, the file it would
  write, the entity types it owns, the object types it shares from
  other domains, its value-type and fact-type counts, plus the mapping
  files and every warning `splitModel` produced.
- When `split_model` is called with `outDir`, the system shall write
  the manifest, every domain file and every mapping file under
  `outDir`, and return their absolute paths with the same summary.
- When any target file already exists and `force` is not true, the
  system shall write nothing and return an error listing the existing
  files. The CLI's `project split` applies the same rule (today it
  checks only the manifest).
- When a domain name is empty or contains `/` or `\`, `splitModel`
  shall throw `ModelSplitError`. Core turns the name into
  `domains/<name>.orm.yaml`, so core is where the name is checked. Dot
  names need no rule: the suffix turns `..` into the file
  `...orm.yaml`, inside `domains/`.
- When the VS Code tool receives a relative `outDir`, it shall resolve
  it against the workspace folder that contains the source model (the
  first workspace folder if none does), and refuse when the window has
  no workspace folder.
- When either surface's tool list changes, the pinned lists, the
  `contributes.languageModelTools` declaration and the capability
  matrix change in the same commit.

Out of scope:

- `project init` on MCP or VS Code (see above).
- A tool equivalent of `--scaffold-config`. An agent gets the entity
  list from `query_model` (`entities`) and proposes the assignment
  itself; a scaffold that lists every entity under the first domain
  adds nothing to that.
- Reading a split config file. The CLI's `--config` file holds exactly
  `projectName` and `domains`; the tool takes those two fields
  directly.
- Relative `source` paths in VS Code tools. Every tool resolves them
  against the extension host's working directory today. A wrong read
  fails loudly with ENOENT; a wrong write would succeed silently in the
  wrong place, which is why this spec fixes `outDir` and files the
  `source` case separately.
- A `/split` chat slash command. The participant routes free-form
  requests to tools already, which is how the user asked.

## Inventory

| Module                                       | Current state                                    | Verdict                                                            |
| -------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------ |
| `core/src/project/splitModel.ts`             | Pure split; manifest name not part of the result | Add `manifestFileName` to `SplitResult`; reject separator names    |
| `cli/src/commands/project.ts`                | Hard-codes `project.orm-project.yaml`            | Read `result.manifestFileName`; refuse when any target exists      |
| `mcp/src/tools/split.ts`                     | Does not exist                                   | New: `split_model` tool and `executeSplit`                         |
| `mcp/src/tools/index.ts`, `server.ts`        | Register and re-export 17 tools                  | Register `split_model`; re-export `executeSplit`                   |
| `vscode/src/mcp/ToolRegistration.ts`         | Registers 14 tools                               | Register `barwise_split_model`                                     |
| `vscode/src/mcp/resolveModelSource.ts`       | Pure source-resolution policy                    | Add `resolveWriteDir` (pure, unit-tested)                          |
| `vscode/package.json`                        | Declares 14 `languageModelTools`                 | Declare `barwise_split_model`                                      |
| `vscode/src/chat/chatPrompts.ts`             | System prompt lists the tools                    | List the split tool and the preview-then-write workflow            |
| `mcp/tests/serverSpawn.test.ts`              | Pins the MCP tool list with `toEqual`            | Add `split_model`                                                  |
| `vscode/tests/unit/toolRegistration.test.ts` | Pins the VS Code tool list with `toEqual`        | Add `barwise_split_model`                                          |
| `CLAUDE.md` capability matrix                | `project`, `history`: CLI only, one reason       | Three rows: `project split` (all), `project init`, `history` (CLI) |
| `docs/MCP.md`, `docs/ORM_PROJECT_GUIDE.md`   | Say splitting needs the CLI                      | Document `split_model`                                             |

`scaffoldSplitConfig` and `parseSplitConfig` are untouched; only the
CLI uses them, for the config file this spec leaves out of the tool.

## Target architecture

```
@barwise/core   splitModel(yaml, { projectName, domains }) -> SplitResult
                  + manifestFileName ("project.orm-project.yaml")
                  + throws on an empty domain name or one with a separator
                  (pure; no fs)

@barwise/cli    project split   reads the config file, calls splitModel,
                                refuses if any target exists, writes
@barwise/mcp    split_model     takes projectName + domains, calls
                                splitModel; no outDir -> preview,
                                outDir -> refuse if any target exists,
                                write, report paths
barwise-vscode  barwise_split_model
                                resolveSourceParam (open model fallback),
                                resolveWriteDir (workspace-relative),
                                then executeSplit
```

The write loop exists twice, in the CLI and in `executeSplit`, because
the CLI cannot depend on `@barwise/mcp`. That is the DRY-secondary
trade the root `CLAUDE.md` describes: about ten lines of parallel I/O,
with every fact the two must agree on (file names, manifest name, file
set) read from the one `SplitResult`.

## Alternatives considered

- **Leave the gap and teach the agent the CLI.** The VS Code agent has
  no shell tool in the `@barwise` participant, so it cannot run the
  CLI; the user would be told to switch tools mid-conversation. This
  is what the matrix's "deliberate" label produced.
- **An explicit `dryRun` flag.** Rejected for preview-by-omission of
  `outDir`, which matches `export_model`'s `outputPath` and needs no
  default directory. The VS Code extension host's working directory is
  not the workspace, so any implicit default would write somewhere the
  user did not choose.
- **Return the domain YAML inline in the preview.** A split of a large
  model is tens of kilobytes; the summary is what a person reviews, and
  the files are on disk once written.

## Workstreams

The three land as separate commits in one PR: the tool is only useful
once VS Code registers it, and the pinned lists make the MCP and VS
Code changes reviewable together.

### 1. Core and CLI

Add `manifestFileName` to `SplitResult` and the domain-name check to
`splitModel`. The CLI reads the manifest name from the result and
checks every target before writing. Tests: a core test for each new
behaviour; a CLI test that a pre-existing domain file blocks the split
without `--force`.

### 2. MCP `split_model`

`executeSplit(source, projectName, domains, outDir?, force?)` in
`mcp/src/tools/split.ts`. The preview summary comes from deserializing
each generated domain file: owned entity types are those without
`sourceContext`, shared ones those with it. Tests run against
`docs/auction.orm.yaml` and `examples/auction-split.yaml`, the guide's
worked example: preview writes nothing; write produces a manifest that
`validate_model` accepts; a second write without `force` is refused;
`force` overwrites.

### 3. VS Code `barwise_split_model` and the matrix

Register the tool, declare it in `package.json`, add `resolveWriteDir`,
update the system prompt, the pinned lists, the capability matrix and
the docs.

## API and migration impact

- `@barwise/core`: `SplitResult.manifestFileName` is additive. The
  domain-name check is a new rejection; a config with `a/b` as a
  domain name used to write `domains/a/b.orm.yaml` and now fails.
- `@barwise/cli`: `project split` now refuses when a domain or mapping
  file exists, not only the manifest. `--force` still overrides.
- `@barwise/mcp`: new tool and new `executeSplit` export.
- `barwise-vscode`: new language-model tool, gated by
  `barwise.enableMcpServer` like the rest.

## Open decisions (for review)

- **Align the CLI's overwrite rule.** Options: change the CLI to check
  every target (recommended), or leave it checking only the manifest.
  Leaving it means two writers of the same `SplitResult` refuse
  different things, and the CLI keeps silently overwriting a
  hand-written `domains/<name>.orm.yaml` when no manifest exists yet.
- **Confirmation before writing in VS Code.** Options: none
  (recommended), relying on the preview call; or return
  `confirmationMessages` from `prepareInvocation` when `outDir` is set.
  `merge_models` writes without a confirmation today; adding one for
  split alone makes the registration helper bespoke for one tool.

## Risks and testing

- The CLI split test and `examples/auction-project` guard that the
  split output itself is unchanged; only the result gains a field.
- The pinned tool lists fail until the matrix, `package.json` and both
  registrations agree.
- Premortem: an agent writes the project into the extension host's
  working directory. Guarded by `resolveWriteDir` and its unit test.
- Premortem: an agent writes a second split over a project the user
  edited by hand. Guarded by the any-target refusal.
- Run `npm run build` before type-checking `mcp` or `vscode`, since
  workstream 1 changes a core type.

## Non-goals

- No change to how `splitModel` assigns object types, infers homes,
  or builds mappings.
- No editing of an existing manifest (adding or removing a domain).
