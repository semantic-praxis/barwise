import type { OrmGraph } from "../graph/GraphTypes.js";
import type {
  Position,
  PositionedConstraintEdge,
  PositionedConstraintNode,
  PositionedEdge,
  PositionedFactTypeNode,
  PositionedNode,
  PositionedObjectTypeNode,
  PositionedRoleBox,
  PositionedSubtypeEdge,
} from "./LayoutTypes.js";

// ---------------------------------------------------------------------------
// Geometry helpers
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
export function roleConnectionPoint(
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
export function rectBorderIntersection(
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
export function ellipseBorderIntersection(
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

export function entityBorderPoint(
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

// ---------------------------------------------------------------------------
// Edge routing
// ---------------------------------------------------------------------------

export function routeRoleEdges(
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

export function routeConstraintEdges(
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

export function routeSubtypeEdges(
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

export function computeBounds(
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
