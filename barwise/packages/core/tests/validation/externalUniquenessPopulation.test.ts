/**
 * Tests for external-uniqueness population validation (WS4c): the inferred
 * common-object join, the violation when two distinct common instances
 * share an identifying combination, and the graceful skip when the join
 * key cannot be inferred as a single clear object type.
 */
import { describe, expect, it } from "vitest";
import type { FactType } from "../../src/model/FactType.js";
import type { ObjectType } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

interface RoleSpec {
  readonly player: ObjectType;
  readonly name: string;
  readonly id: string;
}

function ent(m: OrmModel, name: string, ref: string): ObjectType {
  return m.addObjectType({ name, kind: "entity", referenceMode: ref });
}

function val(m: OrmModel, name: string): ObjectType {
  return m.addObjectType({ name, kind: "value" });
}

function binaryFact(m: OrmModel, name: string, a: RoleSpec, b: RoleSpec): FactType {
  return m.addFactType({
    name,
    roles: [
      { name: a.name, playerId: a.player.id, id: a.id },
      { name: b.name, playerId: b.player.id, id: b.id },
    ],
    readings: ["{0} relates {1}"],
  });
}

function pop(m: OrmModel, factTypeId: string, roleValues: Record<string, string>): void {
  m.addPopulation({ factTypeId }).addInstance({ roleValues });
}

function flags(model: OrmModel, ruleId: string): boolean {
  return populationValidationRules(model).some((d) => d.ruleId === ruleId);
}

/**
 * Room is identified by the combination of its Building and its RoomNumber
 * (the standard external-uniqueness pattern: the constrained roles live in
 * different fact types, joined on the common Room).
 */
function roomModel(violate: boolean): OrmModel {
  const m = new OrmModel({ name: "M" });
  const room = ent(m, "Room", "room_id");
  const building = ent(m, "Building", "building_id");
  const roomNumber = val(m, "RoomNumber");
  const inBuilding = binaryFact(
    m,
    "Room is in Building",
    { player: room, name: "is in", id: "rb1" },
    { player: building, name: "houses", id: "rb2" },
  );
  const hasNumber = binaryFact(
    m,
    "Room has RoomNumber",
    { player: room, name: "has", id: "rn1" },
    { player: roomNumber, name: "numbers", id: "rn2" },
  );
  inBuilding.addConstraint({ type: "external_uniqueness", roleIds: ["rb2", "rn2"] });
  pop(m, inBuilding.id, { rb1: "R1", rb2: "B1" });
  pop(m, hasNumber.id, { rn1: "R1", rn2: "N1" });
  pop(m, inBuilding.id, { rb1: "R2", rb2: "B1" });
  pop(m, hasNumber.id, { rn1: "R2", rn2: violate ? "N1" : "N2" });
  return m;
}

/**
 * A ternary Booking with an external uniqueness on two of its own roles:
 * the join key cannot be inferred (both constrained roles share a fact
 * type), so validation skips it rather than guess.
 */
function unInferableModel(): OrmModel {
  const m = new OrmModel({ name: "M" });
  const guest = ent(m, "Guest", "guest_id");
  const room = ent(m, "Room", "room_id");
  const date = val(m, "Date");
  const booking = m.addFactType({
    name: "Booking",
    roles: [
      { name: "by", playerId: guest.id, id: "bk1" },
      { name: "of", playerId: room.id, id: "bk2" },
      { name: "on", playerId: date.id, id: "bk3" },
    ],
    readings: ["{0} books {1} on {2}"],
  });
  booking.addConstraint({ type: "external_uniqueness", roleIds: ["bk2", "bk3"] });
  pop(m, booking.id, { bk1: "G1", bk2: "RM1", bk3: "D1" });
  pop(m, booking.id, { bk1: "G2", bk2: "RM1", bk3: "D1" });
  return m;
}

describe("external uniqueness population validation", () => {
  it("flags two common instances that share an identifying combination", () => {
    expect(flags(roomModel(true), "population/external-uniqueness-violation")).toBe(true);
  });

  it("passes when each common instance has a distinct combination", () => {
    expect(flags(roomModel(false), "population/external-uniqueness-violation")).toBe(false);
  });

  it("skips when the join key cannot be inferred", () => {
    expect(flags(unInferableModel(), "population/external-uniqueness-violation")).toBe(false);
  });
});
