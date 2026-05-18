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

## Architecture decision (resolved)

**Layout runs host-side; the webview renders a positioned graph.**

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

### Decisions taken autonomously (confirm or redirect)

- **Rendering**: Option B, host-side layout (above).
- **Code location**: `packages/vscode/webview/` -- inside the extension
  package, no new monorepo node, no Turborepo wiring. Built to
  `packages/vscode/dist/webview/`.
- **Tree pane**: deferred to Phase 2. The extension already contributes a
  native sidebar tree (`barwise.modelTree`). Phase 1 ships the diagram pane
  only; the tree/sidebar overlap is decided before Phase 2 starts.
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
  `clearFocus`, `saveView`, `showNeighbors`, `addGhostToView`, `clearGhosts`.

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
- **Phase 2 -- tree + inspector panes** (after the sidebar-overlap decision).
- **Phase 3 -- tab panels** wired to `@barwise/core`.
- **Phase 4 -- tweaks (themes, density) + command palette.**

## Phase 0 / Phase 1 status (this PR)

Delivered: webview build pipeline; typed protocol; React 3-pane shell (top
bar, panes, bottom strip) styled with VS Code theme variables; diagram canvas
rendering the full `PositionedGraph` via React/SVG; pan, zoom, fit,
drag-to-reposition, orientation flip, save layout, selection + highlight,
live reload on document change; `DiagramPanel` rewritten as a React-bundle
host with CSP/nonce.

Deferred (tracked as follow-up): focus/hop neighborhood UI, named saved
views, ghost-neighbor preview, tree + inspector content, tab panels, theming
and command palette. Host-side support for focus/views/ghosts is retained in
`DiagramPanel`; the webview UI affordances for them land in later phases.

## Testing

The webview renderer is pure (`PositionedGraph` -> SVG components) and unit
testable with Vitest + a DOM environment. Parity is verified by exercising
each interaction against a fixture `.orm.yaml` in the extension integration
tests. Quality gate before merge: `node esbuild.mjs` (all four bundles),
`tsc --noEmit` for both host and webview tsconfigs, and the existing test
suites.
