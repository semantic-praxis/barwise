# Rename `helpers/` to `workspace/`: name the imperative shell

Status: Accepted -- rename only; all current files stay in the folder
Created: 2026-06-23
Last-updated: 2026-06-23
Tracking: barwise-5d7

## Principle

This is an _orthogonality_ and _explicit-over-implicit_ fix. The `helpers/`
folder in `@barwise/cli` and `@barwise/mcp` is a junk-drawer name over what
is actually each package's **imperative shell**: the impure boundary that
resolves a `<source>` (file path, inline YAML, project manifest, or editor
buffer) into the model(s) a command or tool runs against, feeds the pure
functional core, and formats the result back out. "helpers" says nothing
about that role; `workspace/` names it.

The folder also holds two output-formatting modules -- CLI `format.ts`
(diagnostics/verbalization text) and MCP `response.ts` (the tool-result
envelope and large-output spill). They shape results rather than load
sources, so they are arguably a separate concern; but splitting them into
their own folder is a one-file-per-folder change with little payoff, so by
decision they **stay in `workspace/`** with the rest. The folder reads as
"the package's edge: turn the outside world into models and results back
out." Revisit a split only if that edge grows.

## Scope

In scope:

- Rename `packages/cli/src/helpers/` -> `packages/cli/src/workspace/` and
  `packages/mcp/src/helpers/` -> `packages/mcp/src/workspace/`, moving every
  file as-is and updating every import site.
- Update the doc references to `helpers/` in the two package `CLAUDE.md`
  files.

Out of scope (unchanged, by the recorded decision in barwise-5d7 and the
`cli-mcp-helpers-...` memory):

- No shared `@barwise/workspace` package. The ~30-line `loadProject`
  duplication across the two shells stays; the pure assembly already lives
  in `core` (`assembleProject` / `projectFilePaths`). Revisit only on the
  tripwire (a third near-identical loader, or the glue growing past
  trivial).
- No logic change anywhere. This is a folder rename plus import-path
  rewrite.

## Inventory

Every file moves from `helpers/` to `workspace/` unchanged:

| Package | Files moved (helpers/ -> workspace/)                                               |
| ------- | ---------------------------------------------------------------------------------- |
| cli     | `domainModels.ts`, `io.ts`, `projectLoader.ts`, `lineageIo.ts`, `format.ts`        |
| mcp     | `resolve.ts`, `sourceSchema.ts`, `projectLoader.ts`, `lineageIo.ts`, `response.ts` |

## Target architecture

```
cli/src/
  cli.ts  index.ts  bundle-entry.ts   entry points
  commands/                           subcommands (pure-core callers)
  workspace/                          the package edge (was helpers/)
    domainModels.ts  io.ts  projectLoader.ts  lineageIo.ts  format.ts

mcp/src/
  server.ts  index.ts  bundle-entry.ts   entry points
  tools/  prompts/  resources/
  workspace/                             the package edge (was helpers/)
    resolve.ts  sourceSchema.ts  projectLoader.ts  lineageIo.ts  response.ts
```

## Workstreams (each independently shippable)

The two packages share no `helpers/` imports, so each rename is its own PR
and keeps the full suite green. Smallest blast radius first.

### 1. MCP: `helpers/` -> `workspace/`

`git mv` the folder; rewrite the `helpers/` import specifiers (~15 sites:
`tools/*.ts`, `server.ts`) to `workspace/`. Intra-folder imports between the
moved files are unchanged (same folder). No public API change -- `server.ts`
re-exports the same `resolveSource` / `SourceInput` / `sourcePath` surface
from the new path. Update `mcp/CLAUDE.md`.

### 2. CLI: `helpers/` -> `workspace/`

Same move for the CLI (~17 sites: `commands/*.ts`, `cli.ts`). Update
`cli/CLAUDE.md`.

## API and migration impact

- Both packages' public entry points are unchanged: `@barwise/mcp` still
  re-exports the same `execute*` / `resolveSource` / `SourceInput` surface,
  and the CLI binary is unaffected. So `barwise-vscode` and other consumers
  need no change.
- Pure internal move: only relative import specifiers change. Nothing
  crosses a package boundary, so `depcruise` and `purity` stay green without
  rule edits.

## Risks and testing

- Behavior must not change: the guard is the existing per-package suite,
  which must stay green untouched. A diff that is anything other than path
  changes (and the file moves) is a red flag.
- Run per package after each workstream: `npx tsc --noEmit`, `vitest run`,
  `eslint`, and `knip` (a dangling path or unused export surfaces there).
  Then `npm run depcruise` and `npm run purity` for the structural gates.
- `git mv` preserves history; the rename should read as renames in the diff,
  not delete-plus-add.
