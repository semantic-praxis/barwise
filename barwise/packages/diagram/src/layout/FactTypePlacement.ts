/**
 * Pass 2 of the layout: geometric fact-type and constraint-node
 * placement. Positions each fact type between its connected entities
 * (with stacking, orientation, and manual overrides) and places
 * constraint nodes near the roles they govern.
 */
import type { ConstraintNode, FactTypeNode, OrmGraph } from "../graph/GraphTypes.js";
import {
  CONSTRAINT_RADIUS,
  FACT_TYPE_STACK_GAP,
  MANDATORY_DOT_RADIUS,
  ROLE_BOX_HEIGHT,
  ROLE_BOX_WIDTH,
  UNARY_STUB_LENGTH,
  UNIQUENESS_BAR_HEIGHT,
  UNIQUENESS_BAR_OFFSET,
} from "../render/theme.js";
import type {
  FactTypeOrientation,
  OrientationOverrides,
  Position,
  PositionedConstraintNode,
  PositionedFactTypeNode,
  PositionedObjectTypeNode,
  PositionedRoleBox,
  PositionOverrides,
} from "./LayoutTypes.js";

export function placeFactTypes(
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

export function placeConstraintNodes(
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
