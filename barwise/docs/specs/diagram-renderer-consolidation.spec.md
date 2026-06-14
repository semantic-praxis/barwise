# Diagram Renderer Consolidation: One Renderer, Not Two

Status: Draft for review (design only -- no implementation in this PR)
Tracking: REPO_REVIEW-2026-06.md finding A6
Related: `diagram-presentation-contract.spec.md` (independent -- session
state, not the renderer; see "Relationship to other specs")

## Problem

The repo renders the same `PositionedGraph` two ways, and every notation
change has to be made twice. `@barwise/diagram/render/SvgRenderer.ts`
(619 lines) emits an SVG string for the CLI `diagram` command and the
MCP `generate_diagram` tool; `OrmDiagram.tsx` (636 lines, in the VS Code
webview) emits the same drawing as React JSX for the interactive editor.
The two are faithful transcriptions of each other -- same node-kind
dispatch, same constraint glyphs, same subtype arrows -- plus two
hand-synced `theme.ts` files. The modernization spec called the split
deliberate; it is a standing parity tax that DRY (a stated principle)
says to remove once it can be removed without coupling the packages.

It can be removed now. `OrmDiagram` is a pure, hook-free component:
identical props produce identical JSX, and all interaction state (pan,
zoom, drag, selection) lives in its parent `DiagramCanvas`, not in the
renderer. A pure `PositionedGraph -> SVG` React component renders to a
static string headlessly through `react-dom/server`
`renderToStaticMarkup`. So the React component can be the _only_
renderer: interactive in the webview, static for the CLI and MCP.

## Should the renderer move into its own package? (resolved: yes)

The one renderer cannot live where either renderer lives today. It
cannot stay in the webview, because `@barwise/cli` and `@barwise/mcp`
must not depend on `barwise-vscode`. It cannot move into
`@barwise/diagram`, because that package is deliberately React-free and
browser-free (its only deps are `@barwise/core` and `elkjs`); adding
React there would force it on every layout-only consumer, and the
webview still could not import it -- importing `@barwise/diagram` pulls
`elkjs` into the browser bundle, which is the very reason the webview
duplicates the theme today.

So the renderer becomes a new package, `@barwise/diagram-ui`: the React
components plus a headless `renderDiagramSvg`. It depends on `react`,
`react-dom`, and `@barwise/diagram` for the `PositionedGraph` type
(`import type`, erased at build) and the sizing constants (via a
`./theme` subpath that carries no `elkjs`). The CLI, MCP, and webview
all consume it; none gains a VS Code dependency. This overrides the
modernization spec's "no new monorepo node" decision, which was made
under a webview-only assumption -- before the static renderer needed a
home reachable from `cli`/`mcp`.

## Scope

In scope: retiring `SvgRenderer`, creating `@barwise/diagram-ui` from
the existing webview components, unifying the theme, and repointing the
CLI/MCP static-SVG path at the new package.

Out of scope: the `DiagramSession` extraction (separate spec), any
notation or layout change, in-webview layout (rejected in the
modernization spec), a web server or new front end, and changes to
`PositionedGraph` or the ELK pipeline.

## Inventory

| Module / artifact                      | Today                             | Verdict                            |
| -------------------------------------- | --------------------------------- | ---------------------------------- |
| `render/SvgRenderer.ts` (diagram)      | string SVG renderer, 619 lines    | retire (WS3)                       |
| `OrmDiagram.tsx` (vscode webview)      | pure JSX-SVG renderer, 636 lines  | move to `@barwise/diagram-ui`      |
| `DiagramCanvas.tsx` (vscode webview)   | interactive pan/zoom/drag wrapper | move to `@barwise/diagram-ui`      |
| `render/theme.ts` (diagram)            | sizing + colour constants         | keep; add `./theme` subpath export |
| `webview/.../theme.ts` (vscode)        | hand-synced duplicate             | delete; import the subpath         |
| `ModelToGraph` / `ElkLayoutEngine`     | layout pipeline (elkjs)           | stays in `@barwise/diagram`        |
| `generateDiagram` (diagram)            | returns `{ svg, layout, graph }`  | drop `svg` -> `{ layout, graph }`  |
| cli `diagram` / mcp `generate_diagram` | use `generateDiagram().svg`       | render via `@barwise/diagram-ui`   |
| `PositionedGraph` (LayoutTypes)        | shared render contract            | unchanged (type-only in ui)        |

`ElkLayoutEngine` imports only geometry constants from the theme
(`ROLE_BOX_WIDTH`, `OT_HEIGHT`, `CONSTRAINT_RADIUS`, `FONT_SIZE_ALIAS`
for text measurement, ...), never a colour. So the theme divides cleanly
by concern: geometry is shared by layout and renderer; colour is
renderer-only.

## Target architecture

```
@barwise/diagram        (React-free; @barwise/core + elkjs)
  - ModelToGraph, ElkLayoutEngine, DiagramGenerator, PositionedGraph
  - render/theme.ts (geometry + colour constants)
  - ./theme subpath export (constants only -- no elkjs reaches it)
  - generateDiagram(model) -> { layout, graph }   (no svg)
  - SvgRenderer retired

@barwise/diagram-ui     (NEW; react, react-dom, @barwise/diagram)
  - OrmDiagram, DiagramCanvas (the render + interaction components)
  - renderDiagramSvg(graph, opts) -> string   (react-dom/server)
  - imports PositionedGraph as a type and ./theme for constants
  - no elkjs, no vscode, no fs

tool layer
  - cli `diagram` / mcp `generate_diagram`: layout (diagram) ->
    renderDiagramSvg (diagram-ui)
  - vscode webview: imports OrmDiagram/DiagramCanvas from diagram-ui;
    still links no @barwise/* runtime beyond the bundled components
```

## Workstreams (each independently shippable)

Ordered smallest-blast-radius first. Each lands as its own PR and keeps
the full suite green.

### 1. Unify the theme behind a `./theme` subpath

Add a `"./theme"` entry to `@barwise/diagram`'s `package.json` `exports`
pointing at the compiled `render/theme.js`, delete the duplicated
`webview/.../theme.ts`, and point the webview components at
`@barwise/diagram/theme`. The subpath resolves to the constants module
only, so esbuild does not pull `elkjs` into the webview bundle -- the
exact bloat the duplicate existed to avoid. `COLOR_SELECTION` (webview
interaction only) joins the shared theme. Smallest step, no behavior
change, and it proves the elkjs-free subpath the rest depends on.

### 2. Create `@barwise/diagram-ui` from the webview components

Stand up the package (the `@barwise/code-analysis` package shape, plus
`react`/`react-dom`) and `git mv` `OrmDiagram.tsx`, `DiagramCanvas.tsx`,
and the remaining pure render components out of
`packages/vscode/webview/src/diagram/` into it. The webview imports them
from `@barwise/diagram-ui`; its esbuild bundle is unchanged in content
(same components, now from a package). `import type { PositionedGraph }`
and `@barwise/diagram/theme` are the only `@barwise/diagram` references,
both elkjs-free. No behavior change; the webview renders exactly as
before.

### 3. Headless static renderer; retire `SvgRenderer`

Add `renderDiagramSvg(graph, opts): string` to `@barwise/diagram-ui` --
`renderToStaticMarkup(<OrmDiagram graph={graph} ghostIds={...} />)`.
Repoint the CLI `diagram` command and the MCP `generate_diagram` tool
to compute the layout with `@barwise/diagram` and render it with
`@barwise/diagram-ui`. Change `generateDiagram` to return
`{ layout, graph }` (no `svg`), and delete `SvgRenderer.ts` and its
test. This is the change that removes the parity tax and the only one
that touches `@barwise/diagram`'s public API.

### 4. Component and render tests in `@barwise/diagram-ui`

With the components in a headless-testable package, add Vitest tests:
`renderDiagramSvg` output structure (the SvgRenderer tests port over as
the parity guard) and component rendering via `renderToStaticMarkup`.
This is the seam REPO_REVIEW T1 wants; the interactive `DiagramCanvas`
state/protocol tests can follow. (Provisional: exact scope set once the
package exists in WS2.)

## API and migration impact

- `@barwise/diagram`: `generateDiagram` loses its `svg` field; `renderSvg`
  / `SvgRenderer` are removed from the public API. Callers of `.svg`
  (cli `diagram`, mcp `generate_diagram`, and the
  `llm` `Pipeline.integration.test`) update to render via
  `@barwise/diagram-ui`. The webview already consumes `.layout`, not
  `.svg`, so it is unaffected by the return change.
- New package `@barwise/diagram-ui` enters the dependency graph; `cli`,
  `mcp`, and `vscode` depend on it and gain `react`/`react-dom` at
  runtime. The one-way graph stays acyclic: `diagram-ui` depends on
  `diagram`, never the reverse.
- `barwise-vscode`: the webview imports render components from
  `@barwise/diagram-ui`; `theme.ts` duplication is gone.
- CLAUDE.md dependency graph and the madge `circular` script gain
  `@barwise/diagram-ui`.

## Open decisions (for review)

- **`@barwise/diagram-ui` as a new package.** The alternative is to keep
  duplicating the renderer (status quo) or to force React into
  `@barwise/diagram` (breaks its platform-independence and the webview's
  elkjs avoidance). Recommend the new package: it is the only option
  that gives `cli`/`mcp` the renderer without a VS Code dependency.
- **CLI/MCP gaining `react` + `react-dom`.** These tools currently need
  only `@barwise/diagram`. `react-dom/server` runs fine in Node, and the
  packages are private and unpublished, so install weight is not a real
  cost. Recommend accepting it; the parity tax is the larger cost.
- **`generateDiagram` shape.** Drop `svg` and have callers compose
  layout + render (recommended -- keeps `@barwise/diagram` React-free),
  or add a convenience `generateDiagramSvg` in `@barwise/diagram-ui` that
  composes both. Recommend the drop plus a thin `diagram-ui` convenience
  so cli/mcp stay one-liners.
- **Static markup noise.** `renderToStaticMarkup` keeps the
  `data-id` / `data-kind` attributes the webview uses for hit-testing.
  They are valid, inert SVG attributes in a static export. Recommend
  leaving them (stripping adds a pass for no real benefit); revisit if a
  consumer objects.
- **Visual parity bar.** The static SVG must match the retired
  `SvgRenderer` closely enough. Recommend a golden-file test diffing the
  new output against a pinned fixture, accepting cosmetic attribute-order
  differences.

## Relationship to other specs

`diagram-presentation-contract.spec.md` extracts `DiagramPanel`'s
interactive _state_ into a `DiagramSession`; this spec consolidates the
_renderer_. They are independent and can land in either order: the
session produces a `PositionedGraph`, and this work changes who turns
that graph into SVG. REPO_REVIEW A6 lists both under one heading, but
neither blocks the other.

## Risks and testing

- Behavior and visual parity, not improvement, is the bar. The ported
  SvgRenderer tests plus a golden-file diff guard the static output; a
  manual webview check covers the interactive path.
- `@barwise/diagram`'s public API changes (the `svg` field), so the full
  downstream build (`cli`, `mcp`, `vscode`, and the `llm` integration
  test) runs after WS3.
- Bundling: the webview already bundles React and these components;
  sourcing them from a package is content-neutral. Confirm esbuild
  resolves `@barwise/diagram/theme` without `elkjs` (WS1 verifies this).

## Non-goals

- No ORM 2 notation or ELK layout change; no new diagram features.
- No `DiagramSession` work (separate spec) and no server front end.
- No change to `PositionedGraph` or the `.orm.yaml` format.
