/**
 * Pure layout-quality metrics over a `PositionedGraph`.
 *
 * The exact-match SVG goldens (in `@barwise/diagram-ui`) pin the
 * deterministic pipeline but cannot survive an ELK version bump, which
 * may legitimately move nodes. These aggregate measures carry the
 * cross-version guarantee instead: asserted with tolerances, they catch
 * a layout regression (overlapping nodes, exploded edge lengths, a
 * degenerate aspect ratio) without pinning coordinates. See
 * `docs/specs/diagram-layout-aesthetics.spec.md`, workstream 2.
 */
import type { PositionedGraph, PositionedNode } from "./LayoutTypes.js";

export interface LayoutMetrics {
  /** Number of node pairs whose rectangles overlap with positive area. */
  readonly nodeOverlapCount: number;
  /** Sum of polyline lengths over role, constraint, and subtype edges. */
  readonly totalEdgeLength: number;
  /** Bounding-box width divided by height (0 when either is 0). */
  readonly aspectRatio: number;
}

function overlaps(a: PositionedNode, b: PositionedNode): boolean {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0;
}

function polylineLength(points: readonly { x: number; y: number; }[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const dx = points[i]!.x - points[i - 1]!.x;
    const dy = points[i]!.y - points[i - 1]!.y;
    total += Math.sqrt(dx * dx + dy * dy);
  }
  return total;
}

/** Compute the quality metrics for a positioned graph. */
export function computeLayoutMetrics(graph: PositionedGraph): LayoutMetrics {
  let nodeOverlapCount = 0;
  for (let i = 0; i < graph.nodes.length; i++) {
    for (let j = i + 1; j < graph.nodes.length; j++) {
      if (overlaps(graph.nodes[i]!, graph.nodes[j]!)) nodeOverlapCount++;
    }
  }

  let totalEdgeLength = 0;
  for (const e of graph.edges) totalEdgeLength += polylineLength(e.points);
  for (const e of graph.constraintEdges) totalEdgeLength += polylineLength(e.points);
  for (const e of graph.subtypeEdges) totalEdgeLength += polylineLength(e.points);

  const aspectRatio = graph.width > 0 && graph.height > 0
    ? graph.width / graph.height
    : 0;

  return { nodeOverlapCount, totalEdgeLength, aspectRatio };
}
