/**
 * Unit tests for detectClusters: the pure Louvain community detection
 * extracted from the layout engine. No ELK, no model -- a function of
 * entity ids and pairwise edge weights, so it is tested directly.
 */
import { describe, expect, it } from "vitest";
import { detectClusters } from "../../src/layout/ClusterDetection.js";

/** Build a sorted-key edge-weight map from [a, b, weight] triples. */
function weights(...edges: [string, string, number][]): Map<string, number> {
  const m = new Map<string, number>();
  for (const [a, b, w] of edges) {
    m.set([a, b].sort().join("--"), w);
  }
  return m;
}

/** Group entity ids by their assigned community. */
function communities(result: Map<string, number>): Set<string>[] {
  const byComm = new Map<number, Set<string>>();
  for (const [id, comm] of result) {
    let set = byComm.get(comm);
    if (!set) {
      set = new Set();
      byComm.set(comm, set);
    }
    set.add(id);
  }
  return [...byComm.values()];
}

describe("detectClusters", () => {
  it("assigns four or fewer entities to a single community", () => {
    const ids = ["A", "B", "C", "D"];
    const result = detectClusters(ids, weights(["A", "B", 1], ["C", "D", 1]));

    expect([...result.values()].every((c) => c === 0)).toBe(true);
    expect(result.size).toBe(4);
  });

  it("falls back to one community when there are no edge weights", () => {
    const ids = ["A", "B", "C", "D", "E"];
    const result = detectClusters(ids, new Map());

    expect(communities(result)).toHaveLength(1);
    expect([...result.values()].every((c) => c === 0)).toBe(true);
  });

  it("separates two disconnected triangles into two communities", () => {
    const ids = ["A", "B", "C", "D", "E", "F"];
    const result = detectClusters(
      ids,
      weights(
        ["A", "B", 1],
        ["A", "C", 1],
        ["B", "C", 1],
        ["D", "E", 1],
        ["D", "F", 1],
        ["E", "F", 1],
      ),
    );

    // A, B, C share a community; D, E, F share the other.
    expect(result.get("A")).toBe(result.get("B"));
    expect(result.get("A")).toBe(result.get("C"));
    expect(result.get("D")).toBe(result.get("E"));
    expect(result.get("D")).toBe(result.get("F"));
    expect(result.get("A")).not.toBe(result.get("D"));

    // Community ids are renumbered to a contiguous 0-based range.
    expect(new Set(result.values())).toEqual(new Set([0, 1]));
  });

  it("merges a weakly attached node into its neighbor's community", () => {
    // A dense 4-clique plus a pendant E attached only to A. E lands in a
    // sub-3-member cluster and is merged into its most-connected neighbor.
    const ids = ["A", "B", "C", "D", "E"];
    const result = detectClusters(
      ids,
      weights(
        ["A", "B", 5],
        ["A", "C", 5],
        ["A", "D", 5],
        ["B", "C", 5],
        ["B", "D", 5],
        ["C", "D", 5],
        ["A", "E", 1],
      ),
    );

    expect(result.get("E")).toBe(result.get("A"));
    expect(communities(result)).toHaveLength(1);
  });

  it("ignores edge weights referencing unknown entities", () => {
    const ids = ["A", "B", "C", "D", "E"];
    const result = detectClusters(
      ids,
      weights(["A", "B", 1], ["X", "Y", 9], ["C", "D", 1]),
    );

    // Every listed entity is assigned; the stray X/Y edge is skipped.
    expect(result.size).toBe(5);
    expect(result.has("X")).toBe(false);
  });
});
