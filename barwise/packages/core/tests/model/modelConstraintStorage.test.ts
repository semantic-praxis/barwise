/**
 * Constraints across fact types are stored on the model (orm-format-3
 * WS3c): added by `OrmModel.addConstraint` and refused by a fact type,
 * dropped with a fact type holding all their roles, and written by a 2.0
 * save under their first holder.
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import type { ExternalConstraint, InternalConstraint } from "../../src/model/Constraint.js";
import { setIdGenerator } from "../../src/model/id.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

/**
 * Room is in Building (ft-in) and Room has RoomNumber (ft-nr), with an
 * internal uniqueness on each, and `across` in the model.
 */
function rooms(across: ExternalConstraint[] = []): OrmModel {
  const model = new OrmModel({ name: "Rooms" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-b", name: "Building", kind: "entity", referenceMode: "code" });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-room-in", name: "is in", playerId: "ot-room" },
      { id: "r-b", name: "houses", playerId: "ot-b" },
    ],
    readings: ["{0} is in {1}"],
    constraints: [{ id: "c-in", type: "internal_uniqueness", roleIds: ["r-room-in"] }],
  });
  model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-room-nr", name: "has", playerId: "ot-room" },
      { id: "r-n", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
    constraints: [{ id: "c-nr", type: "internal_uniqueness", roleIds: ["r-room-nr"] }],
  });
  for (const c of across) model.addConstraint(c);
  return model;
}

const key: ExternalConstraint = {
  id: "c-key",
  type: "external_uniqueness",
  roleIds: ["r-b", "r-n"],
};

describe("constraints across fact types on the model", () => {
  // The types refuse both; these are for a value whose type was asserted,
  // which would otherwise sit where no reader of the model's looks.
  const asserted = key as unknown as InternalConstraint;

  it("refuses one in a fact type's config, naming where it goes", () => {
    const model = rooms();
    expect(() =>
      model.addFactType({
        id: "ft-x",
        name: "Room is wide",
        roles: [{ id: "r-w", name: "is wide", playerId: "ot-room" }],
        readings: ["{0} is wide"],
        constraints: [asserted],
      })
    ).toThrow(/external_uniqueness.*OrmModel\.addConstraint/);
    expect(model.constraints).toEqual([]);
  });

  it("refuses one handed to a fact type, and keeps the fact type's own", () => {
    const model = rooms();
    const ft = model.getFactType("ft-in")!;
    expect(() => ft.addConstraint(asserted)).toThrow(/OrmModel\.addConstraint/);
    expect(ft.internalConstraints.map((c) => c.id)).toEqual(["c-in"]);
    expect(model.constraints).toEqual([]);
  });

  it("gives one added without an id a fresh id, in the order added", () => {
    let n = 0;
    setIdGenerator(() => `gen-${++n}`);
    try {
      const model = rooms();
      const first = model.addConstraint({ type: "exclusion", roleIds: ["r-b", "r-n"] });
      model.addConstraint(key);
      expect(first.id).toBe("gen-1");
      expect(model.constraints.map((c) => c.id)).toEqual(["gen-1", "c-key"]);
    } finally {
      setIdGenerator(undefined);
    }
  });

  it("finds one by id with no fact type", () => {
    const model = rooms([key]);
    expect(model.getConstraintInView("c-key")).toEqual([key, undefined]);
    expect(model.getConstraintInView("c-nr")?.[1]?.id).toBe("ft-nr");
  });

  it("drops one with the fact type holding all its roles, and keeps one spanning another", () => {
    // The key also spans ft-nr, so it stays with its ft-in role dangling,
    // for validation to report; the exclusion lies wholly in ft-in.
    const inside: ExternalConstraint = {
      id: "c-inside",
      type: "exclusion",
      roleIds: ["r-room-in", "r-b"],
    };
    const model = rooms([key, inside]);
    model.removeFactType("ft-in");
    expect(model.constraints.map((c) => c.id)).toEqual(["c-key"]);
  });

  it("keeps one with no roles, which touches no fact type to be removed with", () => {
    const model = rooms();
    model.addConstraint({ id: "c-empty", type: "exclusion", roleIds: [] });
    model.removeFactType("ft-in");
    expect(model.constraints.map((c) => c.id)).toEqual(["c-empty"]);
  });
});

describe("a 2.0 save of constraints across fact types", () => {
  const yaml = new OrmYamlSerializer();
  const nestedIn = (text: string) =>
    Object.fromEntries(
      (parse(text).model.fact_types as { id: string; constraints?: { id: string; }[]; }[]).map((
        ft,
      ) => [ft.id, (ft.constraints ?? []).map((c) => c.id)]),
    );

  it("writes one under its first holder, after that fact type's own", () => {
    // ft-in is the first fact type holding one of its roles.
    expect(nestedIn(yaml.serialize(rooms([key])))).toEqual({
      "ft-in": ["c-in", "c-key"],
      "ft-nr": ["c-nr"],
    });
  });

  it("reads back the same model", () => {
    const model = rooms([key]);
    const back = yaml.deserialize(yaml.serialize(model));
    expect(back.constraints).toEqual(model.constraints);
    expect(yaml.serialize(back)).toBe(yaml.serialize(model));
  });

  it("keeps one none of whose roles is in a fact type, under the first fact type", () => {
    // A lenient load reads one and merge carries one through; validation
    // reports it, and the file must not lose it.
    const model = rooms();
    model.addConstraint({ id: "c-gone", type: "exclusion", roleIds: ["r-x", "r-y"] });
    const text = yaml.serialize(model);
    expect(nestedIn(text)["ft-in"]).toEqual(["c-in", "c-gone"]);
    expect(yaml.deserialize(text, { lenient: true }).constraints.map((c) => c.id)).toEqual([
      "c-gone",
    ]);
  });

  it("refuses one in a model with no fact type, by id", () => {
    const model = new OrmModel({ name: "Empty" });
    model.addConstraint({ id: "c-gone", type: "exclusion", roleIds: ["r-x", "r-y"] });
    expect(() => yaml.serialize(model)).toThrow(/"c-gone"/);
  });
});
