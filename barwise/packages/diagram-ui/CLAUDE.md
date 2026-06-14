# @barwise/diagram-ui

The React renderer for ORM diagrams. It turns a `PositionedGraph` from
`@barwise/diagram` into SVG: `OrmDiagram` is the pure, presentational
component (the ORM 2 notation), and `DiagramCanvas` wraps it with the
interactive pan / zoom / drag canvas the VS Code webview uses.

This is the one renderer the diagram-renderer-consolidation spec calls
for (`docs/specs/diagram-renderer-consolidation.spec.md`). Workstream 2
moved these components out of the webview so any front end can use them;
workstream 3 will add a headless `renderDiagramSvg` (via
`react-dom/server`) so the CLI and MCP render the same component to a
static SVG string, retiring `@barwise/diagram`'s `SvgRenderer`.

## Dependency Rule

Depends on `@barwise/diagram` for the `PositionedGraph` type
(`import type`, erased at build) and the styling constants (the
`@barwise/diagram/theme` subpath, which carries no `elkjs`), plus
`react`. It has ZERO dependency on `elkjs`, the layout pipeline, or VS
Code, so the webview can bundle it without pulling the layout engine into
the browser.

`OrmDiagram` is pure (no hooks, no browser APIs) so it renders headlessly
through `react-dom/server`. `DiagramCanvas` is browser-only (hooks, DOM
events); keep its DOM references inside hook callbacks, never at module
scope, so importing the package stays safe in Node.

## Package Layout

```
src/
  index.ts            Public API
  OrmDiagram.tsx      Pure PositionedGraph -> SVG (<g>) React component
  DiagramCanvas.tsx   Interactive pan / zoom / drag wrapper over OrmDiagram
```

## Commands

```sh
npx vitest run              # run tests (added in workstream 4)
npx tsc                     # build to dist (jsx: react-jsx)
```

The build is `tsc` (not esbuild): it emits `dist/*.js` that the webview's
esbuild bundles and that Node (CLI/MCP, workstream 3) imports. The
tsconfig adds `jsx: react-jsx` and the `DOM` lib for the interactive
canvas.

## Dependencies

| Direction | Package            | What is used                              |
| --------- | ------------------ | ----------------------------------------- |
| Upstream  | `@barwise/diagram` | `PositionedGraph` type, `./theme` subpath |
| Upstream  | `react`            | function components and hooks             |
