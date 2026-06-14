/**
 * Post-Pass-1 entity adjustments: fan subtypes radially outward from the
 * diagram centroid, and align leaf value types with their connected
 * entity. Pure functions over the entity positions ELK produced.
 */
import type { FactTypeNode, OrmGraph } from "../graph/GraphTypes.js";
import type { PositionedObjectTypeNode } from "./LayoutTypes.js";

/**
 * Count the number of fact-type connections each entity participates in.
 * Used to decide whether a subtype is a "leaf" (few connections) or a
 * hub (many connections) relative to its supertype.
 */
export function buildConnectionCounts(graph: OrmGraph): Map<string, number> {
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
export function placeSubtypesRadially(
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

/**
 * Identify value types that participate in exactly one binary fact type
 * ("leaf attributes") and align them horizontally or vertically with
 * their connected entity, so the connection is a clean straight line.
 */
export function alignLeafValueTypes(
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
