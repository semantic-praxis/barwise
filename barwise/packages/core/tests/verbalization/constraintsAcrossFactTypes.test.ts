/**
 * Verbalization of constraints across fact types (orm-format-3, Open
 * decisions 7 and 9, WS3a-ii). The whole model says each one once, under a
 * "Constraints across fact types" heading; a view of one fact type says
 * every constraint that touches it; every constraint row carries the
 * constraint's own id as `sourceElementId` and the fact types it applies to
 * as `factTypeIds`. And none of it depends on which fact type a 2.0 file
 * happened to nest the constraint under -- the property the host fallacy
 * broke.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";

/**
 * Room is identified by (Building, RoomNumber): the composite key is an
 * external uniqueness over a role of each fact type. `hostKeyUnder` picks
 * the fact type that nests it, as a 2.0 file might.
 */
function rooms(hostKeyUnder: "ft-in" | "ft-nr" | "none", extra: Constraint[] = []): OrmModel {
  const model = new OrmModel({ name: "Facilities" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({
    id: "ot-building",
    name: "Building",
    kind: "entity",
    referenceMode: "code",
  });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  const key: Constraint = {
    id: "c-room-key",
    type: "external_uniqueness",
    roleIds: ["r-2", "r-4"],
  };
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
      ...(hostKeyUnder === "ft-in" ? [key, ...extra] : []),
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
      ...(hostKeyUnder === "ft-nr" ? [key, ...extra] : []),
    ],
  });
  return model;
}

const KEY_TEXT = "The combination of Building and RoomNumber is unique across fact types.";

describe("verbalizeModel", () => {
  it("says a constraint across fact types once, after a section heading", () => {
    const rows = new Verbalizer().verbalizeModel(rooms("ft-nr"));
    const texts = rows.map((v) => v.text);

    expect(texts.filter((t) => t === KEY_TEXT)).toHaveLength(1);
    const heading = rows.findIndex((v) => v.category === "section");
    expect(rows[heading]).toMatchObject({
      text: "Constraints across fact types",
      sourceElementId: "constraints-across-fact-types",
    });
    expect(texts.indexOf(KEY_TEXT)).toBe(heading + 1);
    // After every fact type and its internal constraints.
    expect(heading).toBeGreaterThan(texts.indexOf("Each Room has at most one RoomNumber."));
  });

  it("is the same whichever fact type nests the constraint", () => {
    const strip = (m: OrmModel) => new Verbalizer().verbalizeModel(m);
    expect(strip(rooms("ft-in"))).toEqual(strip(rooms("ft-nr")));
  });

  it("emits no heading for a model with no constraint across fact types", () => {
    const rows = new Verbalizer().verbalizeModel(rooms("none"));
    expect(rows.filter((v) => v.category === "constraint")).toHaveLength(2);
    expect(rows.some((v) => v.category === "section")).toBe(false);
  });

  it("gives every constraint row its own id and the fact types it applies to", () => {
    const rows = new Verbalizer().verbalizeModel(rooms("ft-nr")).filter((v) =>
      v.category === "constraint"
    );
    expect(rows.map((v) => [v.sourceElementId, v.factTypeIds])).toEqual([
      ["c-one-building", ["ft-in"]],
      ["c-one-nr", ["ft-nr"]],
      ["c-room-key", ["ft-in", "ft-nr"]],
    ]);
  });

  it("keeps the row fields on a deontic constraint across fact types", () => {
    const model = rooms("ft-in", [
      { id: "c-pref", type: "exclusion", roleIds: ["r-1", "r-3"], modality: "deontic" },
    ]);
    const row = new Verbalizer().verbalizeModel(model).find((v) => v.sourceElementId === "c-pref")!;
    expect(row.text).toMatch(/^It is obligatory that /);
    expect(row.factTypeIds).toEqual(["ft-in", "ft-nr"]);
  });
});

describe("verbalizeFactType", () => {
  it("says a constraint across fact types under each fact type it touches", () => {
    const verbalizer = new Verbalizer();
    const model = rooms("ft-nr");
    for (const ftId of ["ft-in", "ft-nr"]) {
      const texts = verbalizer.verbalizeFactType(ftId, model).map((v) => v.text);
      expect(texts, ftId).toContain(KEY_TEXT);
      expect(texts.filter((t) => t === KEY_TEXT), ftId).toHaveLength(1);
    }
  });
});
