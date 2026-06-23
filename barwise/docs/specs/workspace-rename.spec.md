# Rename `helpers/` to `workspace/`: name the imperative shell

Status: Draft for review (design only -- no implementation in this PR)
Created: 2026-06-23
Last-updated: 2026-06-23
Tracking: barwise-5d7

## Principle

This is an _orthogonality_ and _explicit-over-implicit_ fix. The `helpers/`
folder in `@barwise/cli` and `@barwise/mcp` is a junk-drawer name over what
is actually each package's **imperative shell**: the impure boundary that
resolves a `<source>` (file path, inline YAML, project manifest, or editor
buffer) into the model(s) a command or tool runs against, then feeds the
pure functional core. "helpers" says nothing about that role; `workspace/`
names it -- the place where the outside world (filesystem, provenance
manifests) is turned into in-memory models.

The same rename forces a second clarification the junk-drawer hid: **output
rendering is not part of the shell.** CLI `format.ts` (diagnostics and
verbalization text) and MCP `response.ts` (output bounding) shape results
for a human or an agent; they are a presentation concern, not source
resolution. Sweeping them into `workspace/` would re-create the
junk-drawer under a better name. They move out.

## Should `workspace/` hold the source contract too? (resolved: yes)

`mcp/src/helpers/sourceSchema.ts` (the zod union for a tool `source`) is a
pure declaration, not I/O -- so strictly it is not "shell" code. But it is
the schema half of the same `source` contract whose type half
(`SourceInput`) and resolver (`resolveSource`) live in `resolve.ts`. The two
are read and changed together. Cohesion of one contract outweighs a strict
purity-by-folder rule (DRY-secondary), so `sourceSchema.ts` travels with
`resolve.ts` into `workspace/`. `workspace/` reads as "everything about
turning a source into models," which includes the source's input shape.

## Scope

In scope:

- Rename `packages/cli/src/helpers/` -> `packages/cli/src/workspace/` and
  `packages/mcp/src/helpers/` -> `packages/mcp/src/workspace/`, updating
  every import site.
- Move the rendering modules out of the renamed folder: CLI `format.ts`
  and MCP `response.ts` (see the open decision on their destination).

Out of scope (unchanged, by the recorded decision in barwise-5d7 and the
`cli-mcp-helpers-...` memory):

- No shared `@barwise/workspace` package. The ~30-line `loadProject`
  duplication across the two shells stays; the pure assembly already lives
  in `core` (`assembleProject` / `projectFilePaths`). Revisit only on the
  tripwire (a third near-identical loader, or the glue growing past
  trivial).
- No logic change anywhere. This is a move plus import-path rewrite.

## Inventory

| Module                         | Role                               | Verdict            |
| ------------------------------ | ---------------------------------- | ------------------ |
| `cli/helpers/domainModels.ts`  | resolve `<file>`/project -> models | -> `workspace/`    |
| `cli/helpers/io.ts`            | load model, write output (fs)      | -> `workspace/`    |
| `cli/helpers/projectLoader.ts` | manifest fs walk                   | -> `workspace/`    |
| `cli/helpers/lineageIo.ts`     | provenance manifest I/O            | -> `workspace/`    |
| `cli/helpers/format.ts`        | render diagnostics/verbalizations  | -> out (rendering) |
| `mcp/helpers/resolve.ts`       | `SourceInput`, resolve source      | -> `workspace/`    |
| `mcp/helpers/sourceSchema.ts`  | zod schema for the source contract | -> `workspace/`    |
| `mcp/helpers/projectLoader.ts` | manifest fs walk                   | -> `workspace/`    |
| `mcp/helpers/lineageIo.ts`     | provenance manifest I/O            | -> `workspace/`    |
| `mcp/helpers/response.ts`      | bound/spill tool output            | -> out (rendering) |

`response.ts` does write spill files (`writeFileSync`), but its concern is
shaping a result that is too large to inline; the spill is a mechanism, not
the point. It is rendering, and it stays out of the shell.

## Target architecture

```
cli/src/
  cli.ts  index.ts  bundle-entry.ts        entry points
  commands/                                subcommands (pure-core callers)
  workspace/                               imperative shell: source -> model(s) + I/O
    domainModels.ts   resolveDomainModels
    io.ts             loadModel, writeOutput
    projectLoader.ts  loadProject (fs walk)
    lineageIo.ts      provenance manifest I/O
  format.ts                                rendering (not the shell)

mcp/src/
  server.ts  index.ts  bundle-entry.ts     entry points
  tools/  prompts/  resources/
  workspace/                               imperative shell
    resolve.ts        SourceInput, resolveSource / resolveModels
    sourceSchema.ts   zod schema for the source contract (pairs with resolve)
    projectLoader.ts  loadProject (fs walk)
    lineageIo.ts      provenance manifest I/O
  response.ts                              rendering (bounds/spills output)
```

## Workstreams (each independently shippable)

The two packages share no `helpers/` imports, so each rename is its own PR
and keeps the full suite green. Smallest blast radius first.

### 1. MCP: `helpers/` -> `workspace/`; `response.ts` to its home

Move `resolve.ts`, `sourceSchema.ts`, `projectLoader.ts`, `lineageIo.ts`
into `workspace/`; move `response.ts` out. Rewrite the ~15 importing files
(`tools/*.ts`, `server.ts`). No exported public API changes -- `server.ts`
re-exports `resolveSource` / `SourceInput` / `sourcePath` from the new path.

### 2. CLI: `helpers/` -> `workspace/`; `format.ts` to its home

Move `domainModels.ts`, `io.ts`, `projectLoader.ts`, `lineageIo.ts` into
`workspace/`; move `format.ts` out. Rewrite the ~17 importing files
(`commands/*.ts`, `cli.ts`).

## API and migration impact

- Both packages' public entry points are unchanged: `@barwise/mcp` still
  re-exports the same `execute*` / `resolveSource` / `SourceInput` surface
  (from the new internal path), and the CLI binary is unaffected. So
  `barwise-vscode` and other consumers need no change.
- Pure internal move: only relative import specifiers change. The one-way
  package dependency graph is untouched (nothing crosses a package
  boundary), so `depcruise` and `purity` stay green without rule edits.

## Open decisions (for review)

- **Where the rendering modules land.** Recommend flattening to the package
  `src/` root (`cli/src/format.ts`, `mcp/src/response.ts`) -- one file each,
  sitting beside the other top-level concerns (`commands/`, `tools/`,
  `server.ts`). The alternative, a `render/` folder, names the concern
  symmetrically with `workspace/` but is a folder per single file; and
  `response.ts` writes spill files, so "render/" slightly undersells it.
  Flatten is simpler; the reviewer's call.

## Risks and testing

- Behavior must not change: the guard is the existing per-package suite,
  which must stay green untouched after a move-and-reimport. A diff that is
  anything other than path changes (and the file moves) is a red flag.
- Run per package after each workstream: `npx tsc --noEmit`, `vitest run`,
  `eslint`, and the `knip` check (an unused-export or dangling-path slip
  surfaces there). Then `npm run depcruise` and `npm run purity` to confirm
  the structural gates still pass.
- `git mv` preserves history on the moved files; the rename should read as
  renames in the diff, not delete-plus-add.
