# Give the CLI `review` and `merge`, and stop the surfaces diverging silently

Status: Implemented (all three workstreams)
Created: 2026-08-21
Last-updated: 2026-08-21
Tracking: barwise-809 (`review`), barwise-810 (`merge`). Resolves
findings 1 and 2 of `docs/unwired-capability-audit-2026-08-20.md`.

## Principle

Composability, and explicit over implicit. One `@barwise/core` and one
`@barwise/llm` are supposed to power three surfaces; when a capability
reaches two of them, the missing third is not a design decision, it is
an omission nobody wrote down. `reviewModel` takes an `OrmModel` and an
`LlmClient`, both of which the CLI already builds for
`barwise import transcript`. `mergeAndValidate` is pure core and needs
neither. Nothing about either capability resists the CLI; they were
simply never wired.

The audit's third finding is the one that makes this worth a spec
rather than two commits. `CLAUDE.md` claimed the surfaces were at
parity while `review` and `merge` were missing from the CLI, and the
claim survived because nothing checked it. Adding two commands closes
today's gap; what stops the next one is recording which divergences are
deliberate, so an undocumented gap reads as a bug rather than as
possible intent.

## Should the CLI have both? (resolved: yes, and for different reasons)

**`merge` is the clearer case.** It is pure core, needs no key, and is
deterministic -- the easiest capability in the system to expose and
test. Its absence from the CLI is hardest to defend precisely because
nothing about it is hard. `barwise diff` already ships, and diff and
merge are the same operation read in two directions: a user who can be
shown what differs should be able to act on it without changing tools.

barwise-810 asks whether merge is a modelling operation users want at
the command line or an agent affordance that belongs to MCP alone. It
is the former. A merge that only an agent can perform is a merge no
human can review before it happens, and the CLI is where a human works
a model into a state they are willing to commit.

**`review` is the case with a caveat.** It costs an API call, and
unlike validation its output is advice rather than fact. That argues
for how the command behaves, not for withholding it: the CLI already
has `import transcript`, which costs a call and produces a draft the
user is expected to edit. Review is the same bargain.

The caveat is the exit code. A CI-friendly command that fails on
subjective LLM suggestions would make builds fail for reasons the
model made up, and would put an LLM in the position of gating a merge.
So review exits 0 whenever the review completes, regardless of what it
says. See Open decisions.

## What stops the divergence recurring? (resolved: a documented matrix)

Fixing two gaps does not stop a third. The cheap durable answer is the
audit's own matrix, moved into `CLAUDE.md` where it is read, with each
remaining divergence marked deliberate or not:

| Capability                                            | CLI | MCP | VS Code | Status                       |
| ----------------------------------------------------- | --- | --- | ------- | ---------------------------- |
| validate, verbalize, diagram, export, import, analyze | yes | yes | yes     | at parity                    |
| schema, diff, query, describe, gym, lineage, impact   | yes | yes | no      | deliberate: text-first tools |
| `review`                                              | yes | yes | yes     | closed by this spec          |
| `merge`                                               | yes | yes | no      | VS Code deferred, see below  |
| `project`, `history`                                  | yes | no  | no      | deliberate: repo operations  |
| `prompt`                                              | yes | no  | no      | deliberate: dev tooling      |

The point is not the table's contents but that a reader can tell
absence-by-choice from absence-by-oversight. A generated matrix that
fails CI on drift would be stronger and is out of scope; see Open
decisions.

## Scope

In scope:

- When a user runs `barwise merge <base> <incoming>`, the system shall
  merge the incoming model into the base, accepting additions and
  modifications and rejecting removals, and shall write the merged
  model to stdout.
- When `--output <file>` is given, the system shall write the merged
  model to that file instead of stdout.
- When the merge produces structural errors, the system shall report
  them and exit non-zero without writing a merged model anywhere.
- When the two models are identical, the system shall say so and exit
  zero.
- When a user runs `barwise review <file>`, the system shall review the
  model through an LLM and print the suggestions and summary.
- When `--focus <name>` is given, the system shall restrict the review
  to that element.
- When the review completes, the system shall exit zero regardless of
  the suggestions returned.
- When either command is given `--format json`, the system shall write
  a machine-readable result to stdout and nothing else.
- When the capability matrix in `CLAUDE.md` records a divergence, it
  shall state whether that divergence is deliberate.

Out of scope, deferred and named:

- **`merge` in VS Code.** Merge in an editor wants a diff view and
  per-delta accept/reject, which is a UI feature rather than a wiring
  job. The matrix records it as deferred rather than pretending the
  CLI closes it.
- **Interactive merge.** Both the MCP tool and `import transcript`
  merge non-interactively with the same policy; the CLI matches them.
  Per-delta selection is a separate feature.
- **A generated parity matrix.** See Open decisions.
- **Review as a CI gate.** No `--fail-on` flag. See Open decisions.
- **`buildCodeExtractionPrompt` (barwise-811) and few-shot demos
  (barwise-812).** The audit's other two findings; neither is a
  surface-parity question.

## Inventory

| Area                                    | Current state                                                   | Verdict   |
| --------------------------------------- | --------------------------------------------------------------- | --------- |
| `llm/src/review/reviewModel.ts`         | `reviewModel(model, client, options?)`; used by MCP and VS Code | untouched |
| `core/src/diff` (`mergeAndValidate`)    | Pure; used by MCP merge and by `import transcript`              | untouched |
| `cli/src/commands/review.ts`            | Does not exist                                                  | new       |
| `cli/src/commands/merge.ts`             | Does not exist                                                  | new       |
| `cli/src/cli.ts`                        | Registers thirteen command groups                               | modify    |
| `cli/src/commands/diff.ts`              | The sibling shape to match: two model args, `--format`          | untouched |
| `cli/src/commands/import/transcript.ts` | The provider-option shape to match                              | untouched |
| `cli/src/workspace/io.ts`               | `loadModel`, `writeOutput`                                      | untouched |
| `mcp/src/tools/merge.ts`                | `executeMerge`; writes back to the base file when valid         | untouched |
| `CLAUDE.md`                             | Records the divergence in prose, without a matrix               | modify    |
| `docs/CLI.md`                           | Command reference                                               | modify    |

Both capabilities are reached through their existing package exports,
so no package gains a dependency and neither `core` nor `llm` changes.
That is the point: if wiring a capability to a third surface required
touching the capability, the seam would be wrong.

**The MCP merge tool is deliberately left alone**, including its
write-back-to-base behaviour. The CLI does not copy that: writing to an
input file by default is defensible for an agent that has just been
handed both paths, and surprising for a command a human typed. The
surfaces differ here on purpose, which the matrix records.

## Workstreams (each independently shippable)

### 1. `barwise merge`

Pure core, no key, fully testable offline. Acceptance: when
`barwise merge a.orm.yaml b.orm.yaml` runs against models that differ
by an added object type, the system shall write a merged model
containing that type to stdout and exit zero; and when the merge
produces a structural error, the system shall exit non-zero and write
no model.

### 2. `barwise review`

Acceptance: when `barwise review model.orm.yaml` runs against a client
returning a review payload, the system shall print each suggestion with
its category and severity and exit zero; and when the review returns a
warning-severity suggestion, the system shall still exit zero.

Tested with a mock `LlmClient`, per the package convention that no test
makes a real call. A key is needed to exercise it against a real
provider, not to verify it works.

### 3. Record the matrix

Move the audit's cross-surface matrix into `CLAUDE.md` with a
deliberate/not column, and add both commands to `docs/CLI.md`.
Acceptance: when a reader consults `CLAUDE.md`, the system shall
present, for each capability, which surfaces expose it and whether any
absence is deliberate.

## API and migration impact

- Two new CLI commands. No existing command changes.
- No package gains an export or a dependency. `@barwise/cli` already
  depends on `@barwise/core` and `@barwise/llm`.
- `barwise merge` writing to stdout by default differs from the MCP
  tool writing back to the base file. Intentional, recorded above.

## Open decisions (for review)

- **Should `review` be able to fail a build?** A `--fail-on <severity>`
  flag would let CI gate on review output. Recommend not adding it: the
  suggestions are model-generated advice, and a flag that fails a build
  on them puts an LLM in the merge path, where a bad day for the
  provider becomes a red build for everyone. A user who wants this can
  pipe `--format json` through `jq`, which keeps the policy in their
  hands and out of ours.
- **Should the parity matrix be generated and CI-checked?** The matrix
  is hand-maintained, which is exactly the failure mode that produced
  the false parity claim -- a hand-maintained assertion nothing checks.
  A script enumerating `registerXCommand`, `registerXTool`, and
  `contributes.commands` could regenerate it, with a drift test, in the
  same shape as `builtins.generated.ts`. Recommend deferring to its own
  issue: the matrix's deliberate/not column is a human judgment that no
  script can derive, so generation solves half the problem and the
  hand-maintained half is the half that rots.
- **Should `merge` accept a project manifest?** The MCP tool resolves
  projects for review but not for merge. Recommend matching it -- merge
  takes two model files -- and revisiting if anyone asks to merge at
  the project level.

## Risks and testing

- **`merge` writes files.** The destructive default is the risk, which
  is why the default is stdout and `--output` is explicit. A test
  covers that a plain `barwise merge` leaves both inputs untouched.
- **Structural errors must not produce a written file.** The MCP tool
  writes back only when valid; the CLI must not write a broken model to
  `--output` either. Its own test.
- **`review` must not make a real call in CI**, per the `llm` package
  convention. Mock client only.
- Full gate after each workstream: `npm run build`, `test`, `lint` from
  `barwise/`.

## Non-goals

- No change to `reviewModel`, `mergeAndValidate`, or the diff engine.
- No interactive merge, and no per-delta selection.
- No change to the MCP tools or the VS Code extension.
- No new LLM surface: review already exists, it just has one fewer
  door than it should.
