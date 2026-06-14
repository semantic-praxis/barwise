import type { ElkExtendedEdge, ElkNode } from "elkjs";
import type { ConstraintNode, FactTypeNode, OrmGraph } from "../graph/GraphTypes.js";
import {
  CONSTRAINT_RADIUS,
  FACT_TYPE_STACK_GAP,
  FONT_SIZE_ALIAS,
  MANDATORY_DOT_RADIUS,
  OBJECTIFICATION_PADDING,
  OT_ALIAS_LINE_HEIGHT,
  OT_HEIGHT,
  OT_MIN_WIDTH,
  ROLE_BOX_HEIGHT,
  ROLE_BOX_WIDTH,
  UNARY_STUB_LENGTH,
  UNIQUENESS_BAR_HEIGHT,
  UNIQUENESS_BAR_OFFSET,
} from "../render/theme.js";
import { detectClusters } from "./ClusterDetection.js";
import { getElk } from "./ElkInterop.js";
import type {
  FactTypeOrientation,
  Position,
  PositionedConstraintEdge,
  PositionedConstraintNode,
  PositionedEdge,
  PositionedFactTypeNode,
  PositionedGraph,
  PositionedNode,
  PositionedObjectTypeNode,
  PositionedRoleBox,
  PositionedSubtypeEdge,
} from "./LayoutTypes.js";

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Optional position overrides for entity nodes.
 * Keys are entity node IDs, values are {x, y} positions.
 * When provided, the layout engine uses these positions instead of
 * computing them via ELK, then re-runs fact type placement and edge
 * routing around the fixed positions.
 */
export interface PositionOverrides {
  readonly [nodeId: string]: { readonly x: number; readonly y: number; };
}

/**
 * Manual orientation overrides for fact type nodes.
 * Keys are fact type node IDs, values are the desired orientation.
 */
export interface OrientationOverrides {
  readonly [factTypeId: string]: "horizontal" | "vertical";
}

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

// ---------------------------------------------------------------------------
// Pass 1: Entity-only ELK graph with stress algorithm
// ---------------------------------------------------------------------------

/** @internal Exported for testing. */
export function buildEntityElkGraph(graph: OrmGraph): ElkNode {
  const children: ElkNode[] = [];

  // Collect entity type node IDs.
  const entityIds = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "object_type") {
      entityIds.add(node.id);
      children.push({ id: node.id, ...entityNodeDimensions(node) });
    }
  }

  const edgeWeights = buildEntityEdgeWeights(graph, entityIds);

  const edges: ElkExtendedEdge[] = [];
  let edgeId = 0;
  for (const [key] of edgeWeights) {
    const parts = key.split("--");
    edges.push({
      id: `synth-${edgeId++}`,
      sources: [parts[0]!],
      targets: [parts[1]!],
    });
  }

  return {
    id: "root",
    layoutOptions: {
      "org.eclipse.elk.algorithm": "stress",
      "org.eclipse.elk.stress.desiredEdgeLength": "450",
      "org.eclipse.elk.spacing.nodeNode": "300",
      "org.eclipse.elk.padding": "[top=60,left=60,bottom=60,right=60]",
      "org.eclipse.elk.stress.epsilon": "0.001",
      "org.eclipse.elk.stress.iterationLimit": "300",
    },
    children,
    edges,
  };
}

function extractEntityPositions(
  graph: OrmGraph,
  laid: ElkNode,
): Map<string, PositionedObjectTypeNode> {
  const nodeMap = new Map<string, ElkNode>();
  for (const child of laid.children ?? []) {
    nodeMap.set(child.id, child);
  }

  const positions = new Map<string, PositionedObjectTypeNode>();
  for (const node of graph.nodes) {
    if (node.kind !== "object_type") continue;
    const elkNode = nodeMap.get(node.id);
    positions.set(node.id, {
      kind: "object_type",
      id: node.id,
      name: node.name,
      objectTypeKind: node.objectTypeKind,
      referenceMode: node.referenceMode,
      aliases: node.aliases,
      annotations: node.annotations,
      x: elkNode?.x ?? 0,
      y: elkNode?.y ?? 0,
      width: elkNode?.width ?? OT_MIN_WIDTH,
      height: elkNode?.height ?? OT_HEIGHT,
    });
  }
  return positions;
}

// ---------------------------------------------------------------------------
// Entity edge weights (shared by single-level and cluster layouts)
// ---------------------------------------------------------------------------

/**
 * Compute a map of edge weights between entity pairs, derived from
 * shared fact types and subtype relationships.
 */
function buildEntityEdgeWeights(
  graph: OrmGraph,
  entityIds: Set<string>,
): Map<string, number> {
  const edgeWeights = new Map<string, number>();

  for (const node of graph.nodes) {
    if (node.kind !== "fact_type") continue;
    const ft = node as FactTypeNode;
    const playerIds = [...new Set(ft.roles.map((r) => r.playerId))].filter(
      (id) => entityIds.has(id),
    );
    const weight = playerIds.length <= 2 ? 1 : 0.5;
    for (let i = 0; i < playerIds.length; i++) {
      for (let j = i + 1; j < playerIds.length; j++) {
        const key = [playerIds[i], playerIds[j]].sort().join("--");
        edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + weight);
      }
    }
  }

  for (const se of graph.subtypeEdges) {
    if (!entityIds.has(se.subtypeNodeId) || !entityIds.has(se.supertypeNodeId)) continue;
    const key = [se.subtypeNodeId, se.supertypeNodeId].sort().join("--");
    edgeWeights.set(key, (edgeWeights.get(key) ?? 0) + 1);
  }

  return edgeWeights;
}

/**
 * Count the number of fact-type connections each entity participates in.
 * Used to decide whether a subtype is a "leaf" (few connections) or a
 * hub (many connections) relative to its supertype.
 */
function buildConnectionCounts(graph: OrmGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind === "fact_type") {
      const ft = node as FactTypeNode;
      const seen = new Set<string>();
      for (const role of ft.roles) {
        if (!seen.has(role.playerId)) {
          seen.add(role.playerId);
          counts.set(role.playerId, (counts.get(role.playerId) ?? 0) + 1);
        }
      }
    }
  }
  return counts;
}

/**
 * Compute the ELK node dimensions for an object type based on its
 * name, aliases, and reference mode text width.
 */
function entityNodeDimensions(
  node: { name: string; aliases?: readonly string[]; },
): { width: number; height: number; } {
  let labelWidth = Math.max(OT_MIN_WIDTH, node.name.length * 9 + 40);
  const hasAliases = node.aliases !== undefined && node.aliases.length > 0;
  if (hasAliases) {
    const aliasText = `(a.k.a. ${node.aliases!.map((a) => `'${a}'`).join(", ")})`;
    const aliasWidth = aliasText.length * FONT_SIZE_ALIAS * 0.6 + 40;
    labelWidth = Math.max(labelWidth, aliasWidth);
  }
  const height = hasAliases ? OT_HEIGHT + OT_ALIAS_LINE_HEIGHT : OT_HEIGHT;
  return { width: labelWidth, height };
}

// ---------------------------------------------------------------------------
// Two-level cluster-aware entity layout
// ---------------------------------------------------------------------------

interface ClusterLayout {
  clusterId: number;
  positions: Map<string, PositionedObjectTypeNode>;
  width: number;
  height: number;
}

/**
 * Layout entities using cluster detection and two-level ELK stress.
 *
 * If meaningful clusters are detected, each cluster is laid out
 * independently and then clusters are positioned relative to each other.
 * Boundary entities (those with inter-cluster connections) are nudged
 * toward the neighboring cluster for cleaner bridging.
 */
async function layoutEntitiesWithClusters(
  graph: OrmGraph,
): Promise<Map<string, PositionedObjectTypeNode>> {
  const entityIds: string[] = [];
  for (const node of graph.nodes) {
    if (node.kind === "object_type") entityIds.push(node.id);
  }

  if (entityIds.length === 0) return new Map();

  const edgeWeights = buildEntityEdgeWeights(graph, new Set(entityIds));
  const clusterMap = detectClusters(entityIds, edgeWeights);

  // Group by cluster.
  const clusterMemberMap = new Map<number, string[]>();
  for (const [id, cluster] of clusterMap) {
    let arr = clusterMemberMap.get(cluster);
    if (!arr) {
      arr = [];
      clusterMemberMap.set(cluster, arr);
    }
    arr.push(id);
  }

  // If only one cluster, use single-level layout.
  if (clusterMemberMap.size <= 1) {
    const elkGraph = buildEntityElkGraph(graph);
    const laid = await getElk().layout(elkGraph);
    return extractEntityPositions(graph, laid);
  }

  // Level 1: layout each cluster independently.
  const clusterLayouts: ClusterLayout[] = [];
  for (const [clusterId, members] of clusterMemberMap) {
    const subElk = buildClusterElkSubGraph(graph, members, edgeWeights);
    const laid = await getElk().layout(subElk);
    const positions = extractSubGraphPositions(graph, laid);

    let maxX = 0;
    let maxY = 0;
    for (const pos of positions.values()) {
      maxX = Math.max(maxX, pos.x + pos.width);
      maxY = Math.max(maxY, pos.y + pos.height);
    }

    clusterLayouts.push({
      clusterId,
      positions,
      width: maxX + 60,
      height: maxY + 60,
    });
  }

  // Level 2: layout clusters relative to each other.
  const interClusterEdges: { source: number; target: number; }[] = [];
  const seenPairs = new Set<string>();
  for (const [key] of edgeWeights) {
    const parts = key.split("--");
    const ca = clusterMap.get(parts[0]!);
    const cb = clusterMap.get(parts[1]!);
    if (ca !== undefined && cb !== undefined && ca !== cb) {
      const ck = `${Math.min(ca, cb)}--${Math.max(ca, cb)}`;
      if (!seenPairs.has(ck)) {
        seenPairs.add(ck);
        interClusterEdges.push({ source: ca, target: cb });
      }
    }
  }

  const clusterElk: ElkNode = {
    id: "root",
    layoutOptions: {
      "org.eclipse.elk.algorithm": "stress",
      "org.eclipse.elk.stress.desiredEdgeLength": "600",
      "org.eclipse.elk.spacing.nodeNode": "250",
      "org.eclipse.elk.padding": "[top=60,left=60,bottom=60,right=60]",
      "org.eclipse.elk.stress.iterationLimit": "300",
    },
    children: clusterLayouts.map((cl) => ({
      id: `cluster-${cl.clusterId}`,
      width: cl.width,
      height: cl.height,
    })),
    edges: interClusterEdges.map((e, i) => ({
      id: `ice-${i}`,
      sources: [`cluster-${e.source}`],
      targets: [`cluster-${e.target}`],
    })),
  };

  const clusterLaid = await getElk().layout(clusterElk);

  // Compose: shift each cluster's internal positions by cluster-level offset.
  const result = new Map<string, PositionedObjectTypeNode>();
  for (const child of clusterLaid.children ?? []) {
    const clusterId = parseInt(child.id.replace("cluster-", ""));
    const cl = clusterLayouts.find((c) => c.clusterId === clusterId);
    if (!cl) continue;

    const offsetX = child.x ?? 0;
    const offsetY = child.y ?? 0;

    for (const [entityId, pos] of cl.positions) {
      result.set(entityId, {
        ...pos,
        x: pos.x + offsetX,
        y: pos.y + offsetY,
      });
    }
  }

  // Nudge boundary entities toward their inter-cluster neighbors.
  adjustBoundaryEntities(result, clusterMap, edgeWeights, clusterMemberMap);

  return result;
}

function buildClusterElkSubGraph(
  graph: OrmGraph,
  memberIds: string[],
  edgeWeights: Map<string, number>,
): ElkNode {
  const memberSet = new Set(memberIds);
  const children: ElkNode[] = [];

  for (const node of graph.nodes) {
    if (node.kind !== "object_type" || !memberSet.has(node.id)) continue;
    children.push({ id: node.id, ...entityNodeDimensions(node) });
  }

  const edges: ElkExtendedEdge[] = [];
  let edgeId = 0;
  for (const [key] of edgeWeights) {
    const parts = key.split("--");
    if (memberSet.has(parts[0]!) && memberSet.has(parts[1]!)) {
      edges.push({
        id: `e-${edgeId++}`,
        sources: [parts[0]!],
        targets: [parts[1]!],
      });
    }
  }

  return {
    id: "cluster",
    layoutOptions: {
      "org.eclipse.elk.algorithm": "stress",
      "org.eclipse.elk.stress.desiredEdgeLength": "350",
      "org.eclipse.elk.spacing.nodeNode": "200",
      "org.eclipse.elk.padding": "[top=30,left=30,bottom=30,right=30]",
      "org.eclipse.elk.stress.epsilon": "0.001",
      "org.eclipse.elk.stress.iterationLimit": "300",
    },
    children,
    edges,
  };
}

/**
 * Extract entity positions from a sub-graph ELK layout, only including
 * entities that were actually placed by ELK (ignoring others).
 */
function extractSubGraphPositions(
  graph: OrmGraph,
  laid: ElkNode,
): Map<string, PositionedObjectTypeNode> {
  const nodeMap = new Map<string, ElkNode>();
  for (const child of laid.children ?? []) {
    nodeMap.set(child.id, child);
  }

  const positions = new Map<string, PositionedObjectTypeNode>();
  for (const node of graph.nodes) {
    if (node.kind !== "object_type") continue;
    const elkNode = nodeMap.get(node.id);
    if (!elkNode) continue;

    positions.set(node.id, {
      kind: "object_type",
      id: node.id,
      name: node.name,
      objectTypeKind: node.objectTypeKind,
      referenceMode: node.referenceMode,
      aliases: node.aliases,
      annotations: node.annotations,
      x: elkNode.x ?? 0,
      y: elkNode.y ?? 0,
      width: elkNode.width ?? OT_MIN_WIDTH,
      height: elkNode.height ?? OT_HEIGHT,
    });
  }
  return positions;
}

/**
 * Nudge boundary entities (those with inter-cluster connections)
 * toward the neighboring cluster for cleaner bridging fact types.
 */
function adjustBoundaryEntities(
  positions: Map<string, PositionedObjectTypeNode>,
  clusterMap: Map<string, number>,
  edgeWeights: Map<string, number>,
  clusterMembers: Map<number, string[]>,
): void {
  // Compute cluster centroids.
  const centroids = new Map<number, Position>();
  for (const [clusterId, members] of clusterMembers) {
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const id of members) {
      const pos = positions.get(id);
      if (!pos) continue;
      sumX += pos.x + pos.width / 2;
      sumY += pos.y + pos.height / 2;
      count++;
    }
    if (count > 0) {
      centroids.set(clusterId, { x: sumX / count, y: sumY / count });
    }
  }

  const nudged = new Set<string>();
  const NUDGE_DISTANCE = 40;

  for (const [key] of edgeWeights) {
    const parts = key.split("--");
    const a = parts[0]!;
    const b = parts[1]!;
    const ca = clusterMap.get(a);
    const cb = clusterMap.get(b);
    if (ca === undefined || cb === undefined || ca === cb) continue;

    for (
      const [entityId, ownCluster, targetCluster] of [
        [a, ca, cb],
        [b, cb, ca],
      ] as [string, number, number][]
    ) {
      if (nudged.has(entityId)) continue;
      nudged.add(entityId);

      const pos = positions.get(entityId);
      if (!pos) continue;

      const ownCentroid = centroids.get(ownCluster);
      const targetCentroid = centroids.get(targetCluster);
      if (!ownCentroid || !targetCentroid) continue;

      const dx = targetCentroid.x - ownCentroid.x;
      const dy = targetCentroid.y - ownCentroid.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < 1) continue;

      positions.set(entityId, {
        ...pos,
        x: pos.x + (dx / dist) * NUDGE_DISTANCE,
        y: pos.y + (dy / dist) * NUDGE_DISTANCE,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Subtype ordering and fan arrangement
// ---------------------------------------------------------------------------

interface MutablePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Place subtypes radially outward from the diagram centroid.
 *
 * Only applies to "leaf-like" subtypes that have fewer or equal
 * connections than their supertype. When a subtype is itself a hub
 * (more connections than its supertype), ELK's stress-based placement
 * is likely better and we leave it alone.
 *
 * For applicable subtypes, the fan direction is determined by the
 * vector from the diagram center through the supertype's position.
 * A single subtype is placed directly along the outward vector.
 * Multiple subtypes are arranged in an arc perpendicular to it.
 */
function placeSubtypesRadially(
  entityPositions: Map<string, PositionedObjectTypeNode>,
  subtypeEdges: readonly { subtypeNodeId: string; supertypeNodeId: string; }[],
  connectionCounts: Map<string, number>,
): void {
  if (subtypeEdges.length === 0) return;

  // Compute diagram centroid from all entity positions.
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const pos of entityPositions.values()) {
    sumX += pos.x + pos.width / 2;
    sumY += pos.y + pos.height / 2;
    count++;
  }
  if (count === 0) return;
  const centerX = sumX / count;
  const centerY = sumY / count;

  // Group subtypes by supertype, filtering out well-connected subtypes.
  const fanMap = new Map<string, string[]>();
  for (const se of subtypeEdges) {
    const superConns = connectionCounts.get(se.supertypeNodeId) ?? 0;
    const subConns = connectionCounts.get(se.subtypeNodeId) ?? 0;

    // Skip subtypes that are more connected than their supertype.
    if (subConns > superConns) continue;

    let arr = fanMap.get(se.supertypeNodeId);
    if (!arr) {
      arr = [];
      fanMap.set(se.supertypeNodeId, arr);
    }
    arr.push(se.subtypeNodeId);
  }

  const ARC_RADIUS = 180;
  const ARC_ANGLE_RANGE = Math.PI * 0.75; // 135 degrees

  for (const [supertypeId, subtypeIds] of fanMap) {
    const superPos = entityPositions.get(supertypeId);
    if (!superPos) continue;

    const superCx = superPos.x + superPos.width / 2;
    const superCy = superPos.y + superPos.height / 2;

    // Outward direction: from diagram center through supertype.
    let outDx = superCx - centerX;
    let outDy = superCy - centerY;
    const outDist = Math.sqrt(outDx * outDx + outDy * outDy);

    if (outDist < 1) {
      // Supertype is at the center; default to downward.
      outDx = 0;
      outDy = 1;
    } else {
      outDx /= outDist;
      outDy /= outDist;
    }

    // The outward angle (0 = right, PI/2 = down).
    const outwardAngle = Math.atan2(outDy, outDx);

    const n = subtypeIds.length;

    if (n === 1) {
      // Single subtype: place directly along the outward vector.
      const subPos = entityPositions.get(subtypeIds[0]!);
      if (!subPos) continue;

      entityPositions.set(subtypeIds[0]!, {
        ...subPos,
        x: superCx + outDx * ARC_RADIUS - subPos.width / 2,
        y: superCy + outDy * ARC_RADIUS - subPos.height / 2,
      });
    } else {
      // Multiple subtypes: fan in an arc centered on the outward vector.
      const startAngle = outwardAngle - ARC_ANGLE_RANGE / 2;
      const angleStep = ARC_ANGLE_RANGE / (n - 1);

      for (let i = 0; i < n; i++) {
        const subPos = entityPositions.get(subtypeIds[i]!);
        if (!subPos) continue;

        const angle = startAngle + i * angleStep;
        const cx = superCx + ARC_RADIUS * Math.cos(angle);
        const cy = superCy + ARC_RADIUS * Math.sin(angle);

        entityPositions.set(subtypeIds[i]!, {
          ...subPos,
          x: cx - subPos.width / 2,
          y: cy - subPos.height / 2,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Leaf value type alignment
// ---------------------------------------------------------------------------

/**
 * Identify value types that participate in exactly one binary fact type
 * ("leaf attributes") and align them horizontally or vertically with
 * their connected entity, so the connection is a clean straight line.
 */
function alignLeafValueTypes(
  graph: OrmGraph,
  entityPositions: Map<string, PositionedObjectTypeNode>,
): void {
  // Count how many fact types each entity participates in.
  const factTypeCount = new Map<string, number>();
  for (const node of graph.nodes) {
    if (node.kind !== "fact_type") continue;
    const ft = node as FactTypeNode;
    for (const role of ft.roles) {
      factTypeCount.set(role.playerId, (factTypeCount.get(role.playerId) ?? 0) + 1);
    }
  }

  // Group leaf value types by their connected (hub) entity.
  const hubLeaves = new Map<string, { leafId: string; hubId: string; }[]>();

  for (const node of graph.nodes) {
    if (node.kind !== "fact_type") continue;
    const ft = node as FactTypeNode;
    const playerIds = [...new Set(ft.roles.map((r) => r.playerId))];
    if (playerIds.length !== 2) continue;

    for (const playerId of playerIds) {
      const entityPos = entityPositions.get(playerId);
      if (!entityPos) continue;
      if (entityPos.objectTypeKind !== "value") continue;
      if ((factTypeCount.get(playerId) ?? 0) > 1) continue;

      const otherId = playerIds.find((id) => id !== playerId);
      if (!otherId) continue;
      if (!entityPositions.has(otherId)) continue;

      let leaves = hubLeaves.get(otherId);
      if (!leaves) {
        leaves = [];
        hubLeaves.set(otherId, leaves);
      }
      leaves.push({ leafId: playerId, hubId: otherId });
    }
  }

  // For each hub entity, distribute its leaf value types around it.
  const SPOKE_DISTANCE = 200;

  for (const [hubId, leaves] of hubLeaves) {
    const hubPos = entityPositions.get(hubId);
    if (!hubPos) continue;

    const hubCx = hubPos.x + hubPos.width / 2;
    const hubCy = hubPos.y + hubPos.height / 2;

    if (leaves.length === 1) {
      // Single leaf: keep it on whichever side it already is, just
      // align the perpendicular axis.
      const leaf = leaves[0]!;
      const leafPos = entityPositions.get(leaf.leafId);
      if (!leafPos) continue;

      const leafCx = leafPos.x + leafPos.width / 2;
      const leafCy = leafPos.y + leafPos.height / 2;
      const dx = Math.abs(leafCx - hubCx);
      const dy = Math.abs(leafCy - hubCy);

      if (dx >= dy) {
        // Primarily horizontal: snap y.
        entityPositions.set(leaf.leafId, {
          ...leafPos,
          y: leafPos.y + (hubCy - leafCy),
        });
      } else {
        // Primarily vertical: snap x.
        entityPositions.set(leaf.leafId, {
          ...leafPos,
          x: leafPos.x + (hubCx - leafCx),
        });
      }
    } else {
      // Multiple leaves: distribute evenly around the hub entity.
      // Sort by current angle from hub to preserve rough spatial order.
      const withAngles = leaves.map((leaf) => {
        const lp = entityPositions.get(leaf.leafId)!;
        const angle = Math.atan2(
          lp.y + lp.height / 2 - hubCy,
          lp.x + lp.width / 2 - hubCx,
        );
        return { ...leaf, angle };
      });
      withAngles.sort((a, b) => a.angle - b.angle);

      const angleStep = (2 * Math.PI) / withAngles.length;
      // Start from the angle of the first leaf to preserve general direction.
      const startAngle = withAngles[0]!.angle;

      for (let i = 0; i < withAngles.length; i++) {
        const leaf = withAngles[i]!;
        const leafPos = entityPositions.get(leaf.leafId);
        if (!leafPos) continue;

        const angle = startAngle + i * angleStep;
        const targetCx = hubCx + SPOKE_DISTANCE * Math.cos(angle);
        const targetCy = hubCy + SPOKE_DISTANCE * Math.sin(angle);

        entityPositions.set(leaf.leafId, {
          ...leafPos,
          x: targetCx - leafPos.width / 2,
          y: targetCy - leafPos.height / 2,
        });
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Pass 2: Geometric fact type placement
// ---------------------------------------------------------------------------

function placeFactTypes(
  graph: OrmGraph,
  entityPositions: Map<string, PositionedObjectTypeNode>,
  orientationOverrides?: OrientationOverrides,
  positionOverrides?: PositionOverrides,
): Map<string, PositionedFactTypeNode> {
  const positions = new Map<string, PositionedFactTypeNode>();

  // Group fact types by their entity pair (for stacking).
  const pairGroups = new Map<string, FactTypeNode[]>();

  for (const node of graph.nodes) {
    if (node.kind !== "fact_type") continue;
    const ft = node as FactTypeNode;
    const playerIds = [...new Set(ft.roles.map((r) => r.playerId))];

    if (playerIds.length === 2) {
      const key = [...playerIds].sort().join("--");
      let group = pairGroups.get(key);
      if (!group) {
        group = [];
        pairGroups.set(key, group);
      }
      group.push(ft);
    }
  }

  for (const node of graph.nodes) {
    if (node.kind !== "fact_type") continue;
    const ft = node as FactTypeNode;
    const playerIds = [...new Set(ft.roles.map((r) => r.playerId))];
    const arity = playerIds.length;

    let cx: number;
    let cy: number;
    let orientation: FactTypeOrientation;

    if (arity === 0) {
      // Degenerate: no connected entities.
      cx = 0;
      cy = 0;
      orientation = "horizontal";
    } else if (arity === 1 && playerIds[0] === playerIds[playerIds.length - 1]) {
      // Check if truly unary (1 role) or reflexive (2+ roles same player).
      const isReflexive = ft.roles.length >= 2;

      const entityPos = entityPositions.get(playerIds[0]!);
      if (!entityPos) {
        cx = 0;
        cy = 0;
        orientation = "horizontal";
      } else if (isReflexive) {
        // Reflexive: place adjacent to entity, offset below-right.
        cx = entityPos.x + entityPos.width + UNARY_STUB_LENGTH + ROLE_BOX_HEIGHT / 2;
        cy = entityPos.y + entityPos.height / 2;
        orientation = "vertical";
      } else {
        // Unary: single role box on a stub.
        cx = entityPos.x + entityPos.width + UNARY_STUB_LENGTH + ROLE_BOX_WIDTH / 2;
        cy = entityPos.y + entityPos.height / 2;
        orientation = "horizontal";
      }
    } else if (arity === 2) {
      // Binary: midpoint between two entities.
      const posA = entityPositions.get(playerIds[0]!);
      const posB = entityPositions.get(playerIds[1]!);
      if (!posA || !posB) {
        cx = 0;
        cy = 0;
        orientation = "horizontal";
      } else {
        const ax = posA.x + posA.width / 2;
        const ay = posA.y + posA.height / 2;
        const bx = posB.x + posB.width / 2;
        const by = posB.y + posB.height / 2;
        cx = (ax + bx) / 2;
        cy = (ay + by) / 2;

        const dx = Math.abs(bx - ax);
        const dy = Math.abs(by - ay);
        orientation = dx >= dy ? "horizontal" : "vertical";

        // Handle stacking for multiple fact types between same pair.
        const pairKey = [...playerIds].sort().join("--");
        const group = pairGroups.get(pairKey);
        if (group && group.length > 1) {
          const idx = group.indexOf(ft);
          const total = group.length;
          // Full visual height includes uniqueness bars, mandatory dots, and labels.
          const visualHeight = ROLE_BOX_HEIGHT
            + UNIQUENESS_BAR_OFFSET + UNIQUENESS_BAR_HEIGHT // above
            + MANDATORY_DOT_RADIUS * 2 + 2 // below (dots)
            + 18; // label text below
          const stackOffset = (idx - (total - 1) / 2) * (visualHeight + FACT_TYPE_STACK_GAP);

          if (orientation === "horizontal") {
            // Stack perpendicular to horizontal axis = vertically.
            cy += stackOffset;
          } else {
            // Stack perpendicular to vertical axis = horizontally.
            cx += stackOffset;
          }
        }
      }
    } else {
      // Ternary+: centroid of connected entities.
      let sumX = 0;
      let sumY = 0;
      let count = 0;
      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;

      for (const pid of playerIds) {
        const pos = entityPositions.get(pid);
        if (!pos) continue;
        const ecx = pos.x + pos.width / 2;
        const ecy = pos.y + pos.height / 2;
        sumX += ecx;
        sumY += ecy;
        minX = Math.min(minX, ecx);
        maxX = Math.max(maxX, ecx);
        minY = Math.min(minY, ecy);
        maxY = Math.max(maxY, ecy);
        count++;
      }

      if (count > 0) {
        cx = sumX / count;
        cy = sumY / count;
        orientation = (maxX - minX) >= (maxY - minY) ? "horizontal" : "vertical";
      } else {
        cx = 0;
        cy = 0;
        orientation = "horizontal";
      }
    }

    // Apply manual orientation override if provided.
    const orientOverride = orientationOverrides?.[ft.id];
    if (orientOverride) {
      orientation = orientOverride;
    }

    // For binary fact types, sort roles so that the role whose player is
    // spatially first (left for horizontal, top for vertical) gets slot 0.
    // This prevents edges from crossing over the fact type strip.
    let orderedRoles = ft.roles;
    if (ft.roles.length === 2) {
      const posA = entityPositions.get(ft.roles[0]!.playerId);
      const posB = entityPositions.get(ft.roles[1]!.playerId);
      if (posA && posB) {
        const acx = posA.x + posA.width / 2;
        const acy = posA.y + posA.height / 2;
        const bcx = posB.x + posB.width / 2;
        const bcy = posB.y + posB.height / 2;
        const shouldSwap = orientation === "horizontal"
          ? acx > bcx // role 0's player should be further left
          : acy > bcy; // role 0's player should be further up
        if (shouldSwap) {
          orderedRoles = [ft.roles[1]!, ft.roles[0]!];
        }
      }
    }

    // Compute dimensions and role box positions based on orientation.
    const roleCount = orderedRoles.length;
    let ftWidth: number;
    let ftHeight: number;
    const roles: PositionedRoleBox[] = [];

    if (orientation === "horizontal") {
      ftWidth = roleCount * ROLE_BOX_WIDTH;
      ftHeight = ROLE_BOX_HEIGHT;
      for (let i = 0; i < roleCount; i++) {
        const role = orderedRoles[i]!;
        roles.push({
          roleId: role.roleId,
          roleName: role.roleName,
          playerName: role.playerName,
          hasUniqueness: role.hasUniqueness,
          isMandatory: role.isMandatory,
          frequencyMin: role.frequencyMin,
          frequencyMax: role.frequencyMax,
          x: i * ROLE_BOX_WIDTH,
          y: 0,
          width: ROLE_BOX_WIDTH,
          height: ROLE_BOX_HEIGHT,
        });
      }
    } else {
      ftWidth = ROLE_BOX_HEIGHT; // swapped
      ftHeight = roleCount * ROLE_BOX_WIDTH; // swapped
      for (let i = 0; i < roleCount; i++) {
        const role = orderedRoles[i]!;
        roles.push({
          roleId: role.roleId,
          roleName: role.roleName,
          playerName: role.playerName,
          hasUniqueness: role.hasUniqueness,
          isMandatory: role.isMandatory,
          frequencyMin: role.frequencyMin,
          frequencyMax: role.frequencyMax,
          x: 0,
          y: i * ROLE_BOX_WIDTH,
          width: ROLE_BOX_HEIGHT, // swapped
          height: ROLE_BOX_WIDTH, // swapped
        });
      }
    }

    // Use manual position override if present, otherwise compute from
    // entity center.  Overrides are center-based, so convert to top-left.
    const posOverride = positionOverrides?.[ft.id];
    const ftX = (posOverride?.x ?? cx) - ftWidth / 2;
    const ftY = (posOverride?.y ?? cy) - ftHeight / 2;

    positions.set(ft.id, {
      kind: "fact_type",
      id: ft.id,
      name: ft.name,
      roles,
      hasSpanningUniqueness: (ft as FactTypeNode).hasSpanningUniqueness,
      ringConstraint: (ft as FactTypeNode).ringConstraint,
      isObjectified: (ft as FactTypeNode).isObjectified,
      objectifiedEntityName: (ft as FactTypeNode).objectifiedEntityName,
      annotations: (ft as FactTypeNode).annotations,
      orientation,
      x: ftX,
      y: ftY,
      width: ftWidth,
      height: ftHeight,
    });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Constraint node placement
// ---------------------------------------------------------------------------

function placeConstraintNodes(
  graph: OrmGraph,
  entityPositions: Map<string, PositionedObjectTypeNode>,
  factTypePositions: Map<string, PositionedFactTypeNode>,
): Map<string, PositionedConstraintNode> {
  const positions = new Map<string, PositionedConstraintNode>();

  // Build a lookup from roleId to its absolute position.
  const roleAbsolutePos = new Map<string, Position>();
  for (const ft of factTypePositions.values()) {
    for (const role of ft.roles) {
      roleAbsolutePos.set(role.roleId, {
        x: ft.x + role.x + role.width / 2,
        y: ft.y + role.y + role.height / 2,
      });
    }
  }

  for (const node of graph.nodes) {
    if (node.kind !== "constraint") continue;
    const cn = node as ConstraintNode;

    const allRoleIds = [...cn.roleIds, ...(cn.supersetRoleIds ?? [])];
    let sumX = 0;
    let sumY = 0;
    let count = 0;

    for (const roleId of allRoleIds) {
      const pos = roleAbsolutePos.get(roleId);
      if (pos) {
        sumX += pos.x;
        sumY += pos.y;
        count++;
      }
    }

    const diameter = CONSTRAINT_RADIUS * 2;
    let cx: number;
    let cy: number;

    if (count > 0) {
      cx = sumX / count;
      cy = sumY / count;

      // Offset perpendicular to the line between first two roles.
      if (allRoleIds.length >= 2) {
        const p1 = roleAbsolutePos.get(allRoleIds[0]!);
        const p2 = roleAbsolutePos.get(allRoleIds[1]!);
        if (p1 && p2) {
          const dx = p2.x - p1.x;
          const dy = p2.y - p1.y;
          const len = Math.sqrt(dx * dx + dy * dy);
          if (len > 0) {
            // Perpendicular offset.
            const perpX = -dy / len * 30;
            const perpY = dx / len * 30;
            cx += perpX;
            cy += perpY;
          }
        }
      }
    } else {
      cx = 0;
      cy = 0;
    }

    positions.set(cn.id, {
      kind: "constraint",
      id: cn.id,
      constraintKind: cn.constraintKind,
      roleIds: cn.roleIds,
      supersetRoleIds: cn.supersetRoleIds,
      x: cx - diameter / 2,
      y: cy - diameter / 2,
      width: diameter,
      height: diameter,
    });
  }

  return positions;
}

// ---------------------------------------------------------------------------
// Coordinate normalization
// ---------------------------------------------------------------------------

/**
 * Shift all node positions so that the minimum x and y are at a
 * comfortable padding offset, preventing negative coordinates.
 */
function normalizeCoordinates(nodes: PositionedNode[]): void {
  const PADDING = 40;
  let minX = Infinity;
  let minY = Infinity;

  for (const n of nodes) {
    const bb = effectiveBoundingBox(n);
    minX = Math.min(minX, bb.x);
    minY = Math.min(minY, bb.y);
  }

  if (!isFinite(minX)) return;

  const shiftX = PADDING - minX;
  const shiftY = PADDING - minY;

  if (Math.abs(shiftX) < 1 && Math.abs(shiftY) < 1) return;

  for (const n of nodes) {
    const mutable = n as unknown as MutablePosition;
    mutable.x += shiftX;
    mutable.y += shiftY;
  }
}

// ---------------------------------------------------------------------------
// Collision resolution
// ---------------------------------------------------------------------------

interface BoundingBox {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Compute the effective visual bounding box for a node, including
 * space for decorations like uniqueness bars, mandatory dots, labels,
 * and objectification borders that extend beyond the node's base box.
 */
function effectiveBoundingBox(node: PositionedNode): BoundingBox {
  const MIN_GAP = 30; // minimum gap between any two nodes

  if (node.kind === "fact_type") {
    const ft = node as PositionedFactTypeNode;

    // Start with the base box.
    let top = ft.y;
    let bottom = ft.y + ft.height;
    let left = ft.x;
    let right = ft.x + ft.width;

    // Uniqueness bars extend above (horizontal) or left (vertical).
    const hasAnyUniqueness = ft.roles.some((r) => r.hasUniqueness) || ft.hasSpanningUniqueness;
    if (hasAnyUniqueness) {
      if (ft.orientation === "horizontal") {
        top -= UNIQUENESS_BAR_OFFSET + UNIQUENESS_BAR_HEIGHT;
      } else {
        left -= UNIQUENESS_BAR_OFFSET + UNIQUENESS_BAR_HEIGHT;
      }
    }

    // Mandatory dots are rendered on the edge (not the fact box),
    // so they do not expand the bounding box.

    // Label text extends below (horizontal) or right (vertical).
    // Approximate label width from fact type name.
    const labelHeight = 18; // FONT_SIZE_ROLE(9) + gap
    if (ft.orientation === "horizontal") {
      bottom += labelHeight;
      // Name label can be wider than role boxes.
      const labelWidth = ft.name.length * 5.5; // approximate char width
      const ftCenterX = ft.x + ft.width / 2;
      left = Math.min(left, ftCenterX - labelWidth / 2);
      right = Math.max(right, ftCenterX + labelWidth / 2);
    } else {
      const labelWidth = ft.name.length * 5.5;
      right += 8 + labelWidth; // 8px gap + label text
    }

    // Objectification borders add padding on all sides.
    if (ft.isObjectified) {
      top -= OBJECTIFICATION_PADDING;
      bottom += OBJECTIFICATION_PADDING;
      left -= OBJECTIFICATION_PADDING;
      right += OBJECTIFICATION_PADDING;
    }

    return {
      nodeId: ft.id,
      x: left - MIN_GAP,
      y: top - MIN_GAP,
      width: right - left + 2 * MIN_GAP,
      height: bottom - top + 2 * MIN_GAP,
    };
  }

  // Entity types and constraint nodes: use base box with gap padding.
  return {
    nodeId: node.id,
    x: node.x - MIN_GAP,
    y: node.y - MIN_GAP,
    width: node.width + 2 * MIN_GAP,
    height: node.height + 2 * MIN_GAP,
  };
}

function resolveOverlaps(nodes: PositionedNode[]): void {
  const MAX_ITERATIONS = 20;

  // Build a map from node ID to node index for O(1) lookup.
  const idToIndex = new Map<string, number>();
  for (let i = 0; i < nodes.length; i++) {
    idToIndex.set(nodes[i]!.id, i);
  }

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    let moved = false;

    // Build effective bounding boxes that include visual decorations.
    const boxes: BoundingBox[] = nodes.map((n) => effectiveBoundingBox(n));

    // Sort by x for efficient sweep.
    boxes.sort((a, b) => a.x - b.x);

    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i]!;
        const b = boxes[j]!;

        // If b starts beyond a's right edge, no more overlaps for a.
        if (b.x > a.x + a.width) break;

        // Check vertical overlap.
        if (a.y + a.height <= b.y || b.y + b.height <= a.y) continue;

        // Overlap detected. Compute MTV.
        const overlapX = Math.min(a.x + a.width - b.x, b.x + b.width - a.x);
        const overlapY = Math.min(a.y + a.height - b.y, b.y + b.height - a.y);

        // Find the actual nodes and nudge them.
        const idxA = idToIndex.get(a.nodeId);
        const idxB = idToIndex.get(b.nodeId);
        if (idxA === undefined || idxB === undefined) continue;
        const nodeA = nodes[idxA]!;
        const nodeB = nodes[idxB]!;

        const mutableA = nodeA as unknown as MutablePosition;
        const mutableB = nodeB as unknown as MutablePosition;

        if (overlapX < overlapY) {
          // Separate horizontally.
          const halfX = overlapX / 2 + 1;
          mutableA.x -= halfX;
          mutableB.x += halfX;
        } else {
          // Separate vertically.
          const halfY = overlapY / 2 + 1;
          mutableA.y -= halfY;
          mutableB.y += halfY;
        }
        moved = true;
      }
    }

    if (!moved) break;
  }
}

// ---------------------------------------------------------------------------
// Edge routing
// ---------------------------------------------------------------------------

function entityCenter(pos: PositionedObjectTypeNode): Position {
  return { x: pos.x + pos.width / 2, y: pos.y + pos.height / 2 };
}

function roleCenter(ft: PositionedFactTypeNode, role: PositionedRoleBox): Position {
  return { x: ft.x + role.x + role.width / 2, y: ft.y + role.y + role.height / 2 };
}

/**
 * Compute the connection point on a role box for edge routing.
 *
 * For binary fact types, edges connect to the outer end of each role box
 * (the side facing away from the partner role). For ternary+ fact types,
 * end roles connect at their outer edge and middle roles connect at their
 * center. This matches the NORMA ORM 2 convention.
 */
function roleConnectionPoint(
  ft: PositionedFactTypeNode,
  role: PositionedRoleBox,
): Position {
  const roleCount = ft.roles.length;
  const roleIndex = ft.roles.indexOf(role);

  // Middle roles in ternary+ facts connect at center.
  if (roleIndex > 0 && roleIndex < roleCount - 1) {
    return roleCenter(ft, role);
  }

  if (ft.orientation === "horizontal") {
    const cy = ft.y + role.y + role.height / 2;
    if (roleIndex === 0) {
      // First role: connect at left edge.
      return { x: ft.x + role.x, y: cy };
    }
    // Last role: connect at right edge.
    return { x: ft.x + role.x + role.width, y: cy };
  }

  // Vertical orientation.
  const cx = ft.x + role.x + role.width / 2;
  if (roleIndex === 0) {
    // First role: connect at top edge.
    return { x: cx, y: ft.y + role.y };
  }
  // Last role: connect at bottom edge.
  return { x: cx, y: ft.y + role.y + role.height };
}

/**
 * Compute where a ray from `from` to `to` intersects a rounded rectangle
 * defined by x, y, width, height.
 */
function rectBorderIntersection(
  from: Position,
  to: Position,
  rect: { x: number; y: number; width: number; height: number; },
): Position {
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const hw = rect.width / 2;
  const hh = rect.height / 2;

  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  // Scale factors to hit each edge.
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);

  return { x: cx + dx * scale, y: cy + dy * scale };
}

/**
 * Compute where a ray from `from` to `to` intersects an ellipse
 * centered at cx, cy with radii rx, ry.
 */
function ellipseBorderIntersection(
  from: Position,
  to: Position,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): Position {
  const dx = to.x - from.x;
  const dy = to.y - from.y;

  if (dx === 0 && dy === 0) return { x: cx, y: cy };

  const angle = Math.atan2(dy, dx);
  return {
    x: cx + rx * Math.cos(angle),
    y: cy + ry * Math.sin(angle),
  };
}

function entityBorderPoint(
  entity: PositionedObjectTypeNode,
  target: Position,
): Position {
  const center = entityCenter(entity);
  if (entity.objectTypeKind === "value") {
    // Value types are ellipses.
    return ellipseBorderIntersection(
      center,
      target,
      center.x,
      center.y,
      entity.width / 2,
      entity.height / 2,
    );
  }
  return rectBorderIntersection(center, target, entity);
}

function routeRoleEdges(
  graph: OrmGraph,
  entityPositions: Map<string, PositionedObjectTypeNode>,
  factTypePositions: Map<string, PositionedFactTypeNode>,
): PositionedEdge[] {
  const edges: PositionedEdge[] = [];

  for (const edge of graph.edges) {
    const entityPos = entityPositions.get(edge.sourceNodeId);
    const ftPos = factTypePositions.get(edge.targetNodeId);
    if (!entityPos || !ftPos) continue;

    const role = ftPos.roles.find((r) => r.roleId === edge.roleId);
    if (!role) continue;

    const rc = roleConnectionPoint(ftPos, role);
    const ep = entityBorderPoint(entityPos, rc);

    edges.push({
      sourceNodeId: edge.sourceNodeId,
      targetNodeId: edge.targetNodeId,
      roleId: edge.roleId,
      isMandatory: role.isMandatory,
      points: [ep, rc],
    });
  }

  return edges;
}

function routeConstraintEdges(
  graph: OrmGraph,
  constraintPositions: Map<string, PositionedConstraintNode>,
  factTypePositions: Map<string, PositionedFactTypeNode>,
): PositionedConstraintEdge[] {
  const edges: PositionedConstraintEdge[] = [];

  // Build role lookup.
  const roleLookup = new Map<string, { ft: PositionedFactTypeNode; role: PositionedRoleBox; }>();
  for (const ft of factTypePositions.values()) {
    for (const role of ft.roles) {
      roleLookup.set(role.roleId, { ft, role });
    }
  }

  for (const ce of graph.constraintEdges) {
    const cnPos = constraintPositions.get(ce.constraintNodeId);
    if (!cnPos) continue;

    const roleInfo = roleLookup.get(ce.roleId);
    if (!roleInfo) continue;

    const cnCenter: Position = {
      x: cnPos.x + cnPos.width / 2,
      y: cnPos.y + cnPos.height / 2,
    };
    const rc = roleCenter(roleInfo.ft, roleInfo.role);

    edges.push({
      constraintNodeId: ce.constraintNodeId,
      factTypeNodeId: ce.factTypeNodeId,
      roleId: ce.roleId,
      points: [cnCenter, rc],
    });
  }

  return edges;
}

function routeSubtypeEdges(
  graph: OrmGraph,
  entityPositions: Map<string, PositionedObjectTypeNode>,
): PositionedSubtypeEdge[] {
  const edges: PositionedSubtypeEdge[] = [];

  for (const se of graph.subtypeEdges) {
    const subPos = entityPositions.get(se.subtypeNodeId);
    const superPos = entityPositions.get(se.supertypeNodeId);
    if (!subPos || !superPos) continue;

    const subCenter = entityCenter(subPos);
    const superCenter = entityCenter(superPos);

    const start = entityBorderPoint(subPos, superCenter);
    const end = entityBorderPoint(superPos, subCenter);

    edges.push({
      subtypeNodeId: se.subtypeNodeId,
      supertypeNodeId: se.supertypeNodeId,
      providesIdentification: se.providesIdentification,
      points: [start, end],
    });
  }

  return edges;
}

// ---------------------------------------------------------------------------
// Bounding box computation
// ---------------------------------------------------------------------------

function computeBounds(
  nodes: readonly PositionedNode[],
  edges: readonly PositionedEdge[],
  subtypeEdges: readonly PositionedSubtypeEdge[],
): { originX: number; originY: number; width: number; height: number; } {
  const PADDING = 40;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.x);
    minY = Math.min(minY, node.y);
    maxX = Math.max(maxX, node.x + node.width);
    maxY = Math.max(maxY, node.y + node.height);
  }

  for (const edge of edges) {
    for (const p of edge.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  for (const edge of subtypeEdges) {
    for (const p of edge.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  if (!isFinite(minX)) {
    return { originX: 0, originY: 0, width: 800, height: 600 };
  }

  return {
    originX: minX - PADDING,
    originY: minY - PADDING,
    width: maxX - minX + 2 * PADDING,
    height: maxY - minY + 2 * PADDING,
  };
}
