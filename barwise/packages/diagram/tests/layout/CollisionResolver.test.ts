/**
 * Unit tests for the pure collision/normalization pass extracted from
 * the layout engine: decoration-aware bounding boxes, coordinate
 * normalization, and overlap separation along the minimum-translation
 * axis. No ELK, no model.
 */
import { describe, expect, it } from "vitest";
import {
  effectiveBoundingBox,
  normalizeCoordinates,
  resolveOverlaps,
} from "../../src/layout/CollisionResolver.js";
import type {
  PositionedFactTypeNode,
  PositionedNode,
  PositionedObjectTypeNode,
  PositionedRoleBox,
} from "../../src/layout/LayoutTypes.js";

function entityNode(id: string, x: number, y: number): PositionedObjectTypeNode {
  return {
    kind: "object_type",
    id,
    name: id,
    objectTypeKind: "entity",
    x,
    y,
    width: 100,
    height: 60,
  };
}

/** A horizontal binary fact whose single role optionally carries a uniqueness bar. */
function factNode(hasUniqueness: boolean): PositionedFactTypeNode {
  const roles: PositionedRoleBox[] = [{
    roleId: "r0",
    roleName: "r0",
    playerName: "P",
    hasUniqueness,
    isMandatory: false,
    x: 0,
    y: 0,
    width: 40,
    height: 24,
  }];
  return {
    kind: "fact_type",
    id: "ft",
    name: "ft",
    roles,
    hasSpanningUniqueness: false,
    orientation: "horizontal",
    x: 0,
    y: 0,
    width: 40,
    height: 24,
  };
}

describe("effectiveBoundingBox", () => {
  it("pads an entity node by the minimum gap on every side", () => {
    const box = effectiveBoundingBox(entityNode("e", 0, 0));
    expect(box).toEqual({ nodeId: "e", x: -30, y: -30, width: 160, height: 120 });
  });

  it("expands a fact type's box for a uniqueness bar", () => {
    const plain = effectiveBoundingBox(factNode(false));
    const decorated = effectiveBoundingBox(factNode(true));
    // The uniqueness bar extends above the role strip, so the decorated
    // box is taller and starts higher.
    expect(decorated.height).toBeGreaterThan(plain.height);
    expect(decorated.y).toBeLessThan(plain.y);
  });
});

describe("normalizeCoordinates", () => {
  it("shifts negative coordinates to a positive padding offset", () => {
    const node = entityNode("e", -100, -100);
    normalizeCoordinates([node]);
    // Effective box starts 30px before the node; normalization puts the
    // box's min at padding 40, so the node lands at 70.
    expect(node.x).toBe(70);
    expect(node.y).toBe(70);
  });

  it("leaves already-normalized coordinates untouched", () => {
    const node = entityNode("e", 70, 70);
    normalizeCoordinates([node]);
    expect(node.x).toBe(70);
    expect(node.y).toBe(70);
  });
});

describe("resolveOverlaps", () => {
  it("separates two coincident nodes until they no longer overlap", () => {
    const a = entityNode("a", 0, 0);
    const b = entityNode("b", 0, 0);
    resolveOverlaps([a, b]);

    const nodes: PositionedNode[] = [a, b];
    const [first, second] = nodes;
    // The base 100x60 boxes must end up disjoint on some axis.
    const apart = Math.abs(first!.x - second!.x) >= 100
      || Math.abs(first!.y - second!.y) >= 60;
    expect(apart).toBe(true);
  });
});
