import {
  OBJECTIFICATION_PADDING,
  UNIQUENESS_BAR_HEIGHT,
  UNIQUENESS_BAR_OFFSET,
} from "../render/theme.js";
import type { PositionedFactTypeNode, PositionedNode } from "./LayoutTypes.js";

interface BoundingBox {
  nodeId: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface MutablePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Coordinate normalization
// ---------------------------------------------------------------------------

/**
 * Shift all node positions so that the minimum x and y are at a
 * comfortable padding offset, preventing negative coordinates.
 */
export function normalizeCoordinates(nodes: PositionedNode[]): void {
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

/**
 * Compute the effective visual bounding box for a node, including
 * space for decorations like uniqueness bars, mandatory dots, labels,
 * and objectification borders that extend beyond the node's base box.
 */
export function effectiveBoundingBox(node: PositionedNode): BoundingBox {
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

export function resolveOverlaps(nodes: PositionedNode[]): void {
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
