/**
 * Coordinate quantization for the headless SVG render.
 *
 * ELK emits full-float coordinates (`x="771.9097335333806"`), and that
 * precision is exactly where cross-platform floating-point drift would
 * surface in a golden file. Rounding every coordinate and dimension to
 * integer pixels absorbs sub-pixel FP noise -- below the threshold of
 * visual difference for a diagram -- so the golden-file guard in
 * `tests/golden/` is platform-robust and the SVG output shrinks. See
 * `docs/specs/diagram-layout-aesthetics.spec.md`, workstream 1.
 *
 * Only the static render quantizes; the interactive canvas keeps the
 * raw graph so drags stay smooth at any zoom.
 */
import type { PositionedGraph } from "@barwise/diagram";

type Nodes = PositionedGraph["nodes"];
type Point = { readonly x: number; readonly y: number; };

function quantizePoint(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}

function quantizeNodes(nodes: Nodes): Nodes {
  return nodes.map((node) => {
    const rounded = {
      ...node,
      x: Math.round(node.x),
      y: Math.round(node.y),
      width: Math.round(node.width),
      height: Math.round(node.height),
    };
    if (rounded.kind === "fact_type") {
      return {
        ...rounded,
        roles: rounded.roles.map((r) => ({
          ...r,
          x: Math.round(r.x),
          y: Math.round(r.y),
          width: Math.round(r.width),
          height: Math.round(r.height),
        })),
      };
    }
    return rounded;
  });
}

/** Round every coordinate and dimension in the graph to integer pixels. */
export function quantizeGraph(graph: PositionedGraph): PositionedGraph {
  return {
    nodes: quantizeNodes(graph.nodes),
    edges: graph.edges.map((e) => ({ ...e, points: e.points.map(quantizePoint) })),
    constraintEdges: graph.constraintEdges.map((e) => ({
      ...e,
      points: e.points.map(quantizePoint),
    })),
    subtypeEdges: graph.subtypeEdges.map((e) => ({
      ...e,
      points: e.points.map(quantizePoint),
    })),
    originX: Math.round(graph.originX),
    originY: Math.round(graph.originY),
    width: Math.round(graph.width),
    height: Math.round(graph.height),
  };
}
