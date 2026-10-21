/**
 * Constraint nodes for constraints across fact types (orm-format-3, Open
 * decision 9, WS3b). Each node takes its constraint's own id, and the
 * fact type a 2.0 file nests the constraint under decides nothing: not the
 * node's id, not its edges, and not whether it is drawn, which it used to
 * when that fact type was a reference mode absorbed into its entity.
 */
import type { Constraint, OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { modelToGraph } from "../../src/graph/ModelToGraph.js";
import { rooms } from "../fixtures/rooms.js";

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

  it("keeps an id an internal constraint shares, since a badge has no node id", () => {
    const samePref: Constraint = { id: "c-pref", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const ids = constraintPart(rooms("ft-in", [samePref])).nodes.map((n) => n.id).sort();
    expect(ids).toEqual(["c-key", "c-pref"]);
  });

  it("leaves an id to the drawn constraint when one never drawn shares it", () => {
    // Walked first, under "Room has RoomId"; join constraints have no glyph.
    const undrawn: Constraint = { id: "c-key", type: "join_exclusion", operands: [] };
    expect(constraintPart(rooms("ft-in", [undrawn])).nodes.map((n) => n.id)).toEqual(["c-key"]);
  });

  it("never issues a node id another node holds, and leaves a unique stated id to its owner", () => {
    // Under "Room has RoomId", walked first: an id equal to a fact type's,
    // a twin of the key, and an exclusive-or whose own unique id is what a
    // suffix for the twins would otherwise be.
    const sameAsFactType: Constraint = { id: "ft-nr", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const twin: Constraint = { id: "c-key", type: "exclusion", roleIds: ["r-b", "r-n"] };
    const stated: Constraint = { id: "c-key#2", type: "exclusive_or", roleIds: ["r-b", "r-n"] };
    const graph = modelToGraph(rooms("ft-in", [sameAsFactType, twin, stated]));
    const ids = graph.nodes.map((n) => n.id);
    expect(new Set(ids).size).toBe(ids.length);
    const byKind = graph.nodes.flatMap((n) =>
      n.kind === "constraint" ? [[n.id, n.constraintKind] as const] : []
    );
    expect(byKind).toEqual([
      ["ft-nr#2", "exclusion"],
      ["c-key", "exclusion"],
      ["c-key#2", "exclusive_or"],
      ["c-key#3", "external_uniqueness"],
    ]);
  });

  it("gives a constraint the same node id in every view", () => {
    // Two constraints share c-key. The twin, walked first, spans only
    // "Room has RoomNumber"; a view of "Room is in Building" draws only the
    // key, which keeps the suffixed id it has in the full view.
    const twin: Constraint = { id: "c-key", type: "exclusion", roleIds: ["r-room-nr", "r-n"] };
    const model = rooms("ft-in", [twin]);
    const full = constraintPart(model).nodes.map((n) => n.id);
    const view = constraintPart(model, {
      includeFilter: {
        objectTypeIds: new Set(["ot-room", "ot-b"]),
        factTypeIds: new Set(["ft-in"]),
        subtypeFactIds: new Set<string>(),
      },
    }).nodes.map((n) => n.id);
    expect(full).toEqual(["c-key", "c-key#2"]);
    expect(view).toEqual(["c-key#2"]);
  });
});
