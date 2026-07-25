# Diagram layout overhaul: entity-centric ORM layout

Status: Implemented -- two-pass entity-centric engine under
packages/diagram/src/layout/ (EntityPlacement via ELK stress,
FactTypePlacement, cluster/collision/edge-routing passes).
Created: 2026-04-05
Last-updated: 2026-07-25

## Problem

The current diagram layout engine produces wide, flat horizontal strips
because ELK's layered algorithm treats entity types and fact types as
nodes in separate layers. A model with 12 entity types renders as
1833x328px -- a strip that is nearly impossible to read.

Real ORM diagrams (NORMA, Boston) place entity types as spatial anchors
in 2D and position fact types _between_ their connected entities, on the
edges. The layout uses space in both dimensions, producing compact,
readable diagrams.

Reference screenshots (in `barwise/docs/screenshots/`):

- `ormsolutions-auction.png` -- NORMA binary fact types between entities
- `ormsolutions-ternary.png` -- NORMA ternary fact type with edges fanning out
- `boston-unary.png` -- Boston unary fact type as stub off entity
- `binary-horiz-vert.png` -- horizontal and vertical role box orientations
- `sub-super.png` -- subtype hierarchy with exclusion constraint
- `type-hierarchies.png` -- wide subtype fan (6 subtypes in arc)
- `consignment-asset.png` -- hub entity with many spokes, inter-spoke constraints
- `intake.png` -- two fact types between same pair with exclusion; join subset across 3 entities
- `presale.png` -- ternary fact type (vertical), hub entity (Deal), value constraints

## Goals

1. Produce NORMA-style 2D layouts where entity types are spatial anchors
   and fact types sit between their connected entities.
2. Support horizontal and vertical fact type orientation based on entity
   arrangement.
3. Handle all arity cases: unary, binary, ternary+, reflexive.
4. Enforce top-to-bottom subtype hierarchy ordering.
5. Arrange subtype fans in arcs, not rows.
6. Position external constraints near the roles they connect, with
   special handling for join constraints and hub spoke constraints.
7. Preserve the existing pipeline API (`generateDiagram()` unchanged).

## Non-goals

- Interactive diagram editing (click-to-move, drag-and-drop).
- Verbalization tooltips on selection (tracked as future work).
- Orthogonal edge routing (straight lines are sufficient for v1).

## Design Principles

1. **Entity types are the primary spatial anchors.** They are positioned
   first using a 2D force/stress algorithm.
2. **Fact types are positioned geometrically between their connected
   entities**, not as independent graph nodes.
3. **Role box strips can be horizontal or vertical**, chosen based on
   the angle between connected entities.
4. **Subtype hierarchies flow top-to-bottom** -- supertypes above subtypes.
5. **The pipeline structure is preserved**: `OrmGraph -> PositionedGraph -> SVG`.

## Layout Algorithm: Two-Pass with ELK Stress

### Pass 1: Entity Placement

Build an ELK graph containing ONLY entity type nodes. Derive synthetic
edges from fact types (two entities sharing a fact type get an edge).
Use ELK `stress` algorithm for 2D placement.

ELK configuration:

```
algorithm: "stress"
stress.desiredEdgeLength: "200"
spacing.nodeNode: "120"
padding: "[top=60,left=60,bottom=60,right=60]"
stress.epsilon: "0.001"
stress.iterationLimit: "300"
```

Edge weights:

- Binary fact type between two entities: weight 1
- Multiple fact types between same pair: additive (4 fact types -> weight 4)
- Ternary fact type: weight 0.5 per entity pair
- Subtype edges: weight 1

**Subtype vertical ordering**: After stress layout, post-adjust entity
positions to ensure supertypes are above their subtypes. For each
subtype relationship, if the supertype's y >= subtype's y, swap their
y-coordinates (with padding). This preserves the horizontal spread from
stress while enforcing the top-to-bottom hierarchy.

**Subtype fan arrangement**: When a supertype has multiple subtypes (e.g.,
Service with 6 subtypes in type-hierarchies.png), arrange the subtypes
in a single arc below the supertype, not in rows. The arc is centered
horizontally under the supertype. For N subtypes, spread them evenly
across an angular range (e.g., 120-180 degrees) at a fixed radius from
the supertype center. The exclusive-or or exclusion constraint node sits
at the center of the arc between the subtype arrows.

### Pass 2: Fact Type Placement

For each fact type, position based on arity:

**Unary (1 role):**

- Single role box on a short stub off the entity
- Placed on the side with the most available space
- Stub length: ~20px gap from entity border

**Binary (2 roles):**

- Role box strip centered at the midpoint between two entity centers
- Orientation: if `|dx| >= |dy|` -> horizontal, else -> vertical

**Ternary+ (3+ roles):**

- Role box strip at the centroid of connected entity centers
- Orientation (horizontal or vertical) chosen based on the bounding box
  of connected entity centers: if wider than tall -> horizontal, else vertical
- Edges fan out from individual role ports to their connected entities

**Reflexive (both roles same entity):**

- Role box strip adjacent to entity, offset to one side
- Default vertical, both edges curve back to same entity

**Multiple fact types between same entity pair:**

- Stack perpendicular to the connection axis
- Gap of `ROLE_BOX_HEIGHT + 8px` between each strip
- Centered symmetrically around the midpoint

### Collision Resolution

After initial placement:

1. Build bounding boxes for all nodes (entities + fact types + constraints)
   including space for uniqueness bars, mandatory dots, labels
2. Sort by x-coordinate, sweep for overlaps
3. Compute minimum translation vector (MTV) for each overlap
4. Apply half MTV to each node in the pair
5. Up to 3 iterations

### Constraint Node Placement

External constraint nodes (exclusion, subset, equality, etc.):

**Simple constraints (roles on one or two fact types between same pair):**

- Position at centroid of connected role boxes
- Offset ~30px perpendicular to the line connecting first two roles
- Example: exclusion between "includes mandatory-" and "includes optional-"
  between Service and Offering (intake.png)

**Subtype partition constraints:**

- Centered in the arc/fan between subtype arrows
- Example: exclusive-or at center of Service's 6-subtype fan (type-hierarchies.png)
- Example: exclusive-or between GroupItem/SimpleItem arrows (sub-super.png)

**Join constraints (roles across 3+ fact types between different entity pairs):**

- Position at centroid of the _entity types_ involved, not just the role boxes
- Example: subset constraint between ConsignmentAsset/Auction/Channel
  (intake.png) -- constraint sits in the triangle formed by the three entities
- Dashed lines radiate from constraint node to roles on each connected fact type

**Hub entity spoke constraints (constraints between fact types radiating from one entity):**

- Position near the hub entity, between the connected spokes
- Example: Classification with 4 fact types to Category/Industry/Make/Model
  (consignment-asset.png) -- subset and exclusive-or constraints sit between
  the vertical fact type strips below Classification

### Edge Routing

Computed after all nodes are positioned:

- **Entity-to-role edges**: straight line from entity border intersection
  to role box center. Border intersection computed by ray-casting from
  entity center through role box center to the entity's bounding shape
  (rounded rect for entities, ellipse for value types).
- **Constraint edges**: straight line from constraint border to role center
- **Subtype edges**: straight line between entity borders
- **Reflexive edges**: quadratic bezier curves with control points offset
  perpendicular to the entity-facttype direction

## Hub Entity Pattern

When one entity type participates in many fact types (e.g., Deal in
presale.png, Classification in consignment-asset.png), the connected
entities radiate outward in multiple directions. The layout should:

- Position the hub entity centrally
- Distribute connected entities around it, using the stress algorithm's
  natural tendency to place highly-connected nodes centrally
- Fact types radiate outward at various angles, each choosing horizontal
  or vertical orientation based on the angle to its connected entity
- Inter-spoke constraints sit between adjacent spokes

The stress algorithm handles this naturally -- high-degree nodes get
pulled toward the center by their many edges. No special-case logic
is needed beyond the standard placement algorithm.

## Fact Type Orientation

Role box strips support two orientations:

**Horizontal** (current behavior):

- Roles: left-to-right at `x = i * ROLE_BOX_WIDTH, y = 0`
- Uniqueness bars: above role boxes
- Mandatory dots: below role boxes
- Spanning uniqueness: horizontal bar above all roles
- Reading label: below the strip

**Vertical** (new):

- Roles: top-to-bottom at `x = 0, y = i * ROLE_BOX_WIDTH`
- Uniqueness bars: on left or right side of role boxes
- Mandatory dots: on the opposite side from uniqueness bars
- Spanning uniqueness: vertical bar along the side
- Reading label: beside the strip
- Overall dimensions swap: `width = ROLE_BOX_HEIGHT, height = roles.length * ROLE_BOX_WIDTH`

The layout engine sets `orientation` on each `PositionedFactTypeNode`.
The renderer uses this to position constraint markers and labels.

## Files Changed

### `packages/diagram/src/layout/LayoutTypes.ts`

- Add `FactTypeOrientation = "horizontal" | "vertical"` type
- Add `orientation: FactTypeOrientation` to `PositionedFactTypeNode`

### `packages/diagram/src/layout/ElkLayoutEngine.ts` (major rewrite)

New internal functions:

- `buildEntityElkGraph(graph)` -- entity-only ELK graph with stress config
- `extractEntityPositions(graph, laid)` -- read ELK output
- `enforceSubtypeOrdering(entityPositions, subtypeEdges)` -- post-adjust y
- `placeFactTypes(graph, entityPositions)` -- geometric placement + orientation
- `placeConstraintNodes(graph, entityPositions, factTypePositions)` -- centroid of roles
- `resolveOverlaps(allNodes)` -- sweep-and-nudge
- `routeEdges(graph, allNodes)` -- border intersection math
- `computeBounds(allNodes, allEdges)` -- bounding box + padding

Remove: `sortNodesByConnectivity` (stress does not need input ordering hints)
Remove: `buildElkGraph` (replaced by `buildEntityElkGraph`)
Keep: `getElk()` singleton pattern

### `packages/diagram/src/render/SvgRenderer.ts`

- `renderFactType`: add orientation-aware positioning for:
  - Uniqueness bars (side instead of above when vertical)
  - Mandatory dots (side instead of below when vertical)
  - Spanning uniqueness bar (vertical bar on side)
  - Label placement (beside instead of below)
- Extract coordinate helpers: `getUniquenessBarRect()`, `getMandatoryDotPosition()`,
  `getSpanningBarRect()`, `getLabelPosition()` -- each takes orientation param

### `packages/diagram/src/render/theme.ts`

Add constants:

- `FACT_TYPE_STACK_GAP = 8` -- gap between stacked fact types
- `UNARY_STUB_LENGTH = 20` -- gap from entity border to unary role box
- `FACT_TYPE_COLLISION_PADDING = 4` -- bounding box padding for collision

### `packages/diagram/src/graph/GraphTypes.ts`

No changes. Orientation is a layout concern, not a graph concern.

### `packages/diagram/src/graph/ModelToGraph.ts`

No changes. Model-to-graph conversion is unaffected.

### `packages/diagram/src/DiagramGenerator.ts`

No changes. Pipeline orchestration unchanged.

### `packages/diagram/src/index.ts`

Export `FactTypeOrientation` type.

## Test Plan

### Layout engine tests (`ElkLayoutEngine.test.ts`)

- Binary fact type positioned at midpoint between two entities
- Vertical orientation when entities are vertically aligned
- Horizontal orientation when entities are horizontally aligned
- Multiple binary fact types between same pair are stacked
- Ternary fact type at centroid of three entities
- Unary fact type adjacent to its entity
- Reflexive fact type adjacent to its entity
- Subtype: supertype above subtype (y ordering)
- Subtype fan: N subtypes arranged in arc below supertype
- Subtype partition constraint centered in arc
- Hub entity: high-degree entity positioned centrally
- Join constraint across 3 entities positioned at entity centroid
- Spoke constraints between adjacent fact types from same hub
- Collision resolution separates overlapping nodes
- Edge routing: entity border intersection for rounded rects
- Edge routing: entity border intersection for ellipses (value types)

### Renderer tests (`SvgRenderer.test.ts`)

- Existing tests updated with `orientation: "horizontal"` field
- Vertical orientation: role boxes rendered at vertical positions
- Vertical orientation: uniqueness bars on side
- Vertical orientation: mandatory dots on side
- Vertical orientation: spanning bar vertical
- Vertical orientation: label beside strip

### Integration tests (`DiagramGenerator.test.ts`)

- Existing tests pass (public API unchanged)
- New: model with 8+ entities produces `width/height < 3` (not flat strip)
- New: binary fact type x-coordinate between its two entities

### ModelToGraph tests (`ModelToGraph.test.ts`)

No changes needed.

## Future Work (out of scope for this change)

- **Verbalization on selection**: NORMA/Boston show verbalizations when
  an object or fact type is selected on the diagram. For the VS Code
  webview, this could be implemented as a click handler that displays
  verbalizations in a tooltip or side panel. Requires interactive SVG
  (click events on data-id attributes) and integration with the
  verbalization engine from @barwise/core.

## Verification

1. `cd packages/diagram && npx vitest run` -- all tests pass
2. `cd packages/diagram && npx tsc --noEmit` -- type-check passes
3. `npm run build` -- full monorepo build passes
4. `npm run test` -- all 1,964 tests pass across all packages
5. Visual verification: generate SVG for clinic-appointments model and
   auction model, confirm 2D layout with fact types between entities
6. VS Code extension: open .orm.yaml, run diagram command, verify webview
