/**
 * Layout laws: what must be true of every `PositionedGraph`.
 *
 * These exist because the layout already COMPUTED whether its nodes overlap
 * and nothing asserted the answer was zero. `computeLayoutMetrics` has
 * reported `nodeOverlapCount` since it was written, and
 * `tests/layout/metrics.test.ts` checks that the counter counts -- on graphs
 * built by hand. No test ever laid out a model and demanded the count be zero
 * (barwise-1024, barwise-1023, docs/specs/diagram-layout-laws.spec.md).
 *
 * This is the first law suite outside `core`, and the reason it is geometry
 * rather than pixels is the shadow argument in CLAUDE.md. A golden SVG string
 * proves the serialisation did not change; it correlates with "the diagram is
 * legible" through "the renderer is deterministic", and it diverges exactly
 * where the SVG is valid, byte-stable and visually wrong. Overlapping role
 * boxes and a predicate reading off-canvas are not facts about pixels. They are
 * facts about rectangles, and `PositionedGraph` carries every rectangle.
 *
 * WHAT THESE CANNOT SEE. Anything depending on how text is measured: a label
 * clipped because the real font is wider than the layout's estimate, a reading
 * overflowing its role box, a glyph rendered as tofu. That is the half of
 * barwise-1023 a rasteriser would answer, and it stays open.
 *
 * All four laws were MEASURED TRUE over the repository's thirteen committed
 * models before being written down -- ten promptlab references and three
 * diagram-ui golden fixtures, 6 to 26 nodes, zero overlaps, zero nodes outside
 * the viewBox, zero dangling edge endpoints, and edges terminating on their
 * node boundaries at a worst tolerance of 0px. A property nobody measured is a
 * guess, and the 0px reading is what justifies asserting termination exactly
 * rather than with a fudge factor.
 */
import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { modelToGraph } from "../../src/graph/ModelToGraph.js";
import { layoutGraph } from "../../src/layout/ElkLayoutEngine.js";
import type { PositionedGraph, PositionedNode } from "../../src/layout/LayoutTypes.js";
import { computeLayoutMetrics } from "../../src/layout/metrics.js";
import { arbLayoutModel, RUNS, SEED } from "../arbitraries/layout.js";

const CONFIG = { numRuns: RUNS, seed: SEED } as const;

/** Lay a generated model out, which is the subject of every law below. */
async function layoutOf(model: Parameters<typeof modelToGraph>[0]): Promise<PositionedGraph> {
  return await layoutGraph(modelToGraph(model));
}

function describeNode(n: PositionedNode): string {
  return `${n.id}(${n.x},${n.y} ${n.width}x${n.height})`;
}

describe("layout laws", () => {
  it("places no two nodes on top of each other", async () => {
    // The overlap predicate is `metrics.ts`'s, not a second definition of the
    // same geometry written here: restating it would create a must-agree copy
    // of exactly the kind CLAUDE.md forbids, and the two could then disagree
    // about whether touching edges count.
    await fc.assert(
      fc.asyncProperty(arbLayoutModel(), async (model) => {
        const graph = await layoutOf(model);
        const { nodeOverlapCount } = computeLayoutMetrics(graph);
        expect(
          nodeOverlapCount,
          `${nodeOverlapCount} overlapping pair(s) in ${graph.nodes.map(describeNode).join(", ")}`,
        ).toBe(0);
      }),
      CONFIG,
    );
  });

  it("keeps every drawn point inside the viewBox it declares", async () => {
    // Stated over ALL drawn geometry, not just nodes, because "nodes fit a box
    // computed from the nodes" is a tautology: `computeBounds` takes the min
    // and max over node rectangles, so that law could not fail and would be a
    // check with no reachable failure path -- the thing `audit:rubric` exists
    // to flag. Verified by reading computeBounds rather than assumed.
    //
    // Over edge routes it IS reachable, and mutation-verified: dropping the
    // edge loop from `computeBounds` makes this fire. Constraint edges are
    // asserted here too and are the one input `computeBounds` genuinely omits,
    // but this arbitrary does not yet generate constraints -- so that clause is
    // correct and currently unexercised, which is a follow-up rather than
    // coverage being claimed for it.
    await fc.assert(
      fc.asyncProperty(arbLayoutModel(), async (model) => {
        const graph = await layoutOf(model);
        const right = graph.originX + graph.width;
        const bottom = graph.originY + graph.height;
        const inside = (x: number, y: number) =>
          x >= graph.originX && x <= right && y >= graph.originY && y <= bottom;

        for (const n of graph.nodes) {
          expect(
            inside(n.x, n.y) && inside(n.x + n.width, n.y + n.height),
            `${
              describeNode(n)
            } escapes the viewBox ${graph.originX},${graph.originY} ${right}x${bottom}`,
          ).toBe(true);
        }
        const routes = [
          ...graph.edges.map((e) => ["edge", e.roleId, e.points] as const),
          ...graph.subtypeEdges.map((e) => ["subtype", e.subtypeNodeId, e.points] as const),
          ...graph.constraintEdges.map((e) => ["constraint", e.roleId, e.points] as const),
        ];
        for (const [kind, id, points] of routes) {
          for (const p of points) {
            expect(
              inside(p.x, p.y),
              `${kind} ${id} routes through (${p.x},${p.y}), outside the`
                + ` viewBox ${graph.originX},${graph.originY} ${right}x${bottom}`,
            ).toBe(true);
          }
        }
      }),
      CONFIG,
    );
  });

  it("gives every edge two endpoints that exist", async () => {
    // Referential integrity of the positioned graph. An edge naming a node the
    // graph does not contain renders as a line from nowhere.
    await fc.assert(
      fc.asyncProperty(arbLayoutModel(), async (model) => {
        const graph = await layoutOf(model);
        const ids = new Set(graph.nodes.map((n) => n.id));
        for (const e of graph.edges) {
          expect(ids.has(e.sourceNodeId), `edge source ${e.sourceNodeId} is not a node`).toBe(true);
          expect(ids.has(e.targetNodeId), `edge target ${e.targetNodeId} is not a node`).toBe(true);
        }
        for (const e of graph.subtypeEdges) {
          expect(ids.has(e.subtypeNodeId), `subtype ${e.subtypeNodeId} is not a node`).toBe(true);
          expect(ids.has(e.supertypeNodeId), `supertype ${e.supertypeNodeId} is not a node`)
            .toBe(true);
        }
      }),
      CONFIG,
    );
  });

  it("terminates every edge on the rectangles of the nodes it joins", async () => {
    // Exactly, not approximately: measured at 0px worst tolerance across all
    // thirteen committed models. A tolerance here would be insurance against a
    // future floating-point change in ELK, bought by making the law stop saying
    // what it means.
    await fc.assert(
      fc.asyncProperty(arbLayoutModel(), async (model) => {
        const graph = await layoutOf(model);
        const byId = new Map(graph.nodes.map((n) => [n.id, n]));
        const onRect = (p: { x: number; y: number; }, n: PositionedNode) =>
          p.x >= n.x && p.x <= n.x + n.width && p.y >= n.y && p.y <= n.y + n.height;

        for (const e of graph.edges) {
          const source = byId.get(e.sourceNodeId);
          const target = byId.get(e.targetNodeId);
          if (source === undefined || target === undefined) continue; // the law above
          expect(e.points.length, `edge ${e.roleId} has no route`).toBeGreaterThanOrEqual(2);
          const first = e.points[0]!;
          const last = e.points[e.points.length - 1]!;
          expect(
            onRect(first, source),
            `edge ${e.roleId} starts at (${first.x},${first.y}), off ${describeNode(source)}`,
          ).toBe(true);
          expect(
            onRect(last, target),
            `edge ${e.roleId} ends at (${last.x},${last.y}), off ${describeNode(target)}`,
          ).toBe(true);
        }
      }),
      CONFIG,
    );
  });
});
