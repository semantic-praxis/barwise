/**
 * Pass 1 of the layout: cluster-aware entity placement. Builds the
 * entity-only ELK graph, runs ELK stress (single-level, or two-level
 * over detected clusters), and extracts the positioned entity nodes.
 */
import type { ElkExtendedEdge, ElkNode } from "elkjs";
import type { FactTypeNode, OrmGraph } from "../graph/GraphTypes.js";
import { FONT_SIZE_ALIAS, OT_ALIAS_LINE_HEIGHT, OT_HEIGHT, OT_MIN_WIDTH } from "../render/theme.js";
import { detectClusters } from "./ClusterDetection.js";
import { getElk } from "./ElkInterop.js";
import type { Position, PositionedObjectTypeNode } from "./LayoutTypes.js";

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
export async function layoutEntitiesWithClusters(
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
