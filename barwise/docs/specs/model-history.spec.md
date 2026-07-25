# Model history: semantic change-over-time from git

Status: Accepted (user-directed 2026-07-25) -- design ready for
implementation
Created: 2026-07-25
Last-updated: 2026-07-25
Tracking: project-owner traceability decision 2026-07-25 (chosen
alongside `uuid7-identifiers.spec.md`; the two compose -- ids order
element creation, history explains change)

## Principle

Traceability of model changes over time comes from composing two things
that already exist: git, which records who changed a `.orm.yaml` and
when, and the deterministic diff engine (`diffModels`), which turns two
model revisions into semantic deltas ("constraints added:
join_equality"). A `barwise history` command joins them. No metamodel
change, no timestamps in the file, no new state to maintain -- the
model file stays a pure artifact and the history stays where history
already lives.

## Problem

`git log -p model.orm.yaml` answers who/when but renders YAML noise; a
reviewer cannot see that a commit added an external uniqueness
constraint without reading serialization details. `barwise diff` can
compare two files but knows nothing about git revisions. There is no
one command that walks a model's life and narrates it conceptually.

## Should history read git directly or take file pairs? (resolved: git in the CLI, pure pairs in core)

Core stays pure: `diffModels(a, b)` already exists and needs nothing
new. The git walk (`git log --follow` for the revision list, `git show
<rev>:<path>` for content) is subprocess I/O and lives in the CLI
package, the same one-layer-out split the dbt connector uses for its
`dbt compile` subprocess. The MCP server can wrap the same capability
later; the VS Code extension already has timeline UI conventions to
plug into. Nothing lands in core.

## Scope

- When the user runs `barwise history <model.orm.yaml>`, the system
  shall list the file's git revisions (newest first) and, for each
  adjacent pair, render the semantic deltas from `diffModels` with the
  commit hash, author, date, and subject line.
- When a revision fails to parse under the current schema (a
  pre-migration file), the system shall report that revision as
  "unreadable at <rev>" and continue, rather than aborting the walk.
- When the file has uncommitted changes, the system shall include a
  final "working tree" entry diffing HEAD against the file on disk.
- When `--limit <n>` is given, the system shall walk only the newest
  `n` revisions (default 20).
- When the file is not in a git repository or has no history, the
  system shall say so and exit non-zero.

Out of scope: cross-file project history (`.orm-project.yaml` walking
its domain files -- follow-up once single-file history proves out);
blame-per-element; rendering to HTML; an MCP `model_history` tool
(follow-up, thin wrapper).

## Workstreams

1. **CLI command.** `packages/cli/src/commands/history.ts`: revision
   walk via `git` subprocess, parse each revision with the existing
   serializer, render `diffModels` deltas per pair. Tests with a
   fixture repo built in a temp dir (the dbt package's subprocess test
   pattern).
2. **MCP wrapper (follow-up).** Same walk exposed as a tool, output
   bounded through `boundedTextResult`.

## Risks and testing

- _Old revisions._ The `orm_version` forward-migration path
  (`schemaVersion.ts`) reads older minors; revisions older than the
  oldest migration report as unreadable instead of crashing the walk.
- _Rename tracking._ `--follow` handles file moves; a test covers a
  renamed model.
- _Determinism._ The command's output is a pure function of the git
  history; no clocks beyond what git records.
