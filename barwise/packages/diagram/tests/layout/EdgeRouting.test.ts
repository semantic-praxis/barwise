/**
 * Unit tests for the pure routing geometry extracted from the layout
 * engine: ray/rectangle and ray/ellipse border intersection, the
 * role-connection-point convention, and the viewBox bounds. No ELK, no
 * model -- plain geometry, tested directly. The route* functions stay
 * covered by the layoutGraph integration tests in ElkLayoutEngine.test.
 */
import { describe, expect, it } from "vitest";
import {
  computeBounds,
  ellipseBorderIntersection,
  entityBorderPoint,
  rectBorderIntersection,
  roleConnectionPoint,
} from "../../src/layout/EdgeRouting.js";
import type {
  PositionedFactTypeNode,
  PositionedNode,
  PositionedObjectTypeNode,
  PositionedRoleBox,
} from "../../src/layout/LayoutTypes.js";

function role(roleId: string, x: number, y: number): PositionedRoleBox {
  return {
    roleId,
    roleName: roleId,
    playerName: "P",
    hasUniqueness: false,
    isMandatory: false,
    x,
    y,
    width: 40,
    height: 24,
  };
}

function horizontalFact(roles: PositionedRoleBox[]): PositionedFactTypeNode {
  return {
    kind: "fact_type",
    id: "ft",
    name: "ft",
    roles,
    hasSpanningUniqueness: false,
    orientation: "horizontal",
    x: 0,
    y: 0,
    width: roles.length * 40,
    height: 24,
  };
}

function entity(objectTypeKind: "entity" | "value"): PositionedObjectTypeNode {
  return {
    kind: "object_type",
    id: "ot",
    name: "OT",
    objectTypeKind,
    x: 0,
    y: 0,
    width: 100,
    height: 60,
  };
}

describe("rectBorderIntersection", () => {
  it("hits the right edge for a rightward ray", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const p = rectBorderIntersection({ x: 50, y: 50 }, { x: 1000, y: 50 }, rect);
    expect(p).toEqual({ x: 100, y: 50 });
  });

  it("hits the corner for a 45-degree ray", () => {
    const rect = { x: 0, y: 0, width: 100, height: 100 };
    const p = rectBorderIntersection({ x: 50, y: 50 }, { x: 1050, y: 1050 }, rect);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(100);
  });

  it("returns the center when direction is zero", () => {
    const rect = { x: 0, y: 0, width: 80, height: 40 };
    const p = rectBorderIntersection({ x: 5, y: 5 }, { x: 5, y: 5 }, rect);
    expect(p).toEqual({ x: 40, y: 20 });
  });
});

describe("ellipseBorderIntersection", () => {
  it("intersects along the major axis", () => {
    const p = ellipseBorderIntersection({ x: 0, y: 0 }, { x: 10, y: 0 }, 0, 0, 100, 50);
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(0);
  });

  it("intersects along the minor axis", () => {
    const p = ellipseBorderIntersection({ x: 0, y: 0 }, { x: 0, y: -10 }, 0, 0, 100, 50);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(-50);
  });
});

describe("roleConnectionPoint", () => {
  it("connects a binary horizontal fact's roles at the outer edges", () => {
    const r0 = role("r0", 0, 0);
    const r1 = role("r1", 40, 0);
    const ft = horizontalFact([r0, r1]);
    expect(roleConnectionPoint(ft, r0)).toEqual({ x: 0, y: 12 });
    expect(roleConnectionPoint(ft, r1)).toEqual({ x: 80, y: 12 });
  });

  it("connects a ternary fact's middle role at its center", () => {
    const r0 = role("r0", 0, 0);
    const r1 = role("r1", 40, 0);
    const r2 = role("r2", 80, 0);
    const ft = horizontalFact([r0, r1, r2]);
    expect(roleConnectionPoint(ft, r1)).toEqual({ x: 60, y: 12 });
  });

  it("connects a vertical fact's first role at its top edge", () => {
    const r0 = role("r0", 0, 0);
    const r1 = role("r1", 0, 40);
    const ft: PositionedFactTypeNode = {
      ...horizontalFact([r0, r1]),
      orientation: "vertical",
      width: 24,
      height: 80,
    };
    expect(roleConnectionPoint(ft, r0)).toEqual({ x: 20, y: 0 });
  });
});

describe("entityBorderPoint", () => {
  it("lands on the rectangle border for an entity type", () => {
    const p = entityBorderPoint(entity("entity"), { x: 1000, y: 1000 });
    const nx = Math.abs(p.x - 50) / 50;
    const ny = Math.abs(p.y - 30) / 30;
    expect(Math.max(nx, ny)).toBeCloseTo(1);
  });

  it("lands on the ellipse for a value type", () => {
    const p = entityBorderPoint(entity("value"), { x: 1000, y: 1000 });
    const ex = (p.x - 50) / 50;
    const ey = (p.y - 30) / 30;
    expect(ex * ex + ey * ey).toBeCloseTo(1);
  });
});

describe("computeBounds", () => {
  it("returns a default canvas for an empty graph", () => {
    const bounds = computeBounds([], [], []);
    expect(bounds).toEqual({ originX: 0, originY: 0, width: 800, height: 600 });
  });

  it("pads the bounding box around a single node", () => {
    const node: PositionedNode = {
      kind: "object_type",
      id: "e",
      name: "E",
      objectTypeKind: "entity",
      x: 100,
      y: 100,
      width: 50,
      height: 40,
    };
    const bounds = computeBounds([node], [], []);
    expect(bounds).toEqual({ originX: 60, originY: 60, width: 130, height: 120 });
  });
});
