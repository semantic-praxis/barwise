# Unwired capability audit, 2026-08-20

Barwise builds capabilities in `core` and the mid-tier packages, then
exposes them through three surfaces: the CLI, the MCP server, and the
VS Code extension. This audit asks a narrow question of each capability -- **can a user actually reach it?** -- and finds seven places where the
answer is no or partly no.

The question is worth asking mechanically rather than by intuition,
because the failure is invisible from inside any one package. Every item
below is built, exported, and tested. Tests are not call sites: a
capability with a green test and no caller passes CI forever while
reaching nobody.

## Method

Two sweeps over `main` at `f830116`, both scripted rather than
eyeballed.

1. **Cross-surface matrix.** Enumerate what each surface registers --
   `registerXCommand(program)` in `packages/cli/src/cli.ts`,
   `registerXTool(server)` in `packages/mcp/src/tools/index.ts`,
   `contributes.commands` in the VS Code manifest -- and compare.
2. **Call-site sweep.** For every value export in each package's public
   barrel, count mentions across all `packages/*/src`, then separately
   across `tests/` and `scripts/`. An export whose only mentions are its
   definition and its export line has no caller; one with test mentions
   but no production mention is tested but unreached.

The first sweep, over every export including types, returned 211 results
and was useless -- most were types (legitimate public API) or format
descriptors reached through a registry that grep cannot follow. The
narrowed sweeps below are what produced signal.

## Findings

### 1. `review` reaches MCP and VS Code, not the CLI

`reviewModel` (`packages/llm/src/review/reviewModel.ts:288`) is
registered as the MCP `review_model` tool and called from
`packages/vscode/src/mcp/ToolRegistration.ts:248`. `packages/cli/src`
contains no reference to it, and `cli.ts` registers no review command.

A user with the CLI cannot review a model. A user with either of the
other two surfaces can.

### 2. `merge` reaches MCP only

`registerMergeTool` is in the MCP barrel. Neither the CLI nor the VS
Code extension references `mergeModels`. This is the narrowest reach of
any shipped capability -- one surface out of three.

### 3. `CLAUDE.md`'s parity claim is false in both directions

> The CLI (`barwise`) and MCP server (`barwise-mcp`) provide the same
> capabilities as the VS Code extension.

Against the matrix:

| Capability                                            | CLI    | MCP    | VS Code |
| ----------------------------------------------------- | ------ | ------ | ------- |
| validate, verbalize, diagram, export, import, analyze | yes    | yes    | yes     |
| schema, diff, query, describe, gym, lineage, impact   | yes    | yes    | no      |
| `review`                                              | **no** | yes    | yes     |
| `merge`                                               | **no** | yes    | no      |
| `project`, `history`                                  | yes    | **no** | no      |
| `prompt`                                              | yes    | no     | no      |

Only six capabilities reach all three surfaces. The claim is not a
small overstatement; it is the reverse of the situation for `review`
and `merge`, where the CLI is the surface that lacks them.

`prompt` being CLI-only is deliberate -- it is dev tooling, and the
prompt-optimization-harness spec says so. The others are not documented
as deliberate anywhere.

### 4. The same paragraph miscounts the packages

> the full suite passes in CI across all 10 packages

Twelve packages declare a `test` script and twelve run in CI. The
dependency graph in the same file lists twelve nodes. The prose was
written when there were ten and was not revised when `diagram-ui` and
`promptlab` landed.

### 5. Artifact resolution: specified, merged, unbuilt

`resolveArtifact` and `loadArtifactsFromDir` have exactly one caller in
the repository -- `barwise prompt eval --artifacts`. All five
`processTranscript` call sites omit the artifact parameter, so every
extraction on every surface renders `defaultExtractionArtifact`.

Both tuned variants are inert. This is already diagnosed in
`docs/specs/artifact-resolution-in-production.spec.md`, merged in PR
#300 and not yet implemented. It is the largest item here by user
impact: the difference between having tuned prompts and shipping them.

### 6. `buildCodeExtractionPrompt` builds a prompt nothing sends

Exported at `packages/code-analysis/src/index.ts:31`, defined in
`prompt/CodeExtractionPrompt.ts:21`, and mentioned nowhere else in any
`src/` tree. One test covers it. Nothing hands its output to a model.

The harness spec already characterises it as "dead code today ... it
joins the harness when it gains a call site." Two months on it has not
gained one. The open question is whether the code-analysis import path
was ever meant to run an LLM pass, or whether this is a design that was
abandoned and the code left behind.

### 7. Few-shot demo support is built and unexercised

`PromptDemo`, the loader validation in `loadArtifact.ts:69-83`, and
`renderDemos` in `prompt/artifacts/render.ts` are all implemented and
tested. Both shipped artifacts declare `demos: []`.

Nothing is broken. But the demo half of the artifact seam has never
rendered a demo in anger, so its behaviour under real content --
particularly token budget, which the harness spec flags as a grounding
question for the optimizer lane -- is unverified. The DSPy exporter is
specified to emit demos, and it would be the first thing ever to
exercise this path.

## What is not a finding

Several results from the sweep are legitimate and listed here so a later
audit does not re-raise them.

- `clearFormats`, `getFormat`, `listFormats` -- registry API, exercised
  by tests, and the registry is the documented extension point.
- `loadTutorial`, `renderTutorial` -- reached by `npm run regen:tutorial`,
  which is a script rather than a `src/` caller.
- `parseExtractionFromJson` -- reached by tests and by the documented
  reference-generation workflow in `promptlab/CLAUDE.md`.
- Every type export. These packages are published; a type with no
  internal consumer is public API, not dead code.
- `computeLayoutMetrics` -- tested, no production caller, but it is a
  measurement helper rather than a user-facing capability. Noted, not
  filed.

## Recommendations

Ordered by user impact.

1. **Implement artifact resolution.** Spec merged, design reviewed, no
   key needed. Nothing else on this list changes what users get.
2. **Decide `review` and `merge` on the CLI.** Either add the commands
   or write down why those surfaces differ. The current state is
   undocumented divergence, which is how the parity claim survived.
3. **Correct the `CLAUDE.md` paragraph.** Both the parity sentence and
   the package count. Done in the same change as this audit.
4. **Decide `CodeExtractionPrompt`.** Give it a call site or delete it.
   Carrying it costs a test and misleads anyone reading the export list.
5. **Leave the demo path alone until the optimizer lane needs it**,
   which is when it will finally be exercised.

## A note on how this class of defect forms

Every item here passed review when it landed. The seam was built before
its consumer, the consumer was specified and then deferred, and the
documentation described the intended end state rather than the shipped
one. Nothing was careless.

What makes it durable is that no test can catch it. A test proves a unit
works; it cannot prove anyone calls it. The cross-surface matrix is the
only check here that would have caught findings 1 through 4 at the time,
and it takes a few lines of script. Worth re-running when a capability
is added.
