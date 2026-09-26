# The trial lane refuses to grade a bundle that is not the code on disk

Status: Implemented 2026-09-26 -- the single workstream (see Implementation notes)

Created: 2026-09-26
Last-updated: 2026-09-26
Tracking: barwise-lh9 (the defect this was found through)

The enterprise trial's offline lane drives the built CLI and MCP bundles
the way a customer would. On 2026-09-26 it printed PASS, "0 stale", over
34 rows for barwise-lh9, a defect main had already fixed: the bundles it
graded were older than the source. Two causes: turbo cached
`dist/bundle/` as a `build` output, so a cache hit restored an old bundle
with a fresh mtime; and the lane checked only that the bundles existed.
After this change the cache cannot restore a bundle, and the lane exits 2
(could not answer) when a bundle is not built from the code on disk.

## Principle

**A gate that cannot see its input must not print PASS**
(`gate-refusal-contract.spec.md`). A present bundle is not a current one,
and grading an old one answers a question nobody asked while looking
exactly like an answer.

## Requirements

- **R1.** turbo's `build` task shall not cache `dist/bundle/`. Only the
  `bundle` scripts write it, so a replay of it is always someone else's
  bundle.
- **R2.** Each bundle script shall write `dist/bundle/inputs.json`: every
  file esbuild read (its metafile's inputs), relative to the package,
  plus any file the script reads itself (the CLI's `package.json`).
- **R3.** `trial:offline` and `trial:keyed` shall exit 2, naming the bundle and the reason,
  when a bundle has no `inputs.json`; when a recorded input no longer
  exists; when a recorded input is newer than the bundle; or when any
  file or directory under a bundled package (not `dist`, `tests`,
  `coverage`, `node_modules` or a hidden directory) is newer than the
  bundle.

R3's last clause exists because esbuild reads the workspace packages'
`dist/`, so an edit under `src/` that `npm run build` has not compiled
is invisible to the recorded inputs.

## Scope

In: `turbo.json`, both `esbuild.mjs` scripts, `trial/lib/paths.mjs`
`staleBundles`, and the refusal in `trial/lib/run.mjs`, which both
`offline` and `keyed` pass through. Out: nothing else drives the bundles.

## Workstream (single)

All three requirements land together; R3 without R2 cannot see a
deleted input, and R2 without R3 records a list nothing reads.

## Risks and testing

- A bundle built before R2 has no `inputs.json` and is refused. That is
  the intended reading: its inputs are unknown. The message names the
  rebuild command.
- mtime is a proxy: a file restored with an old mtime reads as current.
  R1 removes the known way that happened.
- Tests: `trial/tests/paths.test.mjs` (each R3 clause, with injected
  inputs) and `trial/tests/refusal.test.mjs` (the lane exits 2 on a
  source newer than the bundle).

## Open decisions

None.

## Implementation notes

- The first version inferred deletions from directory mtimes, without
  R2. The PR #572 review showed it could not see a package's top-level
  entry being deleted (`packages/core/schemas/`), because only the
  package root's mtime moves and that one also moves for runtime state
  (`coverage/`, `.barwise/`). Measured after R2: moving
  `packages/core/schemas/` away makes both bundles stale, naming
  `orm-project.schema.json`.
- The recorded lists hold 887 inputs for the CLI bundle and 1,034 for
  the MCP bundle, most under `node_modules`; an `npm install` that
  changes a dependency therefore marks the bundles stale, which is
  correct.
