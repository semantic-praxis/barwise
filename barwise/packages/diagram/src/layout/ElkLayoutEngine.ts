import type { OrmGraph } from "../graph/GraphTypes.js";
import { normalizeCoordinates, resolveOverlaps } from "./CollisionResolver.js";
import {
  computeBounds,
  routeConstraintEdges,
  routeRoleEdges,
  routeSubtypeEdges,
} from "./EdgeRouting.js";
import { layoutEntitiesWithClusters } from "./EntityPlacement.js";
import { placeConstraintNodes, placeFactTypes } from "./FactTypePlacement.js";
import type {
  OrientationOverrides,
  PositionedGraph,
  PositionedNode,
  PositionOverrides,
} from "./LayoutTypes.js";
import {
  alignLeafValueTypes,
  buildConnectionCounts,
  placeSubtypesRadially,
} from "./PostAdjustments.js";

// The position/orientation override types live in LayoutTypes; re-export
// them here so existing importers (index.ts, DiagramGenerator) are unchanged.
export type { OrientationOverrides, PositionOverrides } from "./LayoutTypes.js";

// ---------------------------------------------------------------------------
// Public entry point: two-pass entity-centric layout orchestrator
// ---------------------------------------------------------------------------

/**
 * Use a two-pass layout to produce an entity-centric ORM diagram.
 *
 * Pass 1: Position entity types using ELK stress algorithm.
 * Pass 2: Place fact types geometrically between their connected entities.
 *
 * If positionOverrides are provided, those entities are pinned at the
 * given coordinates after Pass 1 (overriding ELK's placement).
 */
export async function layoutGraph(
  graph: OrmGraph,
  positionOverrides?: PositionOverrides,
  orientationOverrides?: OrientationOverrides,
): Promise<PositionedGraph> {
  // Pass 1: entity placement with cluster-aware two-level layout.
  const entityPositions = await layoutEntitiesWithClusters(graph);

  // Apply any manual position overrides.  Overrides use center
  // coordinates so that items sharing the same y visually align
  // regardless of node height.  Convert to top-left here.
  if (positionOverrides) {
    for (const [nodeId, pos] of Object.entries(positionOverrides)) {
      const existing = entityPositions.get(nodeId);
      if (existing) {
        entityPositions.set(nodeId, {
          ...existing,
          x: pos.x - existing.width / 2,
          y: pos.y - existing.height / 2,
        });
      }
    }
  }

  const hasOverrides = positionOverrides && Object.keys(positionOverrides).length > 0;

  // Skip automatic adjustments when the user is manually positioning.
  if (!hasOverrides) {
    // Compute per-entity connection counts for subtype placement decisions.
    const connectionCounts = buildConnectionCounts(graph);

    // Post-adjust: radially place subtypes outward from diagram center.
    // Only applies to subtypes with fewer connections than their supertype.
    placeSubtypesRadially(entityPositions, graph.subtypeEdges, connectionCounts);

    // Post-adjust: align leaf value types with their connected entity.
    alignLeafValueTypes(graph, entityPositions);
  }

  // Pass 2: place fact types between their connected entities.
  const factTypePositions = placeFactTypes(
    graph,
    entityPositions,
    orientationOverrides,
    positionOverrides,
  );

  // Place constraint nodes near connected roles.
  const constraintPositions = placeConstraintNodes(graph, entityPositions, factTypePositions);

  // Skip collision resolution and normalization in manual mode -- the
  // user's positions are authoritative.
  if (!hasOverrides) {
    const allForOverlap: PositionedNode[] = [
      ...entityPositions.values(),
      ...factTypePositions.values(),
      ...constraintPositions.values(),
    ];
    resolveOverlaps(allForOverlap);
  }

  // Build positioned nodes array from the canonical maps.
  const positionedNodes: PositionedNode[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "object_type") {
      const pos = entityPositions.get(node.id);
      if (pos) positionedNodes.push(pos);
    } else if (node.kind === "fact_type") {
      const pos = factTypePositions.get(node.id);
      if (pos) positionedNodes.push(pos);
    } else {
      const pos = constraintPositions.get(node.id);
      if (pos) positionedNodes.push(pos);
    }
  }

  // Normalize only in automatic mode. In override mode the user's
  // positions are authoritative -- normalization would shift them and
  // cause drift between renders. The viewBox origin handles any
  // negative or far-off coordinates instead.
  if (!hasOverrides) {
    normalizeCoordinates(positionedNodes);
  }

  // Route edges (after normalization so edge points are correct).
  const positionedEdges = routeRoleEdges(graph, entityPositions, factTypePositions);
  const positionedConstraintEdges = routeConstraintEdges(
    graph,
    constraintPositions,
    factTypePositions,
  );
  const positionedSubtypeEdges = routeSubtypeEdges(graph, entityPositions);

  // Compute bounding box (includes origin for viewBox positioning).
  const bounds = computeBounds(positionedNodes, positionedEdges, positionedSubtypeEdges);

  return {
    nodes: positionedNodes,
    edges: positionedEdges,
    constraintEdges: positionedConstraintEdges,
    subtypeEdges: positionedSubtypeEdges,
    originX: bounds.originX,
    originY: bounds.originY,
    width: bounds.width,
    height: bounds.height,
  };
}
