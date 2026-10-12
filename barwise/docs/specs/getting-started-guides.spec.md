# One getting-started path per surface, with the names it cites checked against each surface

Status: Implemented -- workstream 1 (guides, sample files, audit, setup-doc
corrections, drift tests). Workstream 2 is the parity backlog in the audit;
each item is its own tracker issue and none is implemented here.
Created: 2026-10-12
Last-updated: 2026-10-12
Tracking: barwise-jk7

## Principle

Composability, stated from the user's side. One `@barwise/core` powers the
CLI, the MCP server and the VS Code extension, so a person should be able to
learn the workflow once and find it on whichever surface they use. Today
nothing teaches the workflow at all. README's quick start covers only the
editor, `docs/CLI.md` and `docs/MCP.md` are option references, and MCP.md's
setup tells every client to run `npx @barwise/mcp`, a package that has never
been published (npm returns 404; every package is `"private": true`). A new
user's first command fails.

The guides are also must-agree copies: they cite command names, flags, tool
names and palette titles that the code owns. Grounding this spec found the
existing copies already wrong in the same way the guides would go wrong --
MCP.md says the editor registers "seven tools" (it registers fourteen), the
extension README lists palette commands as `ORM: ...` (they are `Barwise:
...`), and `examples/README.md` walks through an `ORM: Import Transcript`
command that no longer exists. The convention for a copy is a check in the
same commit, so the guides land with one.

## Should the guides restate which surface can do what? (resolved: only as a name map)

The capability matrix in root `CLAUDE.md` is the authority for which surface
reaches which capability, and the pinned tool-list tests keep it honest. A
second matrix in user docs would be a copy of it. What a user needs that the
matrix does not give is the _name_ of each step on each surface -- `barwise
validate`, `validate_model`, **Barwise: Validate Model** -- so the hub carries
a lifecycle table of names, and every name in it is checked by the package
that owns it. Reach and divergence stay in the matrix and in the audit.

## Scope

In scope:

- When a reader opens `GETTING_STARTED.md` at the repository root, they shall
  find what barwise is, how to choose a surface, how to install it, and one
  lifecycle table naming each step on each surface, with a link to that
  surface's guide.
- When a reader opens `barwise/docs/getting-started/cli.md`, `vscode.md` or
  `mcp.md`, they shall find the same sections in the same order: install and
  verify; configure a model provider; start a model (from nothing, from an
  existing schema or codebase, from a transcript); check it; generate
  artifacts; change it safely; grow into a project; what this surface does not
  do.
- When the walkthrough needs input files, the system shall ship them under
  `barwise/examples/getting-started/`, and `npm run validate:examples` shall
  validate the starter model.
- When the CLI changes so that a `barwise ...` line in a guide's code block, or
  in the hub table's CLI column, names a command or option that no longer
  exists, `packages/cli` tests shall fail and name the file, line and token.
- When the MCP server registers or removes a tool, `packages/mcp` tests shall
  fail unless the MCP guide's tool table lists exactly the registered tools,
  and shall fail on a hub-table tool name that is not registered.
- When a palette title, `#` tool reference or `@barwise /command` named in the
  guides or the editor-facing docs does not exist in the extension's
  `package.json`, `packages/vscode` unit tests shall fail.
- The divergences found while writing the guides shall be recorded in
  `docs/surface-parity-audit-2026-10-12.md`, each with a tracker issue.
- Setup facts that contradict the guides shall be corrected in place: MCP.md's
  install instructions and stale claims, the extension README's command
  titles and version floor, README's settings table and version floor,
  `examples/README.md`'s command names, and the `project` subcommand list in
  root `CLAUDE.md`.

Out of scope: closing any divergence (workstream 2, one issue each);
completing the CLI.md and MCP.md option references (barwise-ntw);
IMPORT_EXPORT.md (barwise-4hh).

## Inventory

| File                                     | Current state                              | Verdict                                                    |
| ---------------------------------------- | ------------------------------------------ | ---------------------------------------------------------- |
| `GETTING_STARTED.md`                     | absent                                     | new: hub                                                   |
| `barwise/docs/getting-started/*.md`      | absent                                     | new: three guides, one shape                               |
| `barwise/examples/getting-started/`      | absent                                     | new: `shop.orm.yaml` (from nothing), `shop.sql` (from DDL) |
| `barwise/scripts/validate-examples.sh`   | validates `examples/models`, `transcripts` | adds `examples/getting-started`                            |
| `barwise/docs/surface-parity-audit-*.md` | absent                                     | new: dated inventory, points at issues                     |
| `barwise/docs/MCP.md`                    | `npx @barwise/mcp`; "seven tools"; stale   | setup rewritten; stale claims corrected                    |
| `barwise/packages/vscode/README.md`      | `ORM:` titles; New Project misdescribed    | corrected                                                  |
| `README.md`                              | VS Code >= 1.93; deprecated key setting    | corrected; links the hub                                   |
| `barwise/examples/README.md`             | `ORM: Import Transcript` and friends       | corrected                                                  |
| `CLAUDE.md`                              | `project` has `domains`, `mappings`        | corrected to `init`, `split`                               |
| `packages/{cli,mcp,vscode}/tests`        | no check reads user docs                   | one drift test each                                        |

The capability matrix is untouched: no surface's reach changes here.

## Alternatives considered

- **One drift script in the docs lane, no build.** It would also check
  docs-only PRs, which the package tests do not (CI skips tests when every
  changed file is `.md`). It lost because the CLI's import subcommands and the
  shared `--api-key` flag are built programmatically, so reading commands from
  source with regexes would be the fragile copy this spec is trying to remove.
  The main drift direction -- code renames, docs go stale -- runs the package
  tests. See Open decisions.
- **A shared parsing helper in one package, used by all three tests.** It
  would couple `mcp` and `vscode` to `cli` (or to a new module) for about ten
  lines each. DRY is secondary; each test reads only its own surface's names
  with its own pattern.
- **A living parity page instead of a dated audit.** A living page restating
  reach is the second matrix rejected above. The audit is a snapshot taken at
  a commit, and each finding lives on in its issue.

## Workstreams (each independently shippable)

### 1. Guides, samples, audit, setup corrections, drift tests

This PR. It changes no runtime behaviour.

### 2. Close the divergences (provisional: one issue each, not designed here)

Ordered by harm: `merge_models` overwriting its base file (barwise-xjf);
project validation that skips the cross-domain rules off the CLI
(barwise-z1p); exports that record lineage only on the CLI (barwise-ace);
importers that overwrite an existing model (barwise-pks); the shipped bundles'
gym failure and v4 ids (barwise-fbi, barwise-vqc); deprecation notices that
point at a missing format (barwise-zir); VS Code pickers driven from the
registry (barwise-i22); project-awareness (barwise-rb4); transcript-import
options (barwise-6n8); a starter-model command for CLI and MCP (barwise-c2e);
the keyless error message (barwise-ckt). Each lands with its capability-matrix
row and its guide paragraph in the same commit, and the drift tests make the
guide paragraph impossible to forget.

## Open decisions (for review)

- **Check the guides on docs-only PRs too.** Recommended: not yet. The
  package tests run on every PR that touches code, which is when a name
  changes. A docs-only PR that types a wrong flag would pass until the next
  code PR, which then fails for a reason it did not cause. If that happens
  once, add a docs-lane step that builds only `@barwise/cli` and runs its
  docs test; the build is the cost.
- **Which divergences are deliberate.** The audit marks each finding as a
  defect or as undecided. Deciding that a gap is deliberate is the reviewer's
  call, recorded as a capability-matrix row; this spec decides none.
- **Whether the hub belongs at the repository root.** The request named
  `GETTING_STARTED.md`, and README is at the root, so that is where a visitor
  looks. The per-surface guides live under `barwise/docs/` with the other
  user docs.

## Risks and testing

- The drift tests read files outside their package by relative path. A moved
  guide fails the test with "file not found", not silently.
- What was exercised: every CLI command in `cli.md` against the built CLI from
  a scratch directory; the MCP walkthrough against the release bundle over
  stdio with the SDK client. Not exercised: anything that needs an LLM (no
  provider key in the authoring session), and the VS Code guide, which is
  written from the extension's `package.json` and command sources, not driven
  in a live editor.

## Non-goals

- No new command, tool, or palette entry.
- No change to any surface's behaviour, including the defects the audit
  records.
