/**
 * Constraint nodes for constraints across fact types (orm-format-3, Open
 * decision 9, WS3b). Each node takes its constraint's own id, and the
 * fact type a 2.0 file nests the constraint under decides nothing: not the
 * node's id, not its edges, and not whether it is drawn, which it used to
 * when that fact type was a reference mode absorbed into its entity.
 */
import type { Constraint } from "@barwise/core";
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { modelToGraph } from "../../src/graph/ModelToGraph.js";
import { buildModelSummary } from "../../src/session/modelSummary.js";

type Host = "ft-id" | "ft-in" | "ft-nr";

/**
 * Room (identified by RoomId through the absorbed "Room has RoomId") is in
 * Building and has RoomNumber; the composite key over Building and
 * RoomNumber nests in `host`, and `extra` adds constraints to "Room has
 * RoomId".
 */
function rooms(host: Host, extra: Constraint[] = []): OrmModel {
  const key: Constraint = { id: "c-key", type: "external_uniqueness", roleIds: ["r-b", "r-n"] };
  const nest = (id: Host) => (host === id ? [key] : []);
  const model = new OrmModel({ name: "Facilities" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-rid", name: "RoomId", kind: "value" });
  model.addObjectType({ id: "ot-b", name: "Building", kind: "entity", referenceMode: "code" });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  model.addFactType({
    id: "ft-id",
    name: "Room has RoomId",
    roles: [
      { id: "r-room-id", name: "has", playerId: "ot-room" },
      { id: "r-rid", name: "identifies", playerId: "ot-rid" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "c-pref", type: "internal_uniqueness", roleIds: ["r-rid"], isPreferred: true },
      ...nest("ft-id"),
      ...extra,
    ],
  });
  model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-room-in", name: "is in", playerId: "ot-room" },
      { id: "r-b", name: "houses", playerId: "ot-b" },
    ],
    readings: ["{0} is in {1}"],
    constraints: nest("ft-in"),
  });
  model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-room-nr", name: "has", playerId: "ot-room" },
      { id: "r-n", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
    constraints: nest("ft-nr"),
  });
  return model;
}

/** The constraint nodes and their edges, which is all a constraint draws. */
function constraintPart(model: OrmModel, options?: Parameters<typeof modelToGraph>[1]) {
  const graph = modelToGraph(model, options);
  return {
    nodes: graph.nodes.filter((n) => n.kind === "constraint"),
    edges: graph.constraintEdges,
  };
}

describe("constraint nodes across fact types", () => {
  it("draws the key by its own id, with an edge to each fact type it spans", () => {
    expect(constraintPart(rooms("ft-in"))).toEqual({
      nodes: [{
        kind: "constraint",
        id: "c-key",
        constraintKind: "external_uniqueness",
        roleIds: ["r-b", "r-n"],
        supersetRoleIds: undefined,
      }],
      edges: [
        { constraintNodeId: "c-key", factTypeNodeId: "ft-in", roleId: "r-b" },
        { constraintNodeId: "c-key", factTypeNodeId: "ft-nr", roleId: "r-n" },
      ],
    });
  });

  it("draws the same thing whichever fact type nests it, an absorbed one included", () => {
    const expected = constraintPart(rooms("ft-in"));
    for (const host of ["ft-nr", "ft-id"] as const) {
      expect(constraintPart(rooms(host)), host).toEqual(expected);
    }
  });

  it("does not draw a constraint every fact type of which is absorbed", () => {
    const onlyAbsorbed: Constraint = {
      id: "c-absorbed",
      type: "exclusion",
      roleIds: ["r-room-id", "r-rid"],
    };
    const ids = constraintPart(rooms("ft-in", [onlyAbsorbed])).nodes.map((n) => n.id);
    expect(ids).toEqual(["c-key"]);
  });

  it("draws one that touches an absorbed fact type and a drawn one", () => {
    const halfAbsorbed: Constraint = {
      id: "c-half",
      type: "exclusion",
      roleIds: ["r-room-id", "r-room-in"],
    };
    const part = constraintPart(rooms("ft-in", [halfAbsorbed]));
    // Order-free: node order is file order, which 3c makes model order.
    expect(part.nodes.map((n) => n.id).sort()).toEqual(["c-half", "c-key"]);
    // Its edges go to drawn fact types only: none to the absorbed one.
    expect(part.edges.filter((e) => e.constraintNodeId === "c-half")).toEqual([
      { constraintNodeId: "c-half", factTypeNodeId: "ft-in", roleId: "r-room-in" },
    ]);
  });

  it("does not draw one whose roles resolve to nothing", () => {
    const dangling: Constraint = { id: "c-gone", type: "exclusion", roleIds: ["r-x", "r-y"] };
    expect(constraintPart(rooms("ft-in", [dangling])).nodes.map((n) => n.id)).toEqual(["c-key"]);
  });

  it("does not draw one whose fact types a neighbourhood view leaves out", () => {
    const filter = {
      objectTypeIds: new Set(["ot-room", "ot-rid"]),
      factTypeIds: new Set(["ft-id"]),
      subtypeFactIds: new Set<string>(),
    };
    expect(constraintPart(rooms("ft-in"), { includeFilter: filter })).toEqual({
      nodes: [],
      edges: [],
    });
    // With one of its two fact types in view, it is drawn with that edge.
    const partial = { ...filter, factTypeIds: new Set(["ft-in"]) };
    expect(constraintPart(rooms("ft-in"), { includeFilter: partial }).edges).toEqual([
      { constraintNodeId: "c-key", factTypeNodeId: "ft-in", roleId: "r-b" },
    ]);
  });

  it("keeps two constraints that share an id apart (barwise-b2s)", () => {
    const twin: Constraint = { id: "c-key", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const ids = constraintPart(rooms("ft-in", [twin])).nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["c-key", "c-key#2"]);
  });

  it("never issues a node id another node holds", () => {
    // An id equal to a fact type's, and a suffix equal to a stated id.
    const sameAsFactType: Constraint = { id: "ft-nr", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const twin: Constraint = { id: "c-key", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const stated: Constraint = { id: "c-key#2", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const graph = modelToGraph(rooms("ft-in", [sameAsFactType, twin, stated]));
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(graph.nodes.filter((n) => n.kind === "constraint").map((n) => n.id).sort()).toEqual([
      "c-key",
      "c-key#2",
      "c-key#3",
      "ft-nr#2",
    ]);
  });

  it("does not use up an id on a constraint it does not draw", () => {
    // Walked first, under "Room has RoomId", and dangling, so not drawn:
    // the key drawn after it keeps its plain id.
    const dangling: Constraint = { id: "c-key", type: "exclusion", roleIds: ["r-x", "r-y"] };
    expect(constraintPart(rooms("ft-in", [dangling])).nodes.map((n) => n.id)).toEqual(["c-key"]);
  });
});

describe("model summary across fact types", () => {
  it("lists the key under each fact type it spans, whichever fact type nests it", () => {
    for (const host of ["ft-in", "ft-nr", "ft-id"] as const) {
      const summary = buildModelSummary(rooms(host));
      const byFactType = Object.fromEntries(
        summary.factTypes.map((ft) => [ft.id, ft.constraints.map((c) => c.id)]),
      );
      expect(byFactType, host).toEqual({
        "ft-id": ["c-pref"],
        "ft-in": ["c-key"],
        "ft-nr": ["c-key"],
      });
    }
  });
});
