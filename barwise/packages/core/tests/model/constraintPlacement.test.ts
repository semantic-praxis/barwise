/**
 * The read API for placement by kind (docs/specs/orm-format-3.spec.md, WS3a):
 * `FactType.internalConstraints`, `OrmModel.constraints`,
 * `OrmModel.constraintsTouching` and `OrmModel.getConstraint`, while storage
 * still nests every constraint under a fact type. The order assertions are
 * the point of the derived list: a reader that moves from walking each fact
 * type's list to `model.constraints` must meet the constraints in the order
 * it met them before.
 */
import { describe, expect, it } from "vitest";
import {
  type Constraint,
  CONSTRAINT_TYPES,
  isExternalConstraint,
  isInternalConstraint,
  requiresLocalRoles,
} from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/**
 * Three fact types around Room: Room is in Building, Room has RoomNumber,
 * Room has Area. The composite key (Building, RoomNumber) is an external
 * uniqueness hosted under the second fact type, as a 2.0 file might nest
 * it, while touching the first and second.
 */
function rooms() {
  const model = new OrmModel({ name: "Facilities" });
  const room = model.addObjectType({
    id: "ot-room",
    name: "Room",
    kind: "entity",
    referenceMode: "id",
  });
  const building = model.addObjectType({
    id: "ot-building",
    name: "Building",
    kind: "entity",
    referenceMode: "code",
  });
  const nr = model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  const area = model.addObjectType({ id: "ot-area", name: "Area", kind: "value" });
  const inBuilding = model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-1", name: "is in", playerId: room.id },
      { id: "r-2", name: "houses", playerId: building.id },
    ],
    readings: ["{0} is in {1}"],
    constraints: [
      { id: "c-one-building", type: "internal_uniqueness", roleIds: ["r-1"] },
      { id: "c-in-mandatory", type: "mandatory", roleId: "r-1" },
    ],
  });
  const hasNumber = model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-3", name: "has", playerId: room.id },
      { id: "r-4", name: "is of", playerId: nr.id },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "c-one-nr", type: "internal_uniqueness", roleIds: ["r-3"] },
      { id: "c-room-key", type: "external_uniqueness", roleIds: ["r-2", "r-4"] },
    ],
  });
  const hasArea = model.addFactType({
    id: "ft-area",
    name: "Room has Area",
    roles: [
      { id: "r-5", name: "has", playerId: room.id },
      { id: "r-6", name: "is of", playerId: area.id },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "c-one-area", type: "internal_uniqueness", roleIds: ["r-5"] },
      // Hosted on the third fact type, spanning the first and third.
      { id: "c-in-or-area", type: "disjunctive_mandatory", roleIds: ["r-1", "r-5"] },
    ],
  });
  return { model, inBuilding, hasNumber, hasArea };
}

const ids = (cs: readonly Constraint[]) => cs.map((c) => c.id);

describe("placement guards", () => {
  it("classify every kind, and agree with requiresLocalRoles", () => {
    for (const type of CONSTRAINT_TYPES) {
      const probe = { type } as Constraint;
      expect(isInternalConstraint(probe)).toBe(requiresLocalRoles(probe));
      expect(isExternalConstraint(probe)).toBe(!requiresLocalRoles(probe));
    }
  });
});

describe("FactType.internalConstraints", () => {
  it("keeps the internal kinds in list order and leaves out the external ones", () => {
    const { hasNumber, hasArea } = rooms();
    expect(ids(hasNumber.internalConstraints)).toEqual(["c-one-nr"]);
    expect(ids(hasArea.internalConstraints)).toEqual(["c-one-area"]);
  });
});

describe("OrmModel.constraints", () => {
  it("lists the external kinds in fact type order, then list order", () => {
    const { model } = rooms();
    expect(ids(model.constraints)).toEqual(["c-room-key", "c-in-or-area"]);
  });

  it("is empty for a model with only internal constraints", () => {
    const model = new OrmModel({ name: "Empty" });
    expect(model.constraints).toEqual([]);
  });
});

describe("OrmModel.constraintsTouching", () => {
  it("gives a fact type its internal constraints, then each external one naming its roles", () => {
    const { model } = rooms();
    // The key is hosted under ft-nr but names r-2, a role of ft-in; the
    // disjunctive mandatory is hosted under ft-area and names r-1.
    expect(ids(model.constraintsTouching("ft-in"))).toEqual([
      "c-one-building",
      "c-in-mandatory",
      "c-room-key",
      "c-in-or-area",
    ]);
    expect(ids(model.constraintsTouching("ft-nr"))).toEqual(["c-one-nr", "c-room-key"]);
    expect(ids(model.constraintsTouching("ft-area"))).toEqual(["c-one-area", "c-in-or-area"]);
  });

  it("is empty for a fact type the model does not have", () => {
    const { model } = rooms();
    expect(model.constraintsTouching("ft-missing")).toEqual([]);
  });
});

describe("OrmModel.getConstraint", () => {
  it("finds a constraint of either placement by id", () => {
    const { model } = rooms();
    expect(model.getConstraint("c-in-mandatory")?.type).toBe("mandatory");
    expect(model.getConstraint("c-room-key")?.type).toBe("external_uniqueness");
    expect(model.getConstraint("c-missing")).toBeUndefined();
  });
});

describe("FactType.addConstraint", () => {
  it("fills a missing id from the generator and keeps a stated one (barwise-nkq)", () => {
    const { model, inBuilding } = rooms();
    inBuilding.addConstraint({
      type: "ring",
      roleId1: "r-1",
      roleId2: "r-2",
      ringType: "irreflexive",
    });
    inBuilding.addConstraint({ id: "c-stated", type: "mandatory", roleId: "r-2" });

    const [filled, stated] = inBuilding.constraints.slice(-2);
    expect(filled!.id).toEqual(expect.any(String));
    expect(filled!.id).not.toBe("");
    expect(stated!.id).toBe("c-stated");
    expect(model.getConstraint(filled!.id!)).toBe(filled);
  });
});
