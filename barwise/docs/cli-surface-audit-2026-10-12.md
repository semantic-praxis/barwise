# CLI surface audit: what MCP and VS Code do not reach

Date: 2026-10-12
Tracking: barwise-0wa
Direction (owner, 2026-10-12): MCP and VS Code should both mirror the
toolset of the CLI.

## Summary

The CLI has 38 leaf commands. MCP reaches 24 of them and VS Code 22.
Measured at commit f17cfba6: commands from `node
packages/cli/dist/index.js <cmd> --help`, MCP tools from
`mcp/tests/serverSpawn.test.ts`, and VS Code tools from
`vscode/tests/unit/toolRegistration.test.ts` plus `contributes.commands`.

The gaps fall into four groups:

1. **Eight command-level gaps no documented constraint protects.**
   Close them.
2. **Option-level gaps under matrix rows that read "none."** The most
   consequential is that no import or merge tool can write its result.
   The `@barwise` chat participant receives only barwise-tagged tools
   (`ChatParticipant.ts` filters on the `orm` tag), so it has no other
   way to save anything. That is the failure the user hit this session.
3. **Gaps whose documented reason conflicts with mirroring.** These
   need an owner decision; a recommendation is given for each.
4. **Three bugs the audit found.** All are filed.

The capability matrix in `CLAUDE.md` could not show groups 2 and 4. Its
rows compare commands, and the pinned tests compare tool names, so a
tool can exist and still drop half its CLI options.

## 1. Command-level gaps with no protecting reason

| CLI command             | MCP | VS Code      | Note                                                                                                                       |
| ----------------------- | --- | ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `project init`          | no  | no           | Pure core (`scaffoldProject`); trivial to wrap                                                                             |
| `history <file>`        | no  | no           | `model-history.spec.md` already plans an MCP `model_history` tool (its WS2, open)                                          |
| `gym show <id>`         | no  | no           | `gym_list` returns the brief but not the starter                                                                           |
| `gym list`, `gym check` | yes | no           | Matrix says "deliberate", but `modeling-gym.spec.md` calls VS Code "a later workstream", which is deferred, not deliberate |
| `lineage show <source>` | no  | no           | Prints the lineage manifest; read-only                                                                                     |
| `analyze <repo>`        | yes | palette only | No language-model tool, so `@barwise` cannot run it                                                                        |

Recommendation: close all of them. Each wraps an existing pure function
or one I/O call, and none conflicts with a stated principle.

## 2. Option-level gaps under rows marked "none"

Formatting flags (`--format text|json`, `--json`, `--verbose`) are not
listed. MCP and VS Code return JSON because an agent reads the result,
and a format flag changes presentation, not capability. Everything
below changes what a caller can do.

| Command                           | Missing on MCP                                                                                                                 | Missing on the VS Code tool (beyond MCP)                                              |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `import model/norma/dbt/sql/code` | `--output`, `--infer-references`, `--lsp-command`                                                                              | same                                                                                  |
| `import transcript`               | `--output`, `--base-url`, `--no-annotate`, `--trail`                                                                           | `base`, `alternatives`, `samples`, `provider`, `model` (settings decide the last two) |
| `merge`                           | `--output` (MCP writes back to `base` instead)                                                                                 | same                                                                                  |
| `schema` (deprecated)             | `--output`                                                                                                                     | same                                                                                  |
| `export`                          | project-wide export (no `domain` is an error); lineage manifest; multi-file write for dbt/avro; `--dialect` only via `options` | `dialect` and every format-specific option                                            |
| `diagram` (deprecated)            | `--domain`, project input, `--output`                                                                                          | same                                                                                  |
| `validate`                        | cross-domain project rules (bug, below); `--no-warnings`                                                                       | --                                                                                    |
| `review`                          | `--base-url`                                                                                                                   | project input, `domain`, `provider`, `model`                                          |
| `diff`                            | `--no-synonyms`                                                                                                                | --                                                                                    |
| `analyze`                         | `--depth` (hard-coded 1), `--output`                                                                                           | everything: palette asks only for repo and ref                                        |
| `gym check`                       | `--catalog`, `--emit-misses`, `--no-state`                                                                                     | the whole command                                                                     |
| `gym list`                        | `--catalog`                                                                                                                    | the whole command                                                                     |

Recommendation:

- **Output paths first.** Add `outputPath` to `import_model`, `import_transcript` and `merge_models`, and expose it in VS Code. Without it a VS Code agent can show an imported model but cannot save it.
- **Then the VS Code tools that drop what MCP already takes:** transcript `base`, `alternatives` and `samples`; review `domain` and project input; export `dialect` and format options. These are forwarding changes in `ToolRegistration.ts`, with no new capability behind them.

## 3. Gaps with a documented reason that conflicts with mirroring

Each row needs your call. "Mirror" means MCP and VS Code get it;
"keep" means the reason stands and the matrix row keeps saying so.

| Gap                                                                      | Documented reason                                                                                                                         | Recommendation                                                                                                                                                                                                |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prompt` (eval, score, schema, artifact, run, history, rescore, compare) | Dev tooling for the measurement lane; a score needs an attributable model, and MCP sampling reports none (`keyless-model-access.spec.md`) | **Keep.** It measures barwise's own prompts, costs API spend per run, and a sampled run would record a `promptHash` no model can be attributed to                                                             |
| `--artifacts`                                                            | Unshipped prompt candidates must never reach production commands (`artifact-resolution-parity.spec.md`)                                   | **Keep.** Rides with `prompt`; mirroring it is the defect that spec exists to prevent                                                                                                                         |
| `--thinking-budget`                                                      | An experiment dimension recorded per history row                                                                                          | **Keep**, with `prompt`                                                                                                                                                                                       |
| `import batch`                                                           | Undocumented; runs a transcript directory through several models                                                                          | **Keep**, and document it: it is an evaluation sweep, the `prompt` lane's job                                                                                                                                 |
| `llm-usage`                                                              | The call log is written by whichever process made the calls, so an MCP report would summarise a different log                             | **Keep.** The reason is about correctness, not effort                                                                                                                                                         |
| `--samples` on VS Code                                                   | "An editor wants one quick pass" (`multi-sample-import.spec.md`)                                                                          | **Mirror.** The reason is about the palette flow; the language-model tool is agent-driven, like MCP, which already has it                                                                                     |
| `--infer-references`                                                     | "No use elsewhere yet" (`reference-inference.spec.md`)                                                                                    | **Mirror.** A demand judgment, not a constraint; it threads through `import_model`                                                                                                                            |
| `merge` writes back to `base` on MCP                                     | Deliberate (`cli-surface-parity.spec.md`)                                                                                                 | **Mirror `--output`, keep write-back as the default** so existing agents keep working                                                                                                                         |
| gym `--emit-misses`, `--no-state`                                        | "The server performs no writes" (`mcp/src/tools/gym.ts`)                                                                                  | **Mirror `--catalog` and `gym show`; keep no-writes for session state.** `split_model` and `merge_models` write model files, but a learner's session log is per-person state a shared server should not write |

If you accept the recommendations, 10 of the 14 commands MCP lacks
stay CLI-only: the eight `prompt` subcommands, `import batch` and
`llm-usage`. Each keeps its reason in the matrix. The other four close
on both surfaces, and VS Code also gains gym and an analyze tool.

## 4. Bugs found

All verified by reading or running the code, and filed under
barwise-0wa:

- **barwise-0wa.pte**: VS Code `barwise_import_transcript` declares that `transcript` may be a file path, then passes the path to the LLM as if it were the transcript text.
- **barwise-0wa.ymj**: MCP `generate_diagram`'s deprecation notice says to use `export_model` with `format='svg'`, and no `svg` exporter is registered.
- **barwise-0wa.qh3**: MCP `validate_model` on a project validates each domain but never runs the cross-domain project rules that `barwise validate` runs. VS Code inherits the gap.

## 5. The reverse direction, for completeness

MCP or VS Code can do these and the CLI cannot. They are outside "mirror
the CLI", and are listed so a later decision can see them:

- `validate --domain`
- `review` on a project
- `import transcript` with an existing model as context (`base`)
- `verbalize` summary mode
- `export_model`'s format-option passthrough (OpenAPI `title`/`version`, Avro `namespace`, dbt `sourceName`)
- `describe_domain`'s lineage reverse lookup (`filePath`)
- the code importers' guiding model (VS Code palette)
- VS Code's interactive per-delta merge on transcript import

## Next step

A spec, `surface-mirroring.spec.md`, turns sections 1 to 3 into
workstreams once section 3 is decided. The order is the cheapest
reachability first:

1. The output paths.
2. The VS Code forwarding fixes.
3. The section-1 commands.
4. The section-3 mirrors.

Each workstream updates the capability matrix in the same commit.
Pinning parameter lists, not just tool names, in
`toolRegistration.test.ts` would stop group 2 from going stale again.
That is its own workstream.
