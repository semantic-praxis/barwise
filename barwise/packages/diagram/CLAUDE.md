# @barwise/diagram

Platform-independent ORM diagram layout and SVG rendering. Converts an
`OrmModel` from `@barwise/core` into a positioned graph and renders it
as an SVG string.

## Dependency Rule

This package depends on `@barwise/core` (model types) and `elkjs`
(layout engine). It has ZERO dependencies on VS Code or browser APIs.
The SVG output is a plain string, not a DOM tree, so it works in any
environment.

## Package Layout

```
src/
  graph/
    GraphTypes.ts       Graph node/edge types (ObjectTypeNode, FactTypeNode, RoleBox)
    ModelToGraph.ts     Converts OrmModel into an OrmGraph
  layout/
    LayoutTypes.ts      Positioned graph types with coordinates and dimensions
    ElkLayoutEngine.ts  Runs ELK.js to compute node/edge positions
  render/
    SvgRenderer.ts      Renders a PositionedGraph as an SVG string
    theme.ts            Color/dimension constants for diagram styling
  DiagramGenerator.ts   Main entry point: model -> SVG (orchestrates graph + layout + render)
  index.ts              Public API
```

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # run tests with coverage
npx tsc --noEmit            # type-check only
```

## Key Conventions

- The pipeline is `OrmModel -> OrmGraph -> PositionedGraph -> SVG string`.
  Each stage is independently testable.
- `generateDiagram()` is the main public entry point. It returns a
  `DiagramResult` with the SVG string and metadata.
- Layout is async because ELK.js uses a Web Worker internally.
- Theme constants are centralized in `render/theme.ts`. Use them
  instead of hardcoded values. They are also exposed via the
  `@barwise/diagram/theme` subpath export so UI renderers (the webview,
  and the future `@barwise/diagram-ui`) share one source of truth
  without importing the layout pipeline (and its `elkjs`).

## Testing

- Framework: Vitest
- Tests cover each pipeline stage: model-to-graph conversion, layout
  engine integration, and SVG output structure.
- Tests use `ModelBuilder` from `@barwise/core/tests/helpers/` via the
  core package.

## Dependencies

| Direction  | Package          | What is used                                                              |
| ---------- | ---------------- | ------------------------------------------------------------------------- |
| Upstream   | `@barwise/core`  | `OrmModel`, `ObjectType`, `FactType`, `Role`, `Constraint`, `SubtypeFact` |
| Downstream | `barwise-vscode` | `generateDiagram`, SVG rendering for the webview diagram panel            |
