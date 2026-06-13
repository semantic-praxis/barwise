import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { computeNeighborhood } from "../../src/graph/NeighborhoodFilter.js";

function buildChainModel(): { model: OrmModel; ids: Record<string, string>; } {
  // A -> B -> C -> D (chain of entities connected by binary fact types)
  const model = new OrmModel({ name: "Chain" });
  const a = model.addObjectType({ name: "A", kind: "entity", referenceMode: "id" });
  const b = model.addObjectType({ name: "B", kind: "entity", referenceMode: "id" });
  const c = model.addObjectType({ name: "C", kind: "entity", referenceMode: "id" });
  const d = model.addObjectType({ name: "D", kind: "entity", referenceMode: "id" });

  const ab = model.addFactType({
    name: "A relates to B",
    roles: [{ name: "r1", playerId: a.id }, { name: "r2", playerId: b.id }],
    readings: ["{0} relates to {1}"],
  });
  const bc = model.addFactType({
    name: "B relates to C",
    roles: [{ name: "r1", playerId: b.id }, { name: "r2", playerId: c.id }],
    readings: ["{0} relates to {1}"],
  });
  const cd = model.addFactType({
    name: "C relates to D",
    roles: [{ name: "r1", playerId: c.id }, { name: "r2", playerId: d.id }],
    readings: ["{0} relates to {1}"],
  });

  return {
    model,
    ids: { a: a.id, b: b.id, c: c.id, d: d.id, ab: ab.id, bc: bc.id, cd: cd.id },
  };
}

describe("computeNeighborhood", () => {
  it("returns only the focus entity at 0 hops", () => {
    const { model, ids } = buildChainModel();
    const n = computeNeighborhood(model, ids.a, 0);
    expect(n.objectTypeIds.size).toBe(1);
    expect(n.objectTypeIds.has(ids.a)).toBe(true);
    expect(n.factTypeIds.size).toBe(0);
  });

  it("returns 1-hop neighbors", () => {
    const { model, ids } = buildChainModel();
    const n = computeNeighborhood(model, ids.a, 1);
    expect(n.objectTypeIds.has(ids.a)).toBe(true);
    expect(n.objectTypeIds.has(ids.b)).toBe(true);
    expect(n.objectTypeIds.has(ids.c)).toBe(false);
    expect(n.factTypeIds.has(ids.ab)).toBe(true);
    expect(n.factTypeIds.has(ids.bc)).toBe(false);
  });

  it("returns 2-hop neighbors", () => {
    const { model, ids } = buildChainModel();
    const n = computeNeighborhood(model, ids.a, 2);
    expect(n.objectTypeIds.has(ids.a)).toBe(true);
    expect(n.objectTypeIds.has(ids.b)).toBe(true);
    expect(n.objectTypeIds.has(ids.c)).toBe(true);
    expect(n.objectTypeIds.has(ids.d)).toBe(false);
    expect(n.factTypeIds.has(ids.ab)).toBe(true);
    expect(n.factTypeIds.has(ids.bc)).toBe(true);
    expect(n.factTypeIds.has(ids.cd)).toBe(false);
  });

  it("returns all entities at sufficient hops", () => {
    const { model, ids } = buildChainModel();
    const n = computeNeighborhood(model, ids.a, 3);
    expect(n.objectTypeIds.size).toBe(4);
    expect(n.factTypeIds.size).toBe(3);
  });

  it("traverses subtype relationships", () => {
    const model = new OrmModel({ name: "SubtypeTest" });
    const parent = model.addObjectType({ name: "Animal", kind: "entity", referenceMode: "id" });
    const child = model.addObjectType({ name: "Dog", kind: "entity", referenceMode: "id" });
    const sf = model.addSubtypeFact({
      subtypeId: child.id,
      supertypeId: parent.id,
      providesIdentification: true,
    });

    const n = computeNeighborhood(model, child.id, 1);
    expect(n.objectTypeIds.has(parent.id)).toBe(true);
    expect(n.subtypeFactIds.has(sf.id)).toBe(true);
  });

  it("traverses subtype relationships from a supertype to its subtypes", () => {
    const model = new OrmModel({ name: "SupertypeTest" });
    const parent = model.addObjectType({ name: "Animal", kind: "entity", referenceMode: "id" });
    const child = model.addObjectType({ name: "Dog", kind: "entity", referenceMode: "id" });
    const sf = model.addSubtypeFact({
      subtypeId: child.id,
      supertypeId: parent.id,
      providesIdentification: true,
    });

    // Focus on the supertype: one hop must reach the subtype (the
    // reverse direction from the subtype-to-supertype traversal).
    const n = computeNeighborhood(model, parent.id, 1);
    expect(n.objectTypeIds.has(child.id)).toBe(true);
    expect(n.subtypeFactIds.has(sf.id)).toBe(true);
  });

  it("handles hub entities (many connections)", () => {
    const model = new OrmModel({ name: "Hub" });
    const hub = model.addObjectType({ name: "Hub", kind: "entity", referenceMode: "id" });
    const spokes: string[] = [];
    for (let i = 0; i < 5; i++) {
      const spoke = model.addObjectType({ name: `Spoke${i}`, kind: "entity", referenceMode: "id" });
      spokes.push(spoke.id);
      model.addFactType({
        name: `Hub connects Spoke${i}`,
        roles: [{ name: "r1", playerId: hub.id }, { name: "r2", playerId: spoke.id }],
        readings: ["{0} connects {1}"],
      });
    }

    const n = computeNeighborhood(model, hub.id, 1);
    expect(n.objectTypeIds.size).toBe(6); // hub + 5 spokes
    expect(n.factTypeIds.size).toBe(5);
  });
});
