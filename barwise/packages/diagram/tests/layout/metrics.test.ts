/**
 * Tests for the pure layout-quality metrics (aesthetics spec, workstream 2).
 *
 * The unit tests pin the metric definitions on hand-built graphs. The
 * corpus assertions run real ELK over the golden-corpus models and hold
 * the metrics inside tolerance ranges -- the guard that survives an ELK
 * version bump, which may move coordinates but must not produce
 * overlapping nodes, exploded edge lengths, or a degenerate aspect
 * ratio. Ranges are calibrated to measured values (2026-07) with wide
 * headroom; tighten with evidence, the same discipline as the coverage
 * floors.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../../core/src/index.js";
import { generateDiagram } from "../../src/DiagramGenerator.js";
import type { PositionedGraph, PositionedNode } from "../../src/layout/LayoutTypes.js";
import { computeLayoutMetrics } from "../../src/layout/metrics.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = resolve(__dirname, "../../../../examples/models");
const FIXTURES = resolve(__dirname, "../../../diagram-ui/tests/golden/fixtures");

function entityNode(id: string, x: number, y: number, w = 100, h = 50): PositionedNode {
  return { kind: "object_type", id, name: id, objectTypeKind: "entity", x, y, width: w, height: h };
}

function graphOf(nodes: PositionedNode[], edges: PositionedGraph["edges"] = []): PositionedGraph {
  return {
    nodes,
    edges,
    constraintEdges: [],
    subtypeEdges: [],
    originX: 0,
    originY: 0,
    width: 400,
    height: 200,
  };
}

describe("computeLayoutMetrics definitions", () => {
  it("counts overlapping node pairs, ignoring mere edge contact", () => {
    const separated = graphOf([entityNode("a", 0, 0), entityNode("b", 200, 0)]);
    expect(computeLayoutMetrics(separated).nodeOverlapCount).toBe(0);

    // Touching at x=100 has zero intersection area: not an overlap.
    const touching = graphOf([entityNode("a", 0, 0), entityNode("b", 100, 0)]);
    expect(computeLayoutMetrics(touching).nodeOverlapCount).toBe(0);

    const overlapping = graphOf([
      entityNode("a", 0, 0),
      entityNode("b", 50, 20),
      entityNode("c", 60, 30),
    ]);
    expect(computeLayoutMetrics(overlapping).nodeOverlapCount).toBe(3);
  });

  it("sums polyline lengths across all edge kinds", () => {
    const graph: PositionedGraph = {
      ...graphOf([]),
      edges: [{
        sourceNodeId: "a",
        targetNodeId: "b",
        roleId: "r",
        isMandatory: false,
        points: [{ x: 0, y: 0 }, { x: 30, y: 40 }],
      }],
      constraintEdges: [{
        constraintNodeId: "c",
        factTypeNodeId: "f",
        roleId: "r",
        points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }],
      }],
      subtypeEdges: [{
        subtypeNodeId: "s",
        supertypeNodeId: "t",
        providesIdentification: false,
        points: [{ x: 0, y: 0 }, { x: 0, y: 5 }],
      }],
    };
    expect(computeLayoutMetrics(graph).totalEdgeLength).toBeCloseTo(50 + 20 + 5);
  });

  it("reports width/height as the aspect ratio, 0 for an empty extent", () => {
    expect(computeLayoutMetrics(graphOf([])).aspectRatio).toBe(2);
    expect(computeLayoutMetrics({ ...graphOf([]), height: 0 }).aspectRatio).toBe(0);
  });
});

describe("layout metrics over the golden corpus (real ELK)", () => {
  const serializer = new OrmYamlSerializer();

  // Measured 2026-07: edge lengths 618-6218, aspect ratios 0.72-1.89.
  const CORPUS: ReadonlyArray<{ path: string; maxEdgeLength: number; }> = [
    { path: resolve(EXAMPLES, "diagram-layout.orm.yaml"), maxEdgeLength: 9500 },
    { path: resolve(EXAMPLES, "learning-design.orm.yaml"), maxEdgeLength: 8500 },
    { path: resolve(FIXTURES, "subtype-fan.orm.yaml"), maxEdgeLength: 1000 },
    { path: resolve(FIXTURES, "value-hub.orm.yaml"), maxEdgeLength: 2500 },
    { path: resolve(FIXTURES, "cluster-split.orm.yaml"), maxEdgeLength: 3300 },
  ];

  for (const { path, maxEdgeLength } of CORPUS) {
    const name = path.split("/").pop();
    // Real ELK over the larger corpus models can exceed vitest's 5s
    // default on a loaded CI runner under coverage instrumentation.
    it(`holds tolerances for ${name}`, { timeout: 30_000 }, async () => {
      const model = serializer.deserialize(readFileSync(path, "utf-8"));
      const { layout } = await generateDiagram(model);
      const m = computeLayoutMetrics(layout);

      expect(m.nodeOverlapCount).toBe(0);
      expect(m.totalEdgeLength).toBeGreaterThan(0);
      expect(m.totalEdgeLength).toBeLessThan(maxEdgeLength);
      expect(m.aspectRatio).toBeGreaterThan(0.4);
      expect(m.aspectRatio).toBeLessThan(3);
    });
  }
});
