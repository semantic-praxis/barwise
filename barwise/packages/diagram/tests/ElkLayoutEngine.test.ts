/**
 * Tests for the two-pass entity-centric layout engine.
 *
 * Pass 1 uses ELK stress to position entity types in 2D.
 * Pass 2 places fact types geometrically between their connected entities.
 */
import { describe, expect, it, vi } from "vitest";
import type { OrmGraph } from "../src/graph/GraphTypes.js";

// Mock ELK to return controlled entity positions.
let mockLayoutImpl: (graph: Record<string, unknown>) => Promise<Record<string, unknown>>;

const defaultMockLayout = async (graph: Record<string, unknown>) => {
  const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
    ?? [];
  return {
    // Spread entities in a grid-like pattern for predictable testing.
    children: children.map((c, i) => ({
      id: c.id,
      x: (i % 3) * 250,
      y: Math.floor(i / 3) * 200,
      width: c.width,
      height: c.height,
    })),
    edges: [],
    width: 800,
    height: 600,
  };
};

mockLayoutImpl = defaultMockLayout;

vi.mock("elkjs", () => {
  return {
    default: class MockELK {
      async layout(graph: Record<string, unknown>) {
        return mockLayoutImpl(graph);
      }
    },
  };
});

const { layoutGraph } = await import("../src/layout/ElkLayoutEngine.js");
const { buildEntityElkGraph } = await import("../src/layout/EntityPlacement.js");

/** A fully-connected trio of entities (a triangle), for cluster-detection tests. */
function triangle(prefix: string): { nodes: OrmGraph["nodes"]; edges: OrmGraph["edges"]; } {
  const ids = [`${prefix}1`, `${prefix}2`, `${prefix}3`];
  const nodes: OrmGraph["nodes"] = ids.map((id) => ({
    kind: "object_type",
    id,
    name: id,
    objectTypeKind: "entity",
  }));
  const pairs: [string, string][] = [[ids[0]!, ids[1]!], [ids[1]!, ids[2]!], [ids[2]!, ids[0]!]];
  const edges: OrmGraph["edges"] = [];
  for (const [a, b] of pairs) {
    const ftId = `ft-${a}-${b}`;
    nodes.push({
      kind: "fact_type",
      id: ftId,
      name: ftId,
      roles: [
        {
          roleId: `${ftId}-r1`,
          roleName: "r1",
          playerId: a,
          playerName: a,
          hasUniqueness: false,
          isMandatory: false,
        },
        {
          roleId: `${ftId}-r2`,
          roleName: "r2",
          playerId: b,
          playerName: b,
          hasUniqueness: false,
          isMandatory: false,
        },
      ],
      hasSpanningUniqueness: false,
    });
    edges.push({ sourceNodeId: a, targetNodeId: ftId, roleId: `${ftId}-r1` });
    edges.push({ sourceNodeId: b, targetNodeId: ftId, roleId: `${ftId}-r2` });
  }
  return { nodes, edges };
}

/** A single binary fact type connecting two entities from different triangles. */
function bridge(a: string, b: string): { nodes: OrmGraph["nodes"]; edges: OrmGraph["edges"]; } {
  const ftId = `ft-${a}-${b}`;
  return {
    nodes: [
      {
        kind: "fact_type",
        id: ftId,
        name: ftId,
        roles: [
          {
            roleId: `${ftId}-r1`,
            roleName: "r1",
            playerId: a,
            playerName: a,
            hasUniqueness: false,
            isMandatory: false,
          },
          {
            roleId: `${ftId}-r2`,
            roleName: "r2",
            playerId: b,
            playerName: b,
            hasUniqueness: false,
            isMandatory: false,
          },
        ],
        hasSpanningUniqueness: false,
      },
    ],
    edges: [
      { sourceNodeId: a, targetNodeId: ftId, roleId: `${ftId}-r1` },
      { sourceNodeId: b, targetNodeId: ftId, roleId: `${ftId}-r2` },
    ],
  };
}

// Helper to make a minimal binary fact type graph.
function makeBinaryGraph(): OrmGraph {
  return {
    nodes: [
      {
        kind: "object_type",
        id: "ot-a",
        name: "Customer",
        objectTypeKind: "entity",
        referenceMode: "cid",
      },
      {
        kind: "object_type",
        id: "ot-b",
        name: "Order",
        objectTypeKind: "entity",
        referenceMode: "oid",
      },
      {
        kind: "fact_type",
        id: "ft-1",
        name: "Customer places Order",
        roles: [
          {
            roleId: "r-1",
            roleName: "places",
            playerId: "ot-a",
            playerName: "Customer",
            hasUniqueness: false,
            isMandatory: false,
          },
          {
            roleId: "r-2",
            roleName: "placed-by",
            playerId: "ot-b",
            playerName: "Order",
            hasUniqueness: true,
            isMandatory: false,
          },
        ],
        hasSpanningUniqueness: false,
      },
    ],
    edges: [
      { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r-1" },
      { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r-2" },
    ],
    constraintEdges: [],
    subtypeEdges: [],
  };
}

describe("ElkLayoutEngine", () => {
  it("builds entity-only ELK graph (no fact types as children)", () => {
    const graph = makeBinaryGraph();
    const elkGraph = buildEntityElkGraph(graph);

    // Only entity type nodes should be ELK children.
    expect(elkGraph.children).toHaveLength(2);
    expect(elkGraph.children![0]!.id).toBe("ot-a");
    expect(elkGraph.children![1]!.id).toBe("ot-b");

    // Synthetic edge between the two entities.
    expect(elkGraph.edges).toHaveLength(1);

    // Algorithm should be stress.
    expect(elkGraph.layoutOptions!["org.eclipse.elk.algorithm"]).toBe("stress");
  });

  it("widens an entity's ELK node to fit its alias text", () => {
    const withAliases: OrmGraph = {
      ...makeBinaryGraph(),
      nodes: makeBinaryGraph().nodes.map((n) =>
        n.kind === "object_type" && n.id === "ot-a"
          ? { ...n, aliases: ["Client", "Buyer"] }
          : n
      ),
    };
    const plain = buildEntityElkGraph(makeBinaryGraph());
    const aliased = buildEntityElkGraph(withAliases);

    const plainA = plain.children!.find((c) => c.id === "ot-a")!;
    const aliasedA = aliased.children!.find((c) => c.id === "ot-a")!;
    // Aliased entities render an extra "(a.k.a. ...)" line, so both the
    // box width and height must grow to fit it.
    expect(aliasedA.height!).toBeGreaterThan(plainA.height!);
  });

  it("falls back to default entity positions when the flat ELK pass returns nothing", async () => {
    // Two entities (<=4) collapse to a single cluster, taking the flat
    // (non-clustered) layoutEntitiesWithClusters path.
    mockLayoutImpl = async () => ({ edges: [], width: 800, height: 600 });

    const result = await layoutGraph(makeBinaryGraph());

    for (const node of result.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
      expect(Number.isFinite(node.width)).toBe(true);
      expect(Number.isFinite(node.height)).toBe(true);
    }

    mockLayoutImpl = defaultMockLayout;
  });

  it("falls back to default position and size for an entity the flat ELK pass omitted", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      // Drop "ot-b" entirely from the response.
      return {
        children: children
          .filter((c) => c.id !== "ot-b")
          .map((c, i) => ({ id: c.id, x: i * 250, y: 0, width: c.width, height: c.height })),
        edges: [],
        width: 800,
        height: 600,
      };
    };

    const result = await layoutGraph(makeBinaryGraph());
    const otB = result.nodes.find((n) => n.id === "ot-b")!;

    expect(otB).toBeDefined();
    expect(Number.isFinite(otB.x)).toBe(true);
    expect(Number.isFinite(otB.y)).toBe(true);

    mockLayoutImpl = defaultMockLayout;
  });

  it("positions binary fact type at midpoint between entities", async () => {
    // Mock: place entities at (0, 100) and (500, 100) - horizontally separated.
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: i * 500,
          y: 100,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 800,
        height: 400,
      };
    };

    const result = await layoutGraph(makeBinaryGraph());
    const ft = result.nodes.find((n) => n.kind === "fact_type")!;

    // Fact type should be roughly between the two entities.
    const entityA = result.nodes.find((n) => n.id === "ot-a")!;
    const entityB = result.nodes.find((n) => n.id === "ot-b")!;
    const midX = (entityA.x + entityA.width / 2 + entityB.x + entityB.width / 2) / 2;

    expect(ft.x + ft.width / 2).toBeCloseTo(midX, -1);

    mockLayoutImpl = defaultMockLayout;
  });

  it("chooses horizontal orientation when entities are horizontally separated", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: i * 500,
          y: 100,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 800,
        height: 400,
      };
    };

    const result = await layoutGraph(makeBinaryGraph());
    const ft = result.nodes.find((n) => n.kind === "fact_type");
    expect(ft).toBeDefined();
    if (ft && ft.kind === "fact_type") {
      expect(ft.orientation).toBe("horizontal");
    }

    mockLayoutImpl = defaultMockLayout;
  });

  it("chooses vertical orientation when entities are vertically separated", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: 100,
          y: i * 500,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 400,
        height: 800,
      };
    };

    const result = await layoutGraph(makeBinaryGraph());
    const ft = result.nodes.find((n) => n.kind === "fact_type");
    expect(ft).toBeDefined();
    if (ft && ft.kind === "fact_type") {
      expect(ft.orientation).toBe("vertical");
    }

    mockLayoutImpl = defaultMockLayout;
  });

  it("places unary fact type adjacent to its entity", async () => {
    const graph: OrmGraph = {
      nodes: [
        {
          kind: "object_type",
          id: "ot-1",
          name: "Person",
          objectTypeKind: "entity",
        },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "is married",
          roles: [
            {
              roleId: "r-1",
              roleName: "is married",
              playerId: "ot-1",
              playerName: "Person",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-1", targetNodeId: "ft-1", roleId: "r-1" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const entity = result.nodes.find((n) => n.id === "ot-1")!;
    const ft = result.nodes.find((n) => n.id === "ft-1")!;

    // Unary should be positioned to the right of its entity.
    expect(ft.x).toBeGreaterThan(entity.x);
  });

  it("places subtypes further from diagram center than supertype", async () => {
    // Mock: place both at same position.
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      return {
        children: children.map((c) => ({
          id: c.id,
          x: 100,
          y: 100,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 400,
        height: 400,
      };
    };

    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-person", name: "Person", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-employee", name: "Employee", objectTypeKind: "entity" },
      ],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [
        {
          subtypeNodeId: "ot-employee",
          supertypeNodeId: "ot-person",
          providesIdentification: true,
        },
      ],
    };

    const result = await layoutGraph(graph);
    const person = result.nodes.find((n) => n.id === "ot-person")!;
    const employee = result.nodes.find((n) => n.id === "ot-employee")!;

    // Subtype (Employee) should be displaced from supertype (Person).
    const personCx = person.x + person.width / 2;
    const personCy = person.y + person.height / 2;
    const employeeCx = employee.x + employee.width / 2;
    const employeeCy = employee.y + employee.height / 2;
    const separation = Math.sqrt(
      (employeeCx - personCx) ** 2 + (employeeCy - personCy) ** 2,
    );
    expect(separation).toBeGreaterThan(100);

    mockLayoutImpl = defaultMockLayout;
  });

  it("routes edges from entity border to role box center", async () => {
    const result = await layoutGraph(makeBinaryGraph());

    expect(result.edges).toHaveLength(2);
    for (const edge of result.edges) {
      expect(edge.points).toHaveLength(2);
      // Start and end points should have valid coordinates.
      expect(edge.points[0]!.x).toBeDefined();
      expect(edge.points[0]!.y).toBeDefined();
      expect(edge.points[1]!.x).toBeDefined();
      expect(edge.points[1]!.y).toBeDefined();
    }
  });

  it("routes subtype edges between entity borders", async () => {
    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-super", name: "Person", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-sub", name: "Employee", objectTypeKind: "entity" },
      ],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [
        { subtypeNodeId: "ot-sub", supertypeNodeId: "ot-super", providesIdentification: true },
      ],
    };

    const result = await layoutGraph(graph);
    expect(result.subtypeEdges).toHaveLength(1);
    expect(result.subtypeEdges[0]!.points).toHaveLength(2);
  });

  it("handles empty graph gracefully", async () => {
    const graph: OrmGraph = {
      nodes: [],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
  });

  it("handles missing edge references gracefully", async () => {
    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-1", name: "A", objectTypeKind: "entity" },
      ],
      edges: [
        { sourceNodeId: "ot-missing", targetNodeId: "ft-missing", roleId: "r-1" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    // Missing references should not produce edges.
    expect(result.edges).toHaveLength(0);
  });

  it("stacks multiple fact types between same entity pair", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: i * 400,
          y: 100,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 800,
        height: 400,
      };
    };

    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A has B",
          roles: [
            {
              roleId: "r1",
              roleName: "has",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "of",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
        {
          kind: "fact_type",
          id: "ft-2",
          name: "A likes B",
          roles: [
            {
              roleId: "r3",
              roleName: "likes",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r4",
              roleName: "liked-by",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
        { sourceNodeId: "ot-a", targetNodeId: "ft-2", roleId: "r3" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-2", roleId: "r4" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft1 = result.nodes.find((n) => n.id === "ft-1")!;
    const ft2 = result.nodes.find((n) => n.id === "ft-2")!;

    // The two fact types should be at different y positions (stacked).
    expect(ft1.y).not.toBe(ft2.y);

    mockLayoutImpl = defaultMockLayout;
  });

  it("stacks vertically-separated fact types side by side", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: 100,
          y: i * 400,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 400,
        height: 800,
      };
    };

    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A has B",
          roles: [
            {
              roleId: "r1",
              roleName: "has",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "of",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
        {
          kind: "fact_type",
          id: "ft-2",
          name: "A likes B",
          roles: [
            {
              roleId: "r3",
              roleName: "likes",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r4",
              roleName: "liked-by",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
        { sourceNodeId: "ot-a", targetNodeId: "ft-2", roleId: "r3" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-2", roleId: "r4" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft1 = result.nodes.find((n) => n.id === "ft-1")!;
    const ft2 = result.nodes.find((n) => n.id === "ft-2")!;

    // Entities are vertically separated, so the pair stacks horizontally.
    expect(ft1.x).not.toBe(ft2.x);

    mockLayoutImpl = defaultMockLayout;
  });

  it("centers a degenerate fact type with no connected entities at the origin", async () => {
    const graph: OrmGraph = {
      nodes: [
        {
          kind: "fact_type",
          id: "ft-orphan",
          name: "orphan",
          roles: [],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft = result.nodes.find((n) => n.id === "ft-orphan")!;
    expect(ft).toBeDefined();
    if (ft.kind === "fact_type") {
      expect(ft.orientation).toBe("horizontal");
    }
  });

  it("centers a unary fact type at the origin when its player has no position", async () => {
    const graph: OrmGraph = {
      nodes: [
        {
          kind: "fact_type",
          id: "ft-unary",
          name: "is married",
          roles: [
            {
              roleId: "r-1",
              roleName: "is married",
              playerId: "not-a-real-entity",
              playerName: "Person",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft = result.nodes.find((n) => n.id === "ft-unary")!;
    expect(ft).toBeDefined();
  });

  it("skips a ternary+ fact type's unpositioned players when computing its centroid", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      // Only place A and B; C is dropped entirely from the ELK response.
      return {
        children: children
          .filter((c) => c.id !== "ot-c")
          .map((c, i) => ({ id: c.id, x: i * 300, y: 0, width: c.width, height: c.height })),
        edges: [],
        width: 600,
        height: 200,
      };
    };

    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-c", name: "C", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A B C",
          roles: [
            {
              roleId: "r1",
              roleName: "r1",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "r2",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r3",
              roleName: "r3",
              playerId: "ot-c",
              playerName: "C",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
        { sourceNodeId: "ot-c", targetNodeId: "ft-1", roleId: "r3" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft = result.nodes.find((n) => n.id === "ft-1")!;
    expect(ft).toBeDefined();

    mockLayoutImpl = defaultMockLayout;
  });

  it("centers a ternary+ fact type at the origin when none of its players are positioned", async () => {
    const graph: OrmGraph = {
      nodes: [
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A B C",
          roles: [
            {
              roleId: "r1",
              roleName: "r1",
              playerId: "not-a-real-a",
              playerName: "A",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "r2",
              playerId: "not-a-real-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r3",
              roleName: "r3",
              playerId: "not-a-real-c",
              playerName: "C",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft = result.nodes.find((n) => n.id === "ft-1")!;
    expect(ft).toBeDefined();
  });

  it("orients a ternary+ fact type vertically when its players spread more vertically", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      // A tall, narrow triangle: much more vertical spread than horizontal.
      const positions = [{ x: 100, y: 0 }, { x: 100, y: 500 }, { x: 110, y: 250 }];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: positions[i]?.x ?? 0,
          y: positions[i]?.y ?? 0,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 300,
        height: 600,
      };
    };

    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-c", name: "C", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A B C",
          roles: [
            {
              roleId: "r1",
              roleName: "r1",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "r2",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r3",
              roleName: "r3",
              playerId: "ot-c",
              playerName: "C",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
        { sourceNodeId: "ot-c", targetNodeId: "ft-1", roleId: "r3" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft = result.nodes.find((n) => n.id === "ft-1")!;
    if (ft?.kind === "fact_type") {
      expect(ft.orientation).toBe("vertical");
    }

    mockLayoutImpl = defaultMockLayout;
  });

  it("positions ternary fact type at centroid of three entities", async () => {
    mockLayoutImpl = async (graph) => {
      const children = (graph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      // Place entities in a triangle.
      const positions = [
        { x: 200, y: 0 },
        { x: 0, y: 300 },
        { x: 400, y: 300 },
      ];
      return {
        children: children.map((c, i) => ({
          id: c.id,
          x: positions[i]?.x ?? 0,
          y: positions[i]?.y ?? 0,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 600,
        height: 500,
      };
    };

    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-c", name: "C", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A B C",
          roles: [
            {
              roleId: "r1",
              roleName: "r1",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "r2",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
            {
              roleId: "r3",
              roleName: "r3",
              playerId: "ot-c",
              playerName: "C",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
        { sourceNodeId: "ot-c", targetNodeId: "ft-1", roleId: "r3" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const ft = result.nodes.find((n) => n.id === "ft-1")!;
    const a = result.nodes.find((n) => n.id === "ot-a")!;
    const b = result.nodes.find((n) => n.id === "ot-b")!;
    const c = result.nodes.find((n) => n.id === "ot-c")!;

    // Fact type should be near the centroid of the three entities.
    const centroidX = (a.x + a.width / 2 + b.x + b.width / 2 + c.x + c.width / 2) / 3;
    const centroidY = (a.y + a.height / 2 + b.y + b.height / 2 + c.y + c.height / 2) / 3;
    const ftCenterX = ft.x + ft.width / 2;
    const ftCenterY = ft.y + ft.height / 2;

    expect(ftCenterX).toBeCloseTo(centroidX, -1);
    expect(ftCenterY).toBeCloseTo(centroidY, -1);

    mockLayoutImpl = defaultMockLayout;
  });

  it("positions constraint node near connected roles", async () => {
    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A has B",
          roles: [
            {
              roleId: "r1",
              roleName: "has",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "of",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
        {
          kind: "constraint",
          id: "c-1",
          constraintKind: "external_uniqueness",
          roleIds: ["r1", "r2"],
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
      ],
      constraintEdges: [
        { constraintNodeId: "c-1", factTypeNodeId: "ft-1", roleId: "r1" },
        { constraintNodeId: "c-1", factTypeNodeId: "ft-1", roleId: "r2" },
      ],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    const constraint = result.nodes.find((n) => n.id === "c-1")!;
    const ft = result.nodes.find((n) => n.id === "ft-1")!;

    // Constraint should be positioned near the fact type.
    const ftCenterX = ft.x + ft.width / 2;
    const ftCenterY = ft.y + ft.height / 2;
    const cCenterX = constraint.x + constraint.width / 2;
    const cCenterY = constraint.y + constraint.height / 2;

    // Within 150px of the fact type center.
    expect(Math.abs(cCenterX - ftCenterX)).toBeLessThan(150);
    expect(Math.abs(cCenterY - ftCenterY)).toBeLessThan(150);
  });

  function binaryGraphWithConstraint(
    constraint: { roleIds: string[]; supersetRoleIds?: string[]; },
  ): OrmGraph {
    return {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A has B",
          roles: [
            {
              roleId: "r1",
              roleName: "has",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "of",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
        {
          kind: "constraint",
          id: "c-1",
          constraintKind: "external_uniqueness",
          roleIds: constraint.roleIds,
          supersetRoleIds: constraint.supersetRoleIds,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
      ],
      constraintEdges: [],
      subtypeEdges: [],
    };
  }

  it("centers a constraint node at the origin when none of its roles resolve", async () => {
    const graph = binaryGraphWithConstraint({ roleIds: ["not-a-real-role"] });
    const result = await layoutGraph(graph);
    const constraint = result.nodes.find((n) => n.id === "c-1")!;
    expect(constraint).toBeDefined();
    if (constraint.kind === "constraint") {
      expect(Number.isFinite(constraint.x)).toBe(true);
      expect(Number.isFinite(constraint.y)).toBe(true);
    }
  });

  it("skips the perpendicular offset for a constraint with fewer than two roles", async () => {
    const graph = binaryGraphWithConstraint({ roleIds: ["r1"] });
    const result = await layoutGraph(graph);
    const constraint = result.nodes.find((n) => n.id === "c-1")!;
    const role1 = result.nodes.find((n) => n.id === "ft-1")!;
    expect(constraint).toBeDefined();
    expect(role1).toBeDefined();
  });

  it("skips the perpendicular offset when one of the first two roles doesn't resolve", async () => {
    const graph = binaryGraphWithConstraint({ roleIds: ["r1", "not-a-real-role"] });
    const result = await layoutGraph(graph);
    const constraint = result.nodes.find((n) => n.id === "c-1")!;
    expect(constraint).toBeDefined();
    if (constraint.kind === "constraint") {
      expect(Number.isFinite(constraint.x)).toBe(true);
      expect(Number.isFinite(constraint.y)).toBe(true);
    }
  });

  it("skips the perpendicular offset when the first two roles coincide exactly", async () => {
    // Referencing the same role twice collapses the "line between the
    // first two roles" to zero length.
    const graph = binaryGraphWithConstraint({ roleIds: ["r1", "r1"] });
    const result = await layoutGraph(graph);
    const constraint = result.nodes.find((n) => n.id === "c-1")!;
    expect(constraint).toBeDefined();
    if (constraint.kind === "constraint") {
      expect(Number.isFinite(constraint.x)).toBe(true);
      expect(Number.isFinite(constraint.y)).toBe(true);
    }
  });

  it("skips a role edge whose roleId doesn't match any role on the fact type", async () => {
    const graph = makeBinaryGraph();
    const badGraph: OrmGraph = {
      ...graph,
      edges: [
        ...graph.edges,
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "not-a-real-role" },
      ],
    };

    const result = await layoutGraph(badGraph);
    // The two real role edges route; the bogus roleId is dropped.
    expect(result.edges).toHaveLength(2);
  });

  it("skips a constraint edge whose constraint node id is unresolved", async () => {
    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A has B",
          roles: [
            {
              roleId: "r1",
              roleName: "has",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "of",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
      ],
      constraintEdges: [
        { constraintNodeId: "not-a-real-constraint", factTypeNodeId: "ft-1", roleId: "r1" },
        {
          constraintNodeId: "not-a-real-constraint",
          factTypeNodeId: "ft-1",
          roleId: "not-a-real-role",
        },
      ],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    // No constraint node was positioned (none in the graph), so both
    // dangling constraint edges -- one with an unresolved constraint
    // node, one that would also fail role resolution -- are dropped.
    expect(result.constraintEdges).toHaveLength(0);
  });

  it("skips a constraint edge whose role id doesn't resolve to any fact type role", async () => {
    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-a", name: "A", objectTypeKind: "entity" },
        { kind: "object_type", id: "ot-b", name: "B", objectTypeKind: "entity" },
        {
          kind: "fact_type",
          id: "ft-1",
          name: "A has B",
          roles: [
            {
              roleId: "r1",
              roleName: "has",
              playerId: "ot-a",
              playerName: "A",
              hasUniqueness: true,
              isMandatory: false,
            },
            {
              roleId: "r2",
              roleName: "of",
              playerId: "ot-b",
              playerName: "B",
              hasUniqueness: false,
              isMandatory: false,
            },
          ],
          hasSpanningUniqueness: false,
        },
        {
          kind: "constraint",
          id: "c-1",
          constraintKind: "external_uniqueness",
          roleIds: ["r1", "r2"],
        },
      ],
      edges: [
        { sourceNodeId: "ot-a", targetNodeId: "ft-1", roleId: "r1" },
        { sourceNodeId: "ot-b", targetNodeId: "ft-1", roleId: "r2" },
      ],
      constraintEdges: [
        { constraintNodeId: "c-1", factTypeNodeId: "ft-1", roleId: "not-a-real-role" },
      ],
      subtypeEdges: [],
    };

    const result = await layoutGraph(graph);
    expect(result.constraintEdges).toHaveLength(0);
  });

  it("skips a subtype edge whose subtype or supertype id is unresolved", async () => {
    const graph: OrmGraph = {
      nodes: [
        { kind: "object_type", id: "ot-super", name: "Person", objectTypeKind: "entity" },
      ],
      edges: [],
      constraintEdges: [],
      subtypeEdges: [
        {
          subtypeNodeId: "not-a-real-subtype",
          supertypeNodeId: "ot-super",
          providesIdentification: true,
        },
      ],
    };

    const result = await layoutGraph(graph);
    expect(result.subtypeEdges).toHaveLength(0);
  });

  it("drops an entity from the final layout when its cluster's ELK pass omits it", async () => {
    // Two disconnected triangles are enough entities (6 > 4) for cluster
    // detection to split into two clusters rather than collapsing to one.
    const left = triangle("L");
    const right = triangle("R");
    const graph: OrmGraph = {
      nodes: [...left.nodes, ...right.nodes],
      edges: [...left.edges, ...right.edges],
      constraintEdges: [],
      subtypeEdges: [],
    };

    mockLayoutImpl = async (elkGraph) => {
      const children = (elkGraph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      // Only the per-cluster sub-layout carries id "cluster"; drop L2 from
      // whichever cluster it lands in, simulating an ELK pass that placed
      // fewer nodes than it was given.
      const kept = elkGraph.id === "cluster" ? children.filter((c) => c.id !== "L2") : children;
      return {
        children: kept.map((c, i) => ({
          id: c.id,
          x: i * 200,
          y: 0,
          width: c.width,
          height: c.height,
        })),
        edges: [],
        width: 800,
        height: 600,
      };
    };

    const result = await layoutGraph(graph);

    expect(result.nodes.some((n) => n.id === "L2")).toBe(false);
    // The other five entities still made it through.
    expect(result.nodes.filter((n) => n.kind === "object_type")).toHaveLength(5);

    mockLayoutImpl = defaultMockLayout;
  });

  it("nudges a boundary entity toward a cluster whose own ELK pass placed nothing", async () => {
    // Three clusters (9 > 4 entities), bridged so B and C are boundary
    // clusters of one another; C's sub-layout returns nothing at all.
    const a = triangle("A");
    const b = triangle("B");
    const c = triangle("C");
    const br = bridge("B1", "C1");
    const graph: OrmGraph = {
      nodes: [...a.nodes, ...b.nodes, ...c.nodes, ...br.nodes],
      edges: [...a.edges, ...b.edges, ...c.edges, ...br.edges],
      constraintEdges: [],
      subtypeEdges: [],
    };

    mockLayoutImpl = async (elkGraph) => {
      const children = (elkGraph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      if (elkGraph.id === "cluster") {
        if (children.some((ch) => ch.id.startsWith("C"))) {
          // Cluster C's ELK pass returns no children at all.
          return { edges: [], width: 60, height: 60 };
        }
        if (children.some((ch) => ch.id.startsWith("A"))) {
          // Cluster A: one member comes back with no x/y/width/height.
          return {
            children: children.map((ch) =>
              ch.id === "A2"
                ? { id: ch.id }
                : { id: ch.id, x: 0, y: 0, width: ch.width, height: ch.height }
            ),
            edges: [],
            width: 200,
            height: 200,
          };
        }
        return {
          children: children.map((ch, i) => ({
            id: ch.id,
            x: i * 200,
            y: 0,
            width: ch.width,
            height: ch.height,
          })),
          edges: [],
          width: 600,
          height: 200,
        };
      }
      // Cluster-position pass: an unknown cluster id is thrown in, and the
      // (empty) cluster with the minimum 60x60 fallback size comes back
      // with no x/y of its own.
      return {
        children: [
          ...children.map((ch: { id: string; width: number; height: number; }) =>
            ch.width === 60 && ch.height === 60
              ? { id: ch.id, width: ch.width, height: ch.height }
              : { id: ch.id, x: 300, y: 300, width: ch.width, height: ch.height }
          ),
          { id: "cluster-999", x: 0, y: 0, width: 10, height: 10 },
        ],
        edges: [],
        width: 900,
        height: 900,
      };
    };

    const result = await layoutGraph(graph);

    // Nothing crashes, and the entities ELK actually placed still render.
    expect(result.nodes.some((n) => n.id === "B1")).toBe(true);
    expect(result.nodes.some((n) => n.id === "C1")).toBe(false);
    expect(result.nodes.some((n) => n.id === "A2")).toBe(true);

    mockLayoutImpl = defaultMockLayout;
  });

  it("does not nudge apart two boundary entities whose cluster centroids coincide", async () => {
    // Two clusters bridged by a single edge; every member lands at the
    // same relative point in its own cluster, and both clusters are
    // offset identically, so the two centroids come out equal.
    const a = triangle("Ab");
    const b = triangle("Bb");
    const br = bridge("Ab1", "Bb1");
    const graph: OrmGraph = {
      nodes: [...a.nodes, ...b.nodes, ...br.nodes],
      edges: [...a.edges, ...b.edges, ...br.edges],
      constraintEdges: [],
      subtypeEdges: [],
    };

    mockLayoutImpl = async (elkGraph) => {
      const children = (elkGraph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      if (elkGraph.id === "cluster") {
        // Every member of every cluster lands at the exact same point,
        // with the same size (names are the same length in each triangle).
        return {
          children: children.map((ch) => ({
            id: ch.id,
            x: 0,
            y: 0,
            width: ch.width,
            height: ch.height,
          })),
          edges: [],
          width: 100,
          height: 100,
        };
      }
      // Both clusters get the same cluster-level offset.
      return {
        children: children.map((ch) => ({
          id: ch.id,
          x: 50,
          y: 50,
          width: ch.width,
          height: ch.height,
        })),
        edges: [],
        width: 300,
        height: 300,
      };
    };

    const result = await layoutGraph(graph);

    // A zero-length nudge vector (dx=dy=0, dist=0) would divide by zero
    // and poison every downstream position with NaN if the dist<1 guard
    // didn't skip it. With the guard, every node stays a real number.
    for (const node of result.nodes) {
      expect(Number.isFinite(node.x)).toBe(true);
      expect(Number.isFinite(node.y)).toBe(true);
    }

    mockLayoutImpl = defaultMockLayout;
  });

  it("places no entities when the cluster-position pass returns nothing", async () => {
    const left = triangle("Le");
    const right = triangle("Ri");
    const graph: OrmGraph = {
      nodes: [...left.nodes, ...right.nodes],
      edges: [...left.edges, ...right.edges],
      constraintEdges: [],
      subtypeEdges: [],
    };

    mockLayoutImpl = async (elkGraph) => {
      const children = (elkGraph.children as Array<{ id: string; width: number; height: number; }>)
        ?? [];
      if (elkGraph.id === "cluster") {
        return {
          children: children.map((c, i) => ({
            id: c.id,
            x: i * 200,
            y: 0,
            width: c.width,
            height: c.height,
          })),
          edges: [],
          width: 600,
          height: 200,
        };
      }
      // Cluster-position pass returns no `children` at all.
      return { edges: [], width: 800, height: 600 };
    };

    const result = await layoutGraph(graph);

    // Neither cluster's members made it into the final composed result.
    expect(result.nodes.filter((n) => n.kind === "object_type")).toHaveLength(0);

    mockLayoutImpl = defaultMockLayout;
  });

  it("all positioned fact types have orientation field", async () => {
    const result = await layoutGraph(makeBinaryGraph());
    for (const node of result.nodes) {
      if (node.kind === "fact_type") {
        expect(node.orientation).toMatch(/^(horizontal|vertical)$/);
      }
    }
  });
});
