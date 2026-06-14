# @barwise/diagram

Platform-independent ORM diagram layout. Converts an `OrmModel` from
`@barwise/core` into a positioned graph (`PositionedGraph`). Rendering
that graph to SVG moved to `@barwise/diagram-ui` (the
renderer-consolidation spec); this package is layout only.

## Dependency Rule

This package depends on `@barwise/core` (model types) and `elkjs`
(layout engine). It has ZERO dependencies on VS Code, browser APIs, or
React. The output is a plain `PositionedGraph` data structure, so it
works in any environment.

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
    theme.ts            Color/dimension constants (also via the ./theme subpath)
  DiagramGenerator.ts   Main entry point: model -> positioned layout
  index.ts              Public API
```

## Commands

```sh
npx vitest run              # run tests
npx vitest run --coverage   # run tests with coverage
npx tsc --noEmit            # type-check only
```

## Key Conventions

- The pipeline is `OrmModel -> OrmGraph -> PositionedGraph`. Each stage
  is independently testable. Rendering the `PositionedGraph` to SVG is
  `@barwise/diagram-ui`'s job (`renderDiagramSvg`), not this package's.
- `generateDiagram()` is the main public entry point. It returns a
  `DiagramResult` with the positioned `layout` and the `graph`.
- Layout is async because ELK.js uses a Web Worker internally.
- Theme constants are centralized in `render/theme.ts`. Use them
  instead of hardcoded values. They are also exposed via the
  `@barwise/diagram/theme` subpath export so the `@barwise/diagram-ui`
  renderers share one source of truth without importing the layout
  pipeline (and its `elkjs`).

## Testing

- Framework: Vitest
- Tests cover each pipeline stage: model-to-graph conversion and layout
  engine integration (node/edge counts, positions, neighborhood filter).
- Tests use `ModelBuilder` from `@barwise/core/tests/helpers/` via the
  core package.

## Dependencies

| Direction  | Package               | What is used                                                              |
| ---------- | --------------------- | ------------------------------------------------------------------------- |
| Upstream   | `@barwise/core`       | `OrmModel`, `ObjectType`, `FactType`, `Role`, `Constraint`, `SubtypeFact` |
| Downstream | `@barwise/diagram-ui` | `PositionedGraph` type, `./theme` subpath; renders the layout to SVG      |
| Downstream | `@barwise/cli`/`mcp`  | `generateDiagram` for the diagram command/tool (renders via diagram-ui)   |
