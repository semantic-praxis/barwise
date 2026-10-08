/**
 * viewMembership / containedRelations: the one rule for which elements a
 * saved view draws (docs/specs/norma-export-view-scope.spec.md).
 */
import { describe, expect, it } from "vitest";
import {
  absorbedReferenceModes,
  containedRelations,
  pureObjectifyingEntityIds,
  viewMembership,
} from "../../src/model/diagramView.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/** Person <- Employee subtype; Person works for Company; Company is listed. */
function model() {
  return new ModelBuilder("Org")
    .withEntityType("Person", { referenceMode: "person_id" })
    .withEntityType("Employee", { referenceMode: "person_id" })
    .withEntityType("Company", { referenceMode: "company_id" })
    .withSubtypeFact("Employee", "Person")
    .withBinaryFactType("Person works for Company", {
      role1: { player: "Person", name: "works for" },
      role2: { player: "Company", name: "employs" },
    })
    .build();
}

describe("viewMembership", () => {
  it("draws everything for a show-all view", () => {
    const m = model();
    const all = viewMembership(m, { name: "All", positions: {}, orientations: {} });
    expect(all.objectTypeIds.size).toBe(3);
    expect(all.factTypeIds.size).toBe(m.factTypes.length);
    expect(all.subtypeFactIds.size).toBe(1);
  });

  it("draws a scoped view's object types and only the relations they fully contain", () => {
    const m = model();
    const person = m.getObjectTypeByName("Person")!.id;
    const employee = m.getObjectTypeByName("Employee")!.id;
    const v = viewMembership(m, {
      name: "People",
      elements: [person, employee, "ot-gone"],
      positions: { [m.getObjectTypeByName("Company")!.id]: { x: 0, y: 0 } },
      orientations: {},
    });
    // A missing id is skipped; a position outside the view adds nothing;
    // Person works for Company reaches outside, so it is not drawn.
    expect([...v.objectTypeIds].sort()).toEqual([person, employee].sort());
    expect([...v.factTypeIds]).toEqual([]);
    expect([...v.subtypeFactIds]).toEqual([m.subtypeFacts[0]!.id]);
  });

  it("draws nothing for an empty view", () => {
    const v = viewMembership(model(), { name: "E", elements: [], positions: {}, orientations: {} });
    expect([v.objectTypeIds.size, v.factTypeIds.size, v.subtypeFactIds.size]).toEqual([0, 0, 0]);
  });
});

describe("containedRelations", () => {
  it("takes a fact type only when every player is in the set", () => {
    const m = model();
    const ids = new Set([
      m.getObjectTypeByName("Person")!.id,
      m.getObjectTypeByName("Company")!.id,
    ]);
    const r = containedRelations(m, ids);
    expect([...r.factTypeIds]).toEqual([m.getFactTypeByName("Person works for Company")!.id]);
    expect([...r.subtypeFactIds]).toEqual([]);
  });
});

describe("absorbedReferenceModes", () => {
  function refModel(extraRole: boolean) {
    const m = new OrmModel({ name: "R" });
    m.addObjectType({ id: "ot-c", name: "Customer", kind: "entity", referenceMode: "customer_id" });
    m.addObjectType({ id: "vt-id", name: "Customer_id", kind: "value" });
    m.addFactType({
      id: "ft-id",
      name: "Customer has Customer_id",
      roles: [
        { id: "r1", name: "has", playerId: "ot-c" },
        { id: "r2", name: "is of", playerId: "vt-id" },
      ],
      readings: ["{0} has {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r2"], isPreferred: true }],
    });
    if (extraRole) {
      m.addFactType({
        id: "ft-other",
        name: "Customer_id is legacy",
        roles: [{ id: "r3", name: "is legacy", playerId: "vt-id" }],
        readings: ["{0} is legacy"],
      });
    }
    return m;
  }

  it("folds the identifying value type and fact type into the entity", () => {
    const a = absorbedReferenceModes(refModel(false));
    expect([...a.valueTypeIds]).toEqual(["vt-id"]);
    expect([...a.factTypeIds]).toEqual(["ft-id"]);
  });

  it("keeps a value type drawn when it plays another role, still folding the fact type", () => {
    const a = absorbedReferenceModes(refModel(true));
    expect([...a.valueTypeIds]).toEqual([]);
    expect([...a.factTypeIds]).toEqual(["ft-id"]);
  });
});

describe("pureObjectifyingEntityIds", () => {
  it("hides an objectifying entity only while it plays no role", () => {
    const m = model();
    const ft = m.getFactTypeByName("Person works for Company")!;
    m.addObjectType({ id: "ot-job", name: "Job", kind: "entity", referenceMode: "job_id" });
    m.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: "ot-job" });
    expect([...pureObjectifyingEntityIds(m)]).toEqual(["ot-job"]);
    m.addFactType({
      id: "ft-job",
      name: "Job is open",
      roles: [{ id: "rj", name: "is open", playerId: "ot-job" }],
      readings: ["{0} is open"],
    });
    expect([...pureObjectifyingEntityIds(m)]).toEqual([]);
  });
});
