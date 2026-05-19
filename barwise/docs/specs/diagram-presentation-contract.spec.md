# Diagram Presentation Contract

Status: proposed
Owner: diagram / vscode
Related: `diagram-ui-modernization.spec.md` -- resolves its open
architecture question ("Resolved: a front-end-agnostic presentation
contract").

## Summary

Extract the interactive-diagram state and computation that today lives
inside `barwise-vscode`'s `DiagramPanel` into a platform-independent
**diagram session** in `@barwise/diagram`, and define the serializable
**presentation contract** it produces. After this change `DiagramPanel`
is a thin VS Code adapter -- webview hosting, file I/O, transport -- and
the diagram domain logic (layout, focus/hop filtering, named views,
ghost neighbors, save-layout assembly) has one home, reachable by any
front end that can consume serializable data.

## Motivation

`diagram-ui-modernization.spec.md` resolved that diagram layout runs
host-side and front ends consume a serializable positioned graph. Today
that contract is implicit. `PositionedGraph` is a clean type, but the
logic that _produces_ it across interactions, and the _metadata_ that
travels with it, are entangled with `DiagramPanel` -- ~900 lines mixing
ORM/graph logic with `vscode.*` calls, `node:fs` I/O, and
`webview.postMessage`. Consequences:

- The contract cannot be consumed by anything that is not the VS Code
  webview -- not `renderSvg`, not a CLI preview, not a unit test --
  without reaching through VS Code.
- `DiagramPanel` works against the package dependency rule (CLAUDE.md):
  "Diagram generation logic stays in `@barwise/diagram`." Focus/hop
  filtering, view filters, ghost computation, and neighborhood expansion
  are diagram domain logic currently sitting in the `vscode` package.
- That logic has no unit tests and cannot get any without a VS Code
  test host.

## Goals

- A named, documented, serializable presentation contract.
- A `DiagramSession` in `@barwise/diagram` that owns interactive state
  and produces the contract, with zero VS Code / browser / `fs`
  dependencies.
- `DiagramPanel` reduced to a VS Code adapter over `DiagramSession`.
- The webview keeps importing only types -- no `@barwise/*` runtime.
- No behavior change: every Phase 1 interaction works exactly as today.
  Parity is the acceptance test.

## Non-goals

- No in-webview layout (rejected in the modernization spec).
- No new front ends. The contract makes additional front ends
  _possible_; this effort does not build one, and adds no speculative
  web server or web app.
- No change to the `.orm.yaml` format, the ELK layout, or ORM 2
  notation.
- No new diagram features. This is a pure extraction and formalization.

## The contract

`@barwise/diagram` gains, alongside the existing `PositionedGraph`, a set
of plain serializable types in a new `session/` module:

- `DiagramPresentation` -- the full payload a front end renders:
  - `graph: PositionedGraph`
  - `ghostNodeIds: readonly string[]`
  - `focus: DiagramFocus | null`
  - `view: DiagramViewInfo | null`
  - `availableViews: readonly string[]`
  - `hasUnsavedLayout: boolean`
  - `modelName: string`
- `DiagramFocus` = `{ entityId; entityName; hopCount }`
- `DiagramViewInfo` = `{ viewName; hasGhosts }`
- `DiagramIntent` -- the closed union of operations a front end may
  request: `moveNode`, `toggleOrientation`, `selectElement`,
  `focusEntity`, `clearFocus`, `loadView`, `showNeighbors`,
  `addGhostToView`, `clearGhosts`. Save operations are separate (see
  "Persistence").

All contract types are plain data: no class instances, no functions.
They cross `postMessage`, a JSON file, or a function return identically.
The webview imports them with `import type` only, so it still links no
`@barwise/*` runtime code.

`DiagramMeta`, `InboundMessage`, and `OutboundMessage` in
`packages/vscode/src/diagram/protocol.ts` are rebuilt on top of these
types: the VS Code messages become thin envelopes carrying contract
values. `fileName` is a host concept and stays in the VS Code layer, not
in the contract.

## DiagramSession

A stateful class in `@barwise/diagram/src/session/`. It holds:

- the current `OrmModel`
- position / orientation overrides
- focus entity id + hop count
- active view filter + name
- ghost object-type ids
- the last computed `PositionedGraph` (needed for drag coordinate
  conversion)
- the unsaved-layout flag

API (shape; exact names finalized during implementation):

- `constructor(model, savedLayout?)` and `setModel(model)` -- load or
  hot-swap the model for live reload. On a swap, stale filter ids are
  pruned and active view filters expanded to the new model, exactly as
  `DiagramPanel` does today.
- `present(): Promise<DiagramPresentation>` -- run `generateDiagram`
  with the current state and return the contract. Async (ELK).
- `apply(intent: DiagramIntent): void` -- mutate session state from a
  front-end intent. Pure state mutation; the caller then calls
  `present()`. Drag intents carry top-left coordinates and are converted
  to center-based overrides using the last `PositionedGraph`.
- layout-assembly helpers for persistence (see below).

All of `DiagramPanel`'s diagram logic moves into `DiagramSession` with
behavior unchanged: `pinAllEntitiesIfNeeded`, `cleanStaleFilterIds`,
`expandFilterForNewModel`, `buildMultiEntityFilter`,
`computeGhostRenderIds`, `applyNamedView`, the element-kind dispatch in
`highlightElement`, the focus / ghost branches of `handleMessage`, and
the include-filter expansion currently in `rerender`.
`computeNeighborhood` is already exported by `@barwise/diagram`; the
session calls it directly.

The async stale-render guard (`renderVersion`) stays in `DiagramPanel`:
it concerns which presentation the _adapter_ chooses to post, not
session state.

## Persistence

File I/O stays in `DiagramPanel` -- only the VS Code layer knows the
file path and uses `node:fs`. The split:

- `DiagramSession` exposes `buildLayout(name): DiagramLayout` and
  `buildViewLayout(name): DiagramLayout`, assembling `positions`,
  `orientations`, and `elements` from current state -- the logic inside
  `saveLayout` and `saveView` today.
- `DiagramPanel` performs the read-fresh-model / merge / serialize /
  write cycle and the `vscode.window` name prompt and notifications.
- `addGhostToView`: the session promotes the ghost into its filter and
  returns the updated element-name list; `DiagramPanel` persists it.

## DiagramPanel after the change

`DiagramPanel` keeps only VS Code responsibilities:

- creating / revealing / disposing the `WebviewPanel`, and the
  CSP + nonce HTML shell
- the debounced document watcher, which calls `session.setModel`
- translating inbound webview messages into `session.apply(intent)` and
  posting `await session.present()` back
- file read/write for save-layout and save-view, with the
  `vscode.window` prompt and notifications
- the `highlightElement` and `loadView` static methods the native model
  tree calls -- kept as VS Code entry points but reduced to thin
  delegations: their domain logic (element-kind dispatch, neighborhood
  filter construction) moves into `DiagramSession`

It no longer imports `computeNeighborhood`, `PositionOverrides`,
`OrientationOverrides`, or `generateDiagram` -- only `DiagramSession` and
the contract types.

## Package boundaries

- `DiagramSession` and the contract types live in `@barwise/diagram`.
  The change is additive: existing exports (`generateDiagram`,
  `renderSvg`, `PositionedGraph`, ...) are untouched, so `@barwise/cli`
  and `@barwise/mcp` are unaffected.
- `@barwise/diagram` keeps its zero-VS-Code, zero-browser rule.
  `DiagramSession` depends only on `@barwise/core` and the existing
  diagram pipeline.
- `barwise-vscode`'s `protocol.ts` re-expresses its messages over the
  contract types.

## Migration / sequencing

Each step keeps the monorepo build green.

1. Add contract types to `@barwise/diagram` (`src/session/contract.ts`),
   exported from `index.ts`.
2. Add `DiagramSession` (`src/session/DiagramSession.ts`); port
   `DiagramPanel`'s logic into it with Vitest unit tests built on
   `ModelBuilder` fixtures -- focus, hop counts, named views, ghost
   preview, live-reload filter expansion, and layout assembly.
3. Rebuild `protocol.ts` over the contract types.
4. Rewrite `DiagramPanel` as the adapter; delete the migrated logic.
5. Adjust the webview's type imports if type names changed (it already
   imports `PositionedGraph` and `DiagramMeta` as types).
6. Full gate: monorepo build, test, lint, knip, oxlint, circular,
   `dprint check`, and `tsc` for both vscode tsconfigs.

## Testing

- `DiagramSession` becomes unit-testable in `@barwise/diagram` with no
  VS Code host: construct a session, drive intents, assert on the
  returned `DiagramPresentation`. This is new coverage for logic that
  has none today.
- Existing `@barwise/diagram` and `barwise-vscode` suites stay green.
- Manual VS Code parity check of every Phase 1 interaction: drag, save
  layout, orientation flip, focus at 1/2/3 hops, named view load/save,
  ghost preview, add-to-view, highlight from the tree, live reload.

## Risks

- `DiagramPanel` is today the only thing that exercises this logic, so
  the port must be faithful. The new `DiagramSession` unit tests are the
  guard; the bar is behavioral parity, not improvement.
- `@barwise/diagram`'s public surface grows. The growth is additive, but
  the full downstream build (`@barwise/cli`, `@barwise/mcp`,
  `barwise-vscode`) must be run after the change.
