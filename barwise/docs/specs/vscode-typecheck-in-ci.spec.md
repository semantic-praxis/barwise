# The vscode package's type-checks run in CI

Status: Implemented -- workstream 1 (this PR)

Created: 2026-10-08
Last-updated: 2026-10-08
Tracking: barwise-iii

## Principle

A check that never runs reports nothing, and nothing reads as green.
Every other package builds with `tsc`, so its build is its type-check.
`barwise-vscode` builds with esbuild, which strips types without checking
them, and its lint step is eslint over `src/`. So the package's own two
type-checks, `check` (`tsconfig.json`) and `check:webview`
(`webview/tsconfig.json`), ran nowhere, and both had gone red on main
without a signal:

- `check`: 4 errors in `src/sidebar/ModelTreeProvider.ts`, reading
  `referenceMode` and `dataType` on `ObjectType` after core made it the
  union `EntityType | ValueType` (`core-branching-load.spec.md`).
- `check:webview`: 18 errors across 9 files, `Cannot find namespace
  'JSX'`, because React 19's types no longer declare a global `JSX`.

The code ran correctly in both cases: esbuild emitted it, and the
`kind` filter already selected the right objects. The type checker is
the instrument that would have said the code no longer described the
types, and it was not wired in.

## Scope

In scope:

- When a change is not docs-only, CI shall run `npm run --workspace=barwise-vscode check` and
  `npm run --workspace=barwise-vscode check:webview` after `npm run build`,
  and fail on any type error.
- `ModelTreeProvider.ts` narrows with core's `isEntityType` and
  `isValueType`, so `entityItem` takes an `EntityType` and `valueItem` a
  `ValueType`. An entity's reference mode is never absent (core refuses
  one without it), so the old `referenceMode ? ... : ""` fallback goes.
- Each webview component file imports `type { JSX } from "react"`, as
  `@barwise/diagram-ui` already does.

Out of scope:

- **eslint over `webview/src`.** The package's `lint` script covers
  `src/` only. Widening it surfaces one existing finding (an unused
  `_kind` parameter in `webview/src/App.tsx`) and is a separate decision
  about the lint scope, not about type-checking.
- **The integration-test tsconfig** (`tsconfig.test.json`), which
  compiles only when `test:integration` runs. Not measured here.

## Why after `build`, and why two steps

A per-package `tsc --noEmit` reads its dependencies' `dist`, not their
source (root `CLAUDE.md`). Run before `npm run build`, it would check
against whatever `dist` the runner happened to have, which on a fresh
checkout is none. Two steps rather than one script, so a failure names
which tsconfig broke, and so `ci-local.mjs`, which derives its gate list
from `run: npm ...` lines, picks both up without a change. The
`--workspace=` form already appears in `ci.yml` for the two bundle steps.

## Alternatives considered

- **Make esbuild type-check** (a plugin, or `tsc` before `esbuild` in
  `build`). It couples the build to the checker, and makes every local
  `node esbuild.mjs` pay for a full check. The separate step keeps the
  build fast and the check explicit.
- **A turbo `check` task across packages.** Only this package needs it;
  the others' builds already type-check. A cross-package task would be a
  second type-check of every other package for no new coverage.

## Workstreams

### 1. Fix the errors and wire both checks into CI (this PR)

Fixes the 4 + 18 errors and adds the two `ci.yml` steps with the
docs-only guard every build-dependent step carries. Verified by planting
a type error in each tsconfig's scope and seeing `ci:local` fail on the
matching step.

## Risks and testing

- The tree builder's output is unchanged: the filters select the same
  objects (`isEntityType` is `kind === "entity"`), and an entity's
  description was always ` (.<referenceMode>)` because the mode is never
  empty. The vscode unit tests (102) pass unchanged.
- The webview change is type-only: `import type` is erased by esbuild.

## Non-goals

- No change to how the extension builds, bundles or lints.
