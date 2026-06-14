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

  it("all positioned fact types have orientation field", async () => {
    const result = await layoutGraph(makeBinaryGraph());
    for (const node of result.nodes) {
      if (node.kind === "fact_type") {
        expect(node.orientation).toMatch(/^(horizontal|vertical)$/);
      }
    }
  });
});
