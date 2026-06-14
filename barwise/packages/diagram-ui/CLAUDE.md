# @barwise/diagram-ui

The React renderer for ORM diagrams -- the one renderer the
diagram-renderer-consolidation spec calls for
(`docs/specs/diagram-renderer-consolidation.spec.md`). It turns a
`PositionedGraph` from `@barwise/diagram` into SVG from a single
component: `OrmDiagram` is the pure, presentational component (the ORM 2
notation); `DiagramCanvas` wraps it with the interactive pan / zoom /
drag canvas the VS Code webview uses; and `renderDiagramSvg` renders it
to a static SVG string headlessly via `react-dom/server` for the CLI and
MCP. The CLI/MCP path replaced `@barwise/diagram`'s retired
`SvgRenderer`, removing the two-renderer parity tax.

`renderDiagramSvg` lives behind the `@barwise/diagram-ui/server` subpath
(not the main barrel), so the webview never pulls `react-dom/server`
into the browser bundle.

## Dependency Rule

Depends on `@barwise/diagram` for the `PositionedGraph` type
(`import type`, erased at build) and the styling constants (the
`@barwise/diagram/theme` subpath, which carries no `elkjs`), plus
`react` and `react-dom` (`react-dom/server` for the headless render). It
has ZERO dependency on `elkjs`, the layout pipeline, or VS Code, so the
webview can bundle the main barrel without pulling the layout engine or
`react-dom/server` into the browser.

`OrmDiagram` is pure (no hooks, no browser APIs) so it renders headlessly
through `react-dom/server`. `DiagramCanvas` is browser-only (hooks, DOM
events); keep its DOM references inside hook callbacks, never at module
scope, so importing the package stays safe in Node.

## Package Layout

```
src/
  index.ts             Public API (OrmDiagram, DiagramCanvas)
  server.ts            @barwise/diagram-ui/server subpath (renderDiagramSvg)
  OrmDiagram.tsx       Pure PositionedGraph -> SVG (<g>) React component
  DiagramCanvas.tsx    Interactive pan / zoom / drag wrapper over OrmDiagram
  renderDiagramSvg.tsx Headless static SVG via react-dom/server
```

## Commands

```sh
npx vitest run              # run tests
npx tsc                     # build to dist (jsx: react-jsx)
```

`OrmDiagram` and `renderDiagramSvg` are tested headlessly with
`react-dom/server`; `DiagramCanvas`'s interactions (click, drag,
double-click, the imperative handle) are tested in jsdom via Testing
Library (`// @vitest-environment jsdom`).

The build is `tsc` (not esbuild): it emits `dist/*.js` that the webview's
esbuild bundles and that Node (CLI/MCP, workstream 3) imports. The
tsconfig adds `jsx: react-jsx` and the `DOM` lib for the interactive
canvas.

## Dependencies

| Direction | Package            | What is used                              |
| --------- | ------------------ | ----------------------------------------- |
| Upstream  | `@barwise/diagram` | `PositionedGraph` type, `./theme` subpath |
| Upstream  | `react`            | function components and hooks             |
| Upstream  | `react-dom`        | `react-dom/server` renderToStaticMarkup   |
