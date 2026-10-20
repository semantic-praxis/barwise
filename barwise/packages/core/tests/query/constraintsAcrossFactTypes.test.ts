/**
 * Query over constraints across fact types (orm-format-3, Open decision 9,
 * WS3a-ii-c). A `ConstraintRef` carries the constraint's own id and the
 * fact types it applies to; a whole-model list says each constraint once;
 * a view of one fact type or entity says every constraint touching it,
 * once; and which constraints each view says does not depend on which fact
 * type a 2.0 file nested a constraint under. Their order still does:
 * constraints across fact types follow file order until storage moves to
 * the model (WS3c), which is why the last test compares sorted lists.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { queryModel } from "../../src/query/evaluate.js";
import type { ConstraintRef, QueryResult } from "../../src/query/types.js";

/** Room is in Building, Room has RoomNumber; the composite key nests in `host`. */
function rooms(host: "ft-in" | "ft-nr"): OrmModel {
  const key: Constraint = {
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
      ...(host === "ft-in" ? [key] : []),
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
      ...(host === "ft-nr" ? [key] : []),
    ],
  });
  return model;
}

function constraintsOf(r: QueryResult): readonly ConstraintRef[] {
  if (r.kind === "constraints") return r.constraints;
  if (r.kind === "fact-type-detail" || r.kind === "entity-detail") return r.detail.constraints;
  throw new Error(`no constraints in a ${r.kind} result`);
}

const KEY = {
  id: "c-room-key",
  constraintType: "external_uniqueness",
  factTypes: ["Room is in Building", "Room has RoomNumber"],
  factTypeIds: ["ft-in", "ft-nr"],
};

describe("query over constraints across fact types", () => {
  it("lists each constraint once, by its own id, with the fact types it applies to", () => {
    const refs = constraintsOf(queryModel(rooms("ft-nr"), { kind: "list-constraints" }));
    expect(refs.map((c) => [c.id, c.factTypeIds])).toEqual([
      ["c-one-building", ["ft-in"]],
      ["c-one-nr", ["ft-nr"]],
      ["c-room-key", ["ft-in", "ft-nr"]],
    ]);
    expect(refs[2]).toMatchObject(KEY);
  });

  it("filters constraints across fact types by kind like the rest", () => {
    const byKind = (constraintType: string) =>
      constraintsOf(queryModel(rooms("ft-nr"), { kind: "list-constraints", constraintType }))
        .map((c) => c.id);
    expect(byKind("internal_uniqueness")).toEqual(["c-one-building", "c-one-nr"]);
    expect(byKind("external_uniqueness")).toEqual(["c-room-key"]);
  });

  it("counts a constraint across fact types once in the model's stats", () => {
    const r = queryModel(rooms("ft-nr"), { kind: "model-stats" });
    expect(r.kind === "stats" && r.stats.constraints).toBe(3);
  });

  it("shows a constraint across fact types under each fact type it touches", () => {
    for (const name of ["Room is in Building", "Room has RoomNumber"]) {
      const refs = constraintsOf(queryModel(rooms("ft-nr"), { kind: "fact-type", name }));
      expect(refs.filter((c) => c.id === "c-room-key"), name).toEqual([
        expect.objectContaining(KEY),
      ]);
    }
  });

  it("lists it once for an entity whose fact types it spans twice", () => {
    for (
      const q of [
        { kind: "entity", name: "Room" } as const,
        { kind: "constraints-of", name: "Room" } as const,
      ]
    ) {
      const ids = constraintsOf(queryModel(rooms("ft-in"), q)).map((c) => c.id);
      expect(ids, q.kind).toEqual(["c-one-building", "c-room-key", "c-one-nr"]);
    }
  });

  it("gives the same answers whichever fact type nests the constraint", () => {
    const queries = [
      { kind: "list-constraints" },
      { kind: "fact-type", name: "Room is in Building" },
      { kind: "constraints-of", name: "Room has RoomNumber" },
      { kind: "entity", name: "Room" },
    ] as const;
    for (const q of queries) {
      const sortIds = (r: QueryResult) =>
        [...constraintsOf(r)].sort((a, b) => a.id.localeCompare(b.id));
      expect(sortIds(queryModel(rooms("ft-in"), q)), q.kind)
        .toEqual(sortIds(queryModel(rooms("ft-nr"), q)));
    }
  });
});
