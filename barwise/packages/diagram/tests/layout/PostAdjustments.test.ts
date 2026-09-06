/**
 * Unit tests for the post-Pass-1 entity adjustments. Pure functions over
 * an entity-position map, so they are driven directly: connection
 * counting, the subtype radial fan (and its connection-count gate), and
 * leaf value-type axis alignment.
 */
import { describe, expect, it } from "vitest";
import type { GraphNode, OrmGraph } from "../../src/graph/GraphTypes.js";
import type { PositionedObjectTypeNode } from "../../src/layout/LayoutTypes.js";
import {
  alignLeafValueTypes,
  buildConnectionCounts,
  placeSubtypesRadially,
} from "../../src/layout/PostAdjustments.js";

function fact(id: string, players: string[]): GraphNode {
  return {
    kind: "fact_type",
    id,
    name: id,
    roles: players.map((p, i) => ({
      roleId: `${id}-r${i}`,
      roleName: "r",
      playerId: p,
      playerName: p,
      hasUniqueness: false,
      isMandatory: false,
    })),
    hasSpanningUniqueness: false,
  };
}

function pos(
  id: string,
  x: number,
  y: number,
  objectTypeKind: "entity" | "value" = "entity",
): PositionedObjectTypeNode {
  return { kind: "object_type", id, name: id, objectTypeKind, x, y, width: 100, height: 60 };
}

function graphOf(nodes: GraphNode[]): OrmGraph {
  return { nodes, edges: [], constraintEdges: [], subtypeEdges: [] };
}

describe("buildConnectionCounts", () => {
  it("counts the distinct fact types each entity participates in", () => {
    const graph = graphOf([
      { kind: "object_type", id: "A", name: "A", objectTypeKind: "entity" },
      { kind: "object_type", id: "B", name: "B", objectTypeKind: "entity" },
      fact("f1", ["A", "B"]),
      fact("f2", ["A", "B"]),
    ]);
    const counts = buildConnectionCounts(graph);
    expect(counts.get("A")).toBe(2);
    expect(counts.get("B")).toBe(2);
  });
});

describe("placeSubtypesRadially", () => {
  it("moves a leaf subtype to the arc radius from its supertype", () => {
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["super", pos("super", 300, 0)],
      ["sub", pos("sub", 0, 0)],
    ]);
    placeSubtypesRadially(
      positions,
      [{ subtypeNodeId: "sub", supertypeNodeId: "super" }],
      new Map([["super", 3], ["sub", 0]]),
    );

    const sup = positions.get("super")!;
    const sub = positions.get("sub")!;
    const dist = Math.hypot(
      (sub.x + sub.width / 2) - (sup.x + sup.width / 2),
      (sub.y + sub.height / 2) - (sup.y + sup.height / 2),
    );
    expect(dist).toBeCloseTo(180); // ARC_RADIUS
  });

  it("leaves a more-connected subtype where ELK placed it", () => {
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["super", pos("super", 300, 0)],
      ["sub", pos("sub", 0, 0)],
    ]);
    const before = { ...positions.get("sub")! };
    placeSubtypesRadially(
      positions,
      [{ subtypeNodeId: "sub", supertypeNodeId: "super" }],
      new Map([["super", 1], ["sub", 5]]),
    );
    expect(positions.get("sub")).toEqual(before);
  });

  it("does nothing when there are no positioned entities to center a fan on", () => {
    const positions = new Map<string, PositionedObjectTypeNode>();
    // Must not throw when dividing by a zero entity count.
    expect(() =>
      placeSubtypesRadially(
        positions,
        [{ subtypeNodeId: "sub", supertypeNodeId: "super" }],
        new Map(),
      )
    ).not.toThrow();
    expect(positions.size).toBe(0);
  });

  it("skips a subtype fan whose supertype was never positioned", () => {
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["other", pos("other", 0, 0)],
    ]);
    placeSubtypesRadially(
      positions,
      [{ subtypeNodeId: "sub", supertypeNodeId: "missing-super" }],
      new Map(),
    );
    // Nothing to fan around, and nothing was added for the missing pair.
    expect(positions.has("sub")).toBe(false);
    expect(positions.size).toBe(1);
  });

  it("skips a single subtype that itself was never positioned", () => {
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["super", pos("super", 300, 0)],
    ]);
    placeSubtypesRadially(
      positions,
      [{ subtypeNodeId: "missing-sub", supertypeNodeId: "super" }],
      new Map(),
    );
    // The supertype itself is untouched, and the missing subtype was never added.
    expect(positions.get("super")).toEqual(pos("super", 300, 0));
    expect(positions.has("missing-sub")).toBe(false);
  });

  it("skips an unpositioned subtype within a multi-subtype fan, placing the rest", () => {
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["super", pos("super", 300, 0)],
      ["sub1", pos("sub1", 0, 0)],
      // "sub2" is one of two fanned subtypes but was never positioned by ELK.
    ]);
    placeSubtypesRadially(
      positions,
      [
        { subtypeNodeId: "sub1", supertypeNodeId: "super" },
        { subtypeNodeId: "sub2", supertypeNodeId: "super" },
      ],
      new Map(),
    );

    expect(positions.has("sub2")).toBe(false);
    // sub1 still got fanned out to the arc radius.
    const sup = positions.get("super")!;
    const sub1 = positions.get("sub1")!;
    const dist = Math.hypot(
      (sub1.x + sub1.width / 2) - (sup.x + sup.width / 2),
      (sub1.y + sub1.height / 2) - (sup.y + sup.height / 2),
    );
    expect(dist).toBeCloseTo(180); // ARC_RADIUS
  });
});

describe("alignLeafValueTypes", () => {
  it("snaps a single leaf value type onto its hub's axis", () => {
    const graph = graphOf([
      { kind: "object_type", id: "hub", name: "Hub", objectTypeKind: "entity" },
      { kind: "object_type", id: "leaf", name: "Leaf", objectTypeKind: "value" },
      fact("f1", ["hub", "leaf"]),
    ]);
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["hub", pos("hub", 0, 0)],
      ["leaf", pos("leaf", 200, 50, "value")],
    ]);
    alignLeafValueTypes(graph, positions);

    const hub = positions.get("hub")!;
    const leaf = positions.get("leaf")!;
    // Horizontally dominant separation snaps the leaf's y to the hub's.
    expect(leaf.y + leaf.height / 2).toBeCloseTo(hub.y + hub.height / 2);
  });

  it("skips a leaf value type whose hub entity was never positioned", () => {
    const graph = graphOf([
      { kind: "object_type", id: "hub", name: "Hub", objectTypeKind: "entity" },
      { kind: "object_type", id: "leaf", name: "Leaf", objectTypeKind: "value" },
      fact("f1", ["hub", "leaf"]),
    ]);
    // Only the leaf got a position; the hub was filtered out of the layout.
    const positions = new Map<string, PositionedObjectTypeNode>([
      ["leaf", pos("leaf", 200, 50, "value")],
    ]);
    const before = { ...positions.get("leaf")! };

    alignLeafValueTypes(graph, positions);

    expect(positions.get("leaf")).toEqual(before);
  });
});
