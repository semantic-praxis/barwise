/**
 * Describe over constraints across fact types (orm-format-3, Open decision
 * 9, WS3a-ii-c). A `ConstraintSummary` carries the constraint's own id and
 * the fact types it applies to; the whole model says each constraint once;
 * a focus on one fact type or entity says every constraint touching it,
 * once; and none of it depends on which fact type a 2.0 file nested the
 * constraint under (every constraint here states its id, and there is one
 * constraint across fact types, so neither the set nor the order can).
 */
import { describe, expect, it } from "vitest";
import { describeDomain } from "../../src/describe/describeDomain.js";
import type { DomainDescription } from "../../src/describe/types.js";
import type { ExternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { loadNestedUnder } from "../helpers/nestedUnder.js";

/**
 * Room is in Building, Room has RoomNumber, Room has Area, with the composite
 * key over the first two, loaded from a 2.0 file that nests the key under
 * `host`.
 */
function rooms(host: "ft-in" | "ft-nr" | "ft-area"): OrmModel {
  const key: ExternalConstraint = {
    id: "c-room-key",
    type: "external_uniqueness",
    roleIds: ["r-2", "r-4"],
  };
  const model = new OrmModel({ name: "Facilities" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({
    id: "ot-building",
    name: "Building",
    kind: "entity",
    referenceMode: "code",
  });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  model.addObjectType({ id: "ot-area", name: "Area", kind: "value" });
  model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-1", name: "is in", playerId: "ot-room" },
      { id: "r-2", name: "houses", playerId: "ot-building" },
    ],
    readings: ["{0} is in {1}"],
    constraints: [
      { id: "c-one-building", type: "internal_uniqueness", roleIds: ["r-1"] },
    ],
  });
  model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-3", name: "has", playerId: "ot-room" },
      { id: "r-4", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "c-one-nr", type: "internal_uniqueness", roleIds: ["r-3"] },
    ],
  });
  model.addFactType({
    id: "ft-area",
    name: "Room has Area",
    roles: [
      { id: "r-5", name: "has", playerId: "ot-room" },
      { id: "r-6", name: "is of", playerId: "ot-area" },
    ],
    readings: ["{0} has {1}"],
  });
  model.addConstraint(key);
  return loadNestedUnder(model, host);
}

const KEY = {
  id: "c-room-key",
  type: "external_uniqueness",
  factTypes: ["Room is in Building", "Room has RoomNumber"],
  factTypeIds: ["ft-in", "ft-nr"],
};

const ids = (d: DomainDescription) => d.constraints.map((c) => c.id);

describe("describe over constraints across fact types", () => {
  it("summarizes each constraint once, by its own id, with the fact types it applies to", () => {
    const d = describeDomain(rooms("ft-nr"));
    expect(d.constraints.map((c) => [c.id, c.factTypeIds])).toEqual([
      ["c-one-building", ["ft-in"]],
      ["c-one-nr", ["ft-nr"]],
      ["c-room-key", ["ft-in", "ft-nr"]],
    ]);
    expect(d.constraints[2]).toMatchObject(KEY);
  });

  it("shows and counts it under each fact type it touches", () => {
    for (const focus of ["Room is in Building", "Room has RoomNumber"]) {
      const d = describeDomain(rooms("ft-nr"), { focus });
      expect(d.constraints.filter((c) => c.id === "c-room-key"), focus).toEqual([
        expect.objectContaining(KEY),
      ]);
      expect(d.factTypes[0]!.constraintCount, focus).toBe(2);
    }
  });

  it("summarizes it once for an entity whose fact types it spans twice", () => {
    expect(ids(describeDomain(rooms("ft-in"), { focus: "Room" }))).toEqual([
      "c-one-building",
      "c-room-key",
      "c-one-nr",
    ]);
  });

  it("brings in every fact type a matching constraint spans, tagged with all of them", () => {
    const d = describeDomain(rooms("ft-in"), { focus: "uniqueness" });
    expect(d.factTypes.map((ft) => ft.id)).toEqual(["ft-in", "ft-nr"]);
    expect(d.summary).toContain(
      "[Room is in Building, Room has RoomNumber] The combination of Building and RoomNumber",
    );
  });

  it("does not show or count it under a fact type that nests it but holds none of its roles", () => {
    const d = describeDomain(rooms("ft-area"), { focus: "Room has Area" });
    expect(d.constraints).toEqual([]);
    expect(d.factTypes[0]!.constraintCount).toBe(0);
    const spanned = describeDomain(rooms("ft-area"), { focus: "Room has RoomNumber" });
    expect(spanned.constraints.map((c) => c.id)).toEqual(["c-one-nr", "c-room-key"]);
  });

  it("leaves out a constraint across fact types of another kind", () => {
    const d = describeDomain(rooms("ft-in"), { focus: "mandatory" });
    expect(d.constraints).toEqual([]);
    expect(d.factTypes).toEqual([]);
  });

  it("gives the same description whichever fact type nests the constraint", () => {
    for (const focus of [undefined, "Room", "Room is in Building", "uniqueness"]) {
      expect(describeDomain(rooms("ft-in"), { focus }), String(focus))
        .toEqual(describeDomain(rooms("ft-nr"), { focus }));
    }
  });
});
