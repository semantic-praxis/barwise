# Diagram UI Modernization

Status: in progress
Owner: diagram / vscode
Supersedes: the inline `DiagramPanel.ts` webview template.

## Summary

Replace the diagram webview in `barwise-vscode` -- today
`packages/vscode/src/diagram/DiagramPanel.ts`, ~1530 lines of inline HTML +
vanilla JS in a template literal -- with a componentized React application that
realizes the design prototype.

This is UI/UX modernization. `@barwise/core` and `@barwise/diagram` already
provide the model, YAML serialization, validation, verbalization, graph
construction, ELK layout, and SVG rendering. The webview consumes them; it does
not reimplement them.

## Design inputs

- `barwise/docs/Barwise.zip` -- the Claude Design handoff bundle. Contains the
  prototype (`docs/prototype/barwise-ui-prototype.html`, a 1.6 MB single-file
  build) and its structured component sources (`shell.jsx`, `app.jsx`,
  `diagram.jsx`, `inspector.jsx`, `panels.jsx`, `tree.jsx`, `tweaks.jsx`,
  plus `autolayout.js` and `sample-model.js`). The `.jsx` files are the
  readable design reference.
- The prototype is a **visual mock**, not a functional reference. Its data
  model differs from `@barwise/core`'s metamodel, and its non-diagram surfaces
  are stubbed: `verbalize()` is a hardcoded lookup table, `renderYaml()`
  hand-rolls a string, `DdlPanel` is a constant, `validations` is a literal
  array. Treat the prototype as layout, styling, and interaction intent only.

Not present in the repo (the original spec referenced them; they do not exist
here): `chats/chat1.md`, and a built-out `packages/webview/` /
`webview-server` / bridge bundle. The loose `.jsx` files above are the sole
UI reference. If `chat1.md` surfaces later, revisit the design-intent notes.

## Architecture decision

**Layout runs host-side; front ends consume a serializable presentation
contract.** _(Resolved -- see "Resolved: a front-end-agnostic
presentation contract" below.)_

`@barwise/diagram`'s pipeline is `OrmModel -> OrmGraph -> PositionedGraph ->
SVG`. The host (extension, Node context) already runs this via
`generateDiagram`, which returns a `PositionedGraph` (`result.layout`) it
currently discards. The new design:

1. The host runs `generateDiagram` and sends `result.layout` -- the
   `PositionedGraph` -- to the webview over a typed message protocol.
2. The webview renders the `PositionedGraph` with React/SVG components, a
   faithful transcription of `SvgRenderer.ts`.
3. The webview imports **zero** `@barwise/*` runtime code. It may use
   `import type` from `@barwise/diagram` for `PositionedGraph` (erased at
   build time).

This is the prototype's "Option B" (React renders the diagram) **without**
running `@barwise/core`/`@barwise/diagram` in the browser sandbox -- which
would mean bundling NodeNext ESM packages (and ELK) for a CSP-restricted
webview. `PositionedGraph` is plain serializable data, so `postMessage`
carries it cleanly, and ELK layout stays in Node where it already runs.

Consequence: there are two renderers of the same `PositionedGraph` --
`renderSvg` (static export for MCP / CLI / chat) and the React components
(interactive editor). That split is deliberate. The single shared layout
engine remains ELK `layoutGraph`.

### Resolved: a front-end-agnostic presentation contract

The host-side decision was revisited and **confirmed**, with a
refinement. The alternative -- running the full pipeline
(`@barwise/core` + `@barwise/diagram` + ELK) inside the webview -- was
weighed and rejected: it is feasible (esbuild can target the browser,
`elkjs` ships a worker-free `elk.bundled.js`, core's `node:` imports are
confined to its import/lineage modules) but it is a Phase-0-scale
re-architecture for little gain, pulling a 1.5-2.5 MB bundle through a
browser build and moving stateful machinery into the sandbox.

The refinement: treat the layout output not as a webview message
payload but as a **front-end-agnostic presentation contract** -- a
serializable representation of "the diagram as positioned information"
that is produced once, host-side, and delivered to any number of front
ends. `PositionedGraph` (plus the focus / view / ghost metadata in
`DiagramMeta`) already _is_ that representation, and two front ends
already consume it: `renderSvg` (static SVG for CLI / MCP / chat) and
the React webview (interactive editor). What is missing is that the
contract is not yet _deliberate_ -- its production and delivery are
entangled with `DiagramPanel` and the VS Code `postMessage` protocol.

Formalizing and decoupling that contract is specified separately, in
`diagram-presentation-contract.spec.md`, and executed as its own effort.
It does not block this phase: the affordances built here are pure
consumers of the contract -- their UI emits semantic intent and renders
the positioned graph, indifferent to where layout runs.

### Decisions taken autonomously (confirm or redirect)

- **Rendering**: Option B, host-side layout (above).
- **Code location**: `packages/vscode/webview/` -- inside the extension
  package, no new monorepo node, no Turborepo wiring. Built to
  `packages/vscode/dist/webview/`.
- **Tree pane**: Phase 2 adds a self-contained model tree inside the
  webview's left pane (the prototype's 3-pane shell) rather than reusing
  the native `barwise.modelTree` sidebar. This accepts some overlap with
  the native tree in exchange for a cohesive in-panel UX. The in-panel
  tree needs model structure in the webview, so the presentation
  contract (see "Resolved" above) must carry a serialized model summary
  alongside the positioned graph. Phase 1 still ships the diagram pane
  only.
- **Tab panels** (Verbalization / Fact Population / YAML / DDL): Phase 3, and
  built as thin views over existing `@barwise/core` calls -- not new logic.

## Non-goals

- No new ORM domain logic, YAML parser, or layout algorithm.
- Do not port the prototype's force-directed `autolayout` -- ELK supersedes it.
- No standalone web server.
- No change to the `.orm.yaml` format or its `diagrams:` section.

## Scope reframings vs. the prototype

- **Diagram parity is the full ORM 2 notation set.** Because the webview
  renders the same `PositionedGraph` that `SvgRenderer.ts` renders, it must
  draw everything `SvgRenderer` draws: entity rounded-rects, dashed value
  ellipses, role boxes, uniqueness bars (simple + spanning), mandatory dots,
  frequency labels, ring-constraint labels, objectification boxes, subtype
  arrows, and external constraint symbols (`external_uniqueness`, `exclusion`,
  `exclusive_or`, `disjunctive_mandatory`, `subset`, `equality`). The
  prototype's `diagram.jsx` draws only uniqueness + mandatory; it is a partial
  reference.
- **Metamodel adapter.** The prototype's view-model (inline roles, nested
  per-fact constraints, id-keyed layout) is not `@barwise/core`'s. The webview
  consumes `PositionedGraph` (not the model), which removes most of this gap;
  remaining id-vs-name-key mapping for layout persistence stays host-side
  (`DiagramPanel` already does this).
- **Tab panels are thin views.** Phase 3 wires Verbalization to core's
  verbalizer, YAML to `OrmYamlSerializer`, DDL to the Rmap/DDL exporter, and
  Fact Population to core's `Population`/`FactInstance` types.

## Message protocol

A typed union replaces today's ad-hoc `{command, nodeId, x, y}` messages.
Defined once in `packages/vscode/src/diagram/protocol.ts`, imported by both
the host and the webview.

- **Host -> webview** (`InboundMessage`): `setGraph` (carries
  `PositionedGraph` + ghost ids + metadata), `highlight`, `clearHighlight`.
- **Webview -> host** (`OutboundMessage`): `ready`, `nodeMoved`,
  `toggleOrientation`, `saveLayout`, `selectElement`, `focusEntity`,
  `clearFocus`, `saveView`, `loadView`, `showNeighbors`, `addGhostToView`,
  `clearGhosts`.

The `DiagramMeta` carried by `setGraph` includes `availableViews` -- the
names of every layout in the model's `diagrams:` section -- so the
webview can populate its Views menu without holding the model. `loadView`
is the protocol counterpart of the host's existing `DiagramPanel.loadView`
static (previously reachable only from the native tree).

## Phase 1 affordances: focus, named views, ghost neighbors

Phase 0/1 shipped the diagram pane but deferred the interaction
affordances that the host (`DiagramPanel`) already supports over the
protocol. This phase adds the webview UI for them. The legacy webview
exposed these through floating button bars and a right-click context
menu; the React app does not port that chrome. Instead:

- **Focus / hop neighborhood.** A contextual control in the inspector.
  When an object type is selected, the inspector shows a _Focus_ control
  with a 1/2/3-hop selector; choosing a hop count sends
  `focusEntity { nodeId, hopCount }`. While a focus is active a thin
  **context bar** appears below the top bar ("Focused on <entity>,
  <n> hops") with a hop stepper and a _Show full model_ action
  (`clearFocus`). Focus and named views are mutually exclusive host-side.

- **Named saved views.** A _Views_ menu in the top bar. It lists every
  named layout (from `meta.availableViews`), plus _Save current view..._
  (`saveView`; the host prompts for the name) and _Show full model_.
  Selecting a view sends `loadView { viewName }`. The active view name
  shows in the menu button and the context bar.

- **Ghost-neighbor preview.** When a named view is active, the inspector
  offers _Show neighbors_ for a selected in-view entity (`showNeighbors`),
  rendering the view's adjacent-but-excluded entities as dimmed ghosts.
  A ghost entity's inspector offers _Add to view_ (`addGhostToView`),
  promoting it into the saved view. The context bar surfaces a _Clear
  preview_ action (`clearGhosts`) while ghosts are present. Ghost preview
  is tied to named views because the host threads ghosts only through the
  view `includeFilter`; it is not offered in plain focus mode.

- **Command palette.** A Cmd/Ctrl+K overlay is the unified verb surface.
  It lists context-aware commands -- focus the selection at N hops, show
  neighbors, add a ghost to the view, open or save a view, clear focus,
  fit / zoom / save layout, switch tabs -- each filtered by typed text and
  runnable by keyboard. It is an alternate route to the same verbs, not a
  new capability.

No host-side filtering logic changes: the webview only adds UI that
drives the existing protocol, plus the two protocol additions noted
above.

## Build

The extension builds with esbuild (`esbuild.mjs`, Node/CJS, three entry
points). The webview adds a fourth, browser-targeted build: entry
`webview/src/main.tsx`, `platform: browser`, `format: esm`, `jsx: automatic`,
emitting `dist/webview/main.js` + `main.css`. React and react-dom are bundled
into that artifact (new devDependencies of `barwise-vscode`). The panel loads
the bundle via `webview.asWebviewUri` with a CSP nonce and `localResourceRoots`
covering `dist/webview`. No CDN scripts or web fonts (CSP-blocked); React
inline styles are set via the DOM API and are not CSP-governed.

## Phased plan

- **Phase 0 -- setup.** Spec, webview build wiring, typed protocol, React
  scaffold. _(this PR)_
- **Phase 1 -- diagram pane at parity (the gate).** React shell hosting the
  diagram; reach feature parity with today's `DiagramPanel`: pan/zoom/drag,
  orientation toggle, save layout, focus/hop, named views, ghost neighbors,
  highlight, live reload. No regressions.
- **Phase 2 -- tree + inspector panes** (self-contained webview tree; see
  the Decisions section).
- **Phase 3 -- tab panels** wired to `@barwise/core`.
- **Phase 4 -- tweaks (themes, density) + command palette.**

## Phase 0 / Phase 1 status

Phase 0 and the diagram-pane core landed in the first PR: webview build
pipeline; typed protocol; React 3-pane shell (top bar, panes, bottom
strip) styled with VS Code theme variables; diagram canvas rendering the
full `PositionedGraph` via React/SVG; pan, zoom, fit, drag-to-reposition,
orientation flip, save layout, selection + highlight, live reload on
document change; `DiagramPanel` rewritten as a React-bundle host with
CSP/nonce.

This PR completes Phase 1's deferred affordances: focus/hop neighborhood
(inspector control + context bar), named saved views (top-bar menu),
ghost-neighbor preview (inspector actions + context bar), and a
Cmd/Ctrl+K command palette. Host-side support for these already existed
in `DiagramPanel`; the webview UI now drives it. See "Phase 1
affordances" above.

Still deferred to later phases: the self-contained left model tree and
deeper inspector content (Phase 2), the alternate tab panels (Phase 3),
and theming / density tweaks (Phase 4).

## Testing

The webview renderer is pure (`PositionedGraph` -> SVG components) and unit
testable with Vitest + a DOM environment. Parity is verified by exercising
each interaction against a fixture `.orm.yaml` in the extension integration
tests. Quality gate before merge: `node esbuild.mjs` (all four bundles),
`tsc --noEmit` for both host and webview tsconfigs, and the existing test
suites.
