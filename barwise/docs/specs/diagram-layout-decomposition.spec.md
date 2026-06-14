# Decompose the ELK layout engine into focused units

Status: Draft for review (design only -- no implementation in this PR)
Tracking: REPO_REVIEW-2026-06.md finding A1 (god files; ElkLayoutEngine first)

## Principle

`layout/ElkLayoutEngine.ts` is 1,812 lines holding six unrelated
concerns -- ELK interop, cluster-aware entity placement, fact-type
placement, post-layout adjustments, collision resolution, and edge
routing -- in one module. This is an orthogonality gap: a change to the
Louvain clustering heuristic sits in the same file as ray/rectangle
intersection math, so the two cannot move or be reasoned about
independently. It is also a determinism-testing gap. Most of these
concerns are pure functions over plain geometry (cluster detection,
overlap resolution, border intersection), but today the only way to
reach them is through `layoutGraph`, which forces an ELK mock and hides
each unit's behavior behind a full layout run. The file sits at 71.75%
coverage and caps the diagram package's statement/line/function floors
(`vitest.config.ts` documents this).

Decomposing it serves orthogonality (one concern per module) and lets
the deterministic, ELK-free units be tested directly -- which is what
lets the diagram coverage floors rise back to honest levels.

## Should we keep `layoutGraph`'s signature and public surface? (resolved: yes)

The public API does not move. `@barwise/diagram`'s `index.ts` exports
only `layoutGraph`, `PositionOverrides`, and `OrientationOverrides` from
this file; `DiagramGenerator.ts` imports the same three. Both stay
byte-identical. The decomposition is entirely internal to
`src/layout/`: `ElkLayoutEngine.ts` keeps `layoutGraph` as a thin
orchestrator that calls the extracted modules in sequence. No downstream
package (cli, mcp, vscode, diagram-ui) sees a change. The two
`@internal` test-only exports (`buildEntityElkGraph`, `detectClusters`)
move to their new modules; their tests re-import from the new paths.

## Scope

In scope: split `src/layout/ElkLayoutEngine.ts` into one module per
concern, keeping `layoutGraph` as the orchestrator; add focused unit
tests for the now-reachable pure units; raise the diagram coverage
floors to match the new, higher measured coverage.

Out of scope: any change to layout _behavior_ (positions, orientations,
routing, bounds are identical), to the ELK options or algorithm, to the
public API, or to `LayoutTypes.ts`. The other A1 god files
(`DraftModelParser`, `import.ts`, `ToolRegistration`) are separate
findings. `DiagramPanel` is dissolved by A6 / the
presentation-contract spec, not here.

## Inventory

| Symbol (current `ElkLayoutEngine.ts`)                          | Concern                          | Verdict                        |
| -------------------------------------------------------------- | -------------------------------- | ------------------------------ |
| `getElk`, `ELKConstructor`, `elkInstance`                      | ELK singleton + CJS/ESM interop  | move -> `ElkInterop.ts`        |
| `layoutGraph`, `PositionOverrides`, `OrientationOverrides`     | orchestration + public types     | stays (thin orchestrator)      |
| `detectClusters`                                               | Louvain community detection      | move -> `ClusterDetection.ts`  |
| `buildEntityElkGraph`, `extractEntityPositions`                | pass 1: entity ELK graph         | move -> `EntityPlacement.ts`   |
| `buildEntityEdgeWeights`, `entityNodeDimensions`               | pass 1: edge weights, dimensions | move -> `EntityPlacement.ts`   |
| `layoutEntitiesWithClusters`, `buildClusterElkSubGraph`        | pass 1: two-level cluster layout | move -> `EntityPlacement.ts`   |
| `extractSubGraphPositions`, `adjustBoundaryEntities`           | pass 1: cluster compose + nudge  | move -> `EntityPlacement.ts`   |
| `buildConnectionCounts`, `placeSubtypesRadially`               | post-adjust: subtype fan         | move -> `PostAdjustments.ts`   |
| `alignLeafValueTypes`                                          | post-adjust: leaf alignment      | move -> `PostAdjustments.ts`   |
| `placeFactTypes`, `placeConstraintNodes`                       | pass 2: fact + constraint nodes  | move -> `FactTypePlacement.ts` |
| `routeRoleEdges`, `routeConstraintEdges`, `routeSubtypeEdges`  | edge routing                     | move -> `EdgeRouting.ts`       |
| `roleConnectionPoint`, `entityBorderPoint`, `*Intersection`    | routing geometry primitives      | move -> `EdgeRouting.ts`       |
| `entityCenter`, `roleCenter`, `computeBounds`                  | center helpers + viewBox bounds  | move -> `EdgeRouting.ts`       |
| `normalizeCoordinates`, `resolveOverlaps`, `effectiveBounding` | collision + normalization        | move -> `CollisionResolver.ts` |

`LayoutTypes.ts`, `theme.ts`, and `GraphTypes.ts` are unchanged -- the
extracted modules import the same types they import today. The shared
private interfaces travel with their only user: `ClusterLayout` to
`EntityPlacement.ts`, `BoundingBox` and `MutablePosition` to
`CollisionResolver.ts`.

## Target architecture

```
src/layout/
  LayoutTypes.ts          (unchanged) positioned-graph types
  ElkLayoutEngine.ts      orchestrator: layoutGraph + Position/Orientation
                          override types -- the only file index.ts imports
  ElkInterop.ts           getElk() singleton; CJS/ESM default-export quirk
  EntityPlacement.ts      pass 1: cluster-aware entity placement
                            -> imports ElkInterop, ClusterDetection
  ClusterDetection.ts     detectClusters() -- pure Louvain, no ELK
  PostAdjustments.ts      subtype radial fan + leaf value-type alignment
  FactTypePlacement.ts    pass 2: fact-type + constraint-node placement
  EdgeRouting.ts          role/constraint/subtype edge routing, border
                          intersection geometry, computeBounds
  CollisionResolver.ts    normalize + overlap resolution (pure)

import direction (acyclic):
  ElkLayoutEngine -> { EntityPlacement, PostAdjustments,
                       FactTypePlacement, EdgeRouting, CollisionResolver }
  EntityPlacement -> { ElkInterop, ClusterDetection }
  all leaf modules -> { LayoutTypes, GraphTypes, theme } only
```

## Workstreams (each independently shippable)

Every workstream is a single PR that keeps the full monorepo suite green
and changes nothing downstream. Ordered most-isolated first. The current
coverage floors hold throughout (coverage only rises); they are raised
once, last, against the final measured numbers.

### 1. Extract ElkInterop and ClusterDetection

Move `getElk` to `ElkInterop.ts` and the pure `detectClusters` to
`ClusterDetection.ts`. `EntityPlacement` does not exist yet, so for this
step `ElkLayoutEngine.ts` imports both directly. Add
`ClusterDetection.test.ts`: Louvain is a self-contained, ELK-free
function (singleton clusters for <= 4 nodes, the empty-weight fallback,
small-cluster merge, contiguous renumbering) that has no direct test
today. First because it is the most isolated unit and the clearest
coverage win.

### 2. Extract EdgeRouting and CollisionResolver

Move the routing functions, the border-intersection primitives,
`computeBounds`, and the overlap/normalization pass into their two
modules. Add `EdgeRouting.test.ts` (ray/rectangle and ray/ellipse
intersection, the role-connection-point convention for binary vs
ternary, empty-graph bounds fallback) and `CollisionResolver.test.ts`
(overlapping boxes separate along the minimum translation axis;
decoration-aware bounding boxes). Both are pure -- no ELK mock -- so
these are the highest-leverage tests for lifting the floor.

### 3. Extract the placement passes

Move pass 1 (`EntityPlacement.ts`, importing ElkInterop and
ClusterDetection), the post-adjust heuristics (`PostAdjustments.ts`),
and pass 2 (`FactTypePlacement.ts`). After this step
`ElkLayoutEngine.ts` is the `layoutGraph` orchestrator plus the two
override types. Update `ElkLayoutEngine.test.ts`: keep the integration
cases against `layoutGraph`, and move `buildEntityElkGraph`'s assertions
to import from `EntityPlacement.ts`. Add `PostAdjustments.test.ts`
(radial fan honors the connection-count gate; leaf alignment snaps the
perpendicular axis) where the unit is pure given entity positions.

### 4. Raise the coverage floors and refresh docs

With the focused tests landed, raise the `vitest.config.ts` thresholds
to the new measured coverage minus the standard v8 headroom, and drop
the "ElkLayoutEngine-capped" note. Update the `CLAUDE.md` package-layout
tree, the `ARCHITECTURE.md` `src/layout/` listing, and tick A1's
ElkLayoutEngine item in REPO_REVIEW. Small and mechanical; separated so
the floor change is reviewable on its own.

## API and migration impact

- No public export changes. `index.ts` and `DiagramGenerator.ts` import
  the same three symbols from `ElkLayoutEngine.ts` unchanged.
- Blast radius is internal to `@barwise/diagram/src/layout/`. The
  one-way dependency graph means cli, mcp, vscode, and diagram-ui
  rebuild against an unchanged surface. Run the full monorepo build +
  test after WS3 to confirm.
- The `@internal` test-only exports relocate: `detectClusters` ->
  `ClusterDetection.ts` (WS1), `buildEntityElkGraph` ->
  `EntityPlacement.ts` (WS3). Their test imports follow.

## Open decisions (for review)

- **`computeBounds` placement.** It computes the final viewBox from
  nodes and edges and is the last step of `layoutGraph`. Options: keep
  it in `EdgeRouting.ts` (recommended -- it consumes routed edges and is
  small) or give it a one-function `Bounds.ts`. Recommend folding it
  into `EdgeRouting.ts` to avoid a near-empty module.
- **Fold WS4 into WS3.** Raising the floors could land in the same PR as
  the last extraction. Recommend keeping it separate so the floor change
  is an isolated, reviewable diff, but it is a small call.

## Risks and testing

- Behavior must not change: identical positions, orientations, routing,
  and bounds. The existing `ElkLayoutEngine.test.ts` and
  `DiagramGenerator.test.ts` integration cases are the parity guard and
  stay green at every step; the new unit tests are additive.
- Each workstream is its own PR run through build, test:coverage, lint,
  knip, oxlint, circular (madge with `--extensions ts,tsx`), and
  `dprint check`. `circular` guards the acyclic import direction above.
- `knip` requires every new module's exports to have a consumer: the
  orchestrator (or `EntityPlacement`) imports each, and the new tests
  import the pure units, so no export is left dangling.
- End-to-end: `validate:examples` runs the built CLI's diagram path, so
  a real (un-mocked) ELK layout is exercised in CI after the refactor.

## Non-goals

- No new layout capability, ELK option, or notation change.
- No change to the public API, `LayoutTypes.ts`, or `DiagramGenerator`.
- No move of layout out of `@barwise/diagram`; it stays host-side for
  every front end (settled in the renderer-consolidation spec).
