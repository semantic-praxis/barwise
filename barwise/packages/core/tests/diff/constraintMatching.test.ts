/**
 * Id-first constraint matching (orm-format-3, Open decision 4 as revised
 * 2026-10-18; barwise-18n). A constraint whose id occurs once on each side
 * is paired by id, so an edit that keeps it is one `constraintsModified`
 * change; the rest pair by content key, so an import with fresh ids still
 * matches; and `constraintMatching: "content"` pairs by content alone, for
 * independent LLM samples whose ids are unrelated.
 */
import { describe, expect, it } from "vitest";
import type { ChangeDescription } from "../../src/diff/changeDescription.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** Person drives Car, carrying `constraints`; role ids r-1 and r-2. */
function drives(constraints: Constraint[]): OrmModel {
  const model = new OrmModel({ name: "M" });
  model.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-c", name: "Car", kind: "entity", referenceMode: "vin" });
  model.addFactType({
    id: "ft-d",
    name: "Person drives Car",
    roles: [
      { id: "r-1", name: "drives", playerId: "ot-p" },
      { id: "r-2", name: "is driven by", playerId: "ot-c" },
    ],
    readings: ["{0} drives {1}"],
    constraints,
  });
  return model;
}

const uc = (id: string, roleIds: string[]): Constraint => ({
  id,
  type: "internal_uniqueness",
  roleIds,
});

/** The constraint changes of the one fact type, as change kind and constraint ids. */
function constraintChanges(
  a: OrmModel,
  b: OrmModel,
  options?: Parameters<typeof diffModels>[2],
) {
  const delta = diffModels(a, b, options).deltas.find((d) => d.elementType === "fact_type")!;
  return delta.changes.flatMap((c: ChangeDescription) => {
    switch (c.change) {
      case "constraintsAdded":
      case "constraintsRemoved":
        return [[c.change, c.constraints.map((k) => k.id)]];
      case "constraintsModified":
        return [[c.change, c.constraints.map((m) => [m.from.id, m.to.id])]];
      default:
        return [];
    }
  });
}

describe("id-first constraint matching", () => {
  it("reports an edit that keeps the id as one modification, with both versions", () => {
    const a = drives([uc("c-1", ["r-1"])]);
    const b = drives([uc("c-1", ["r-2"])]);
    expect(constraintChanges(a, b)).toEqual([["constraintsModified", [["c-1", "c-1"]]]]);
    const delta = diffModels(a, b).deltas.find((d) => d.elementType === "fact_type")!;
    expect(delta.kind).toBe("modified");
    expect(delta.changeDescriptions).toEqual(["constraints modified: internal_uniqueness"]);
    expect(delta.breakingLevel).toBe("caution");
    const modified = delta.changes.find((c) => c.change === "constraintsModified");
    expect(modified).toEqual({
      change: "constraintsModified",
      constraints: [{ from: uc("c-1", ["r-1"]), to: uc("c-1", ["r-2"]) }],
    });
  });

  it("reports nothing for a constraint paired by id whose content is unchanged", () => {
    expect(constraintChanges(drives([uc("c-1", ["r-1"])]), drives([uc("c-1", ["r-1"])])))
      .toEqual([]);
  });

  it("still pairs by content when the ids are fresh, as a transcript import's are", () => {
    expect(constraintChanges(drives([uc("c-old", ["r-1"])]), drives([uc("c-new", ["r-1"])])))
      .toEqual([]);
  });

  it("pairs the rest by content after pairing by id", () => {
    const a = drives([uc("c-1", ["r-1"]), uc("c-old", ["r-2"])]);
    const b = drives([uc("c-1", ["r-1", "r-2"]), uc("c-new", ["r-2"])]);
    expect(constraintChanges(a, b)).toEqual([["constraintsModified", [["c-1", "c-1"]]]]);
  });

  it("does not let a constraint paired by id also match another by content", () => {
    // c-1 changes to what c-2 was, and c-2 is removed. Without id pairing
    // first, c-1's new content would match c-2 by content and hide both.
    const a = drives([uc("c-1", ["r-1"]), uc("c-2", ["r-2"])]);
    const b = drives([uc("c-1", ["r-2"])]);
    expect(constraintChanges(a, b)).toEqual([
      ["constraintsRemoved", ["c-2"]],
      ["constraintsModified", [["c-1", "c-1"]]],
    ]);
  });

  it("pairs nothing by an id given twice on one side, and matches those by content", () => {
    // Paired by id with the first c-1 on the right, the left one would read
    // as modified to r-1 and the second as added; by content, the left one
    // is the second, unchanged, and only the first is new.
    const a = drives([uc("c-1", ["r-2"])]);
    const b = drives([uc("c-1", ["r-1"]), uc("c-1", ["r-2"])]);
    expect(constraintChanges(a, b)).toEqual([["constraintsAdded", ["c-1"]]]);
  });

  it("holds an unchanged pair out of the content pass, so its duplicate still reads as removed", () => {
    const a = drives([uc("c-1", ["r-1"]), uc("c-2", ["r-1"])]);
    const b = drives([uc("c-1", ["r-1"])]);
    expect(constraintChanges(a, b)).toEqual([["constraintsRemoved", ["c-2"]]]);
  });
});

describe("what id-first pairing reads", () => {
  it("reports a value constraint whose range alone changed", () => {
    const vc = (max: string): Constraint => ({
      id: "vc-1",
      type: "value_constraint",
      roleId: "r-2",
      values: [],
      ranges: [{ min: "1", max }],
    });
    expect(constraintChanges(drives([vc("10")]), drives([vc("5")])))
      .toEqual([["constraintsModified", [["vc-1", "vc-1"]]]]);
    // The same edit under fresh ids is a removal and an addition, not silence.
    const fresh: Constraint = { ...vc("5"), id: "vc-2" };
    expect(constraintChanges(drives([vc("10")]), drives([fresh]))).toEqual([
      ["constraintsAdded", ["vc-2"]],
      ["constraintsRemoved", ["vc-1"]],
    ]);
  });

  it("pairs nothing by an id another fact type of the same model also uses", () => {
    const a = drives([uc("c-1", ["r-1"])]);
    const b = drives([uc("c-1", ["r-2"])]);
    b.addFactType({
      id: "ft-o",
      name: "Person owns Car",
      roles: [
        { id: "r-3", name: "owns", playerId: "ot-p" },
        { id: "r-4", name: "is owned by", playerId: "ot-c" },
      ],
      readings: ["{0} owns {1}"],
      constraints: [uc("c-1", ["r-3"])],
    });
    expect(constraintChanges(a, b)).toEqual([
      ["constraintsAdded", ["c-1"]],
      ["constraintsRemoved", ["c-1"]],
    ]);
    // And the same with the repeat on the existing side.
    expect(constraintChanges(b, a)).toEqual([
      ["constraintsAdded", ["c-1"]],
      ["constraintsRemoved", ["c-1"]],
    ]);
  });

  it("reports nothing when the key moves but the constraint itself is unchanged", () => {
    // The fact type's roles swap places under the same ids: the key, which
    // reads roles by position, moves, and the constraint does not.
    const a = drives([uc("c-1", ["r-1"])]);
    const b = new OrmModel({ name: "M" });
    b.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
    b.addObjectType({ id: "ot-c", name: "Car", kind: "entity", referenceMode: "vin" });
    b.addFactType({
      id: "ft-d",
      name: "Person drives Car",
      roles: [
        { id: "r-2", name: "is driven by", playerId: "ot-c" },
        { id: "r-1", name: "drives", playerId: "ot-p" },
      ],
      readings: ["{1} drives {0}"],
      constraints: [uc("c-1", ["r-1"])],
    });
    expect(constraintChanges(a, b)).toEqual([]);
  });

  it("reports a retarget onto the role that moved into the old position", () => {
    // Person is parent of Person: the roles swap places and the mandatory
    // moves from parent to child. By position nothing moved; by role id
    // the constraint now constrains the other role.
    const ring = (order: [string, string], target: string) => {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
      const role = { "r-p": "is parent of", "r-c": "is child of" } as Record<string, string>;
      m.addFactType({
        id: "ft-r",
        name: "Person is parent of Person",
        roles: order.map((id) => ({ id, name: role[id]!, playerId: "ot-p" })),
        readings: ["{0} is parent of {1}"],
        constraints: [{ id: "c-1", type: "mandatory", roleId: target }],
      });
      return m;
    };
    expect(constraintChanges(ring(["r-p", "r-c"], "r-p"), ring(["r-c", "r-p"], "r-c")))
      .toEqual([["constraintsModified", [["c-1", "c-1"]]]]);
  });

  it("falls back to the key for a pair whose roles one model lacks", () => {
    // Same constraint id over fresh role ids at the same positions: the raw
    // role ids differ, and by position nothing changed.
    const a = drives([uc("c-1", ["r-1"])]);
    const b = new OrmModel({ name: "M" });
    b.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
    b.addObjectType({ id: "ot-c", name: "Car", kind: "entity", referenceMode: "vin" });
    b.addFactType({
      id: "ft-d",
      name: "Person drives Car",
      roles: [
        { id: "r-9", name: "drives", playerId: "ot-p" },
        { id: "r-8", name: "is driven by", playerId: "ot-c" },
      ],
      readings: ["{0} drives {1}"],
      constraints: [uc("c-1", ["r-9"])],
    });
    expect(constraintChanges(a, b)).toEqual([]);
  });

  it("reads a reordered role list or a default written out as no change", () => {
    expect(
      constraintChanges(drives([uc("c-1", ["r-1", "r-2"])]), drives([uc("c-1", ["r-2", "r-1"])])),
    )
      .toEqual([]);
    const written: Constraint = { ...uc("c-1", ["r-1"]), isPreferred: false, modality: "alethic" };
    expect(constraintChanges(drives([uc("c-1", ["r-1"])]), drives([written]))).toEqual([]);
  });

  it("tells a value holding a comma from two values", () => {
    const vc = (values: string[]): Constraint => ({
      id: "vc-1",
      type: "value_constraint",
      roleId: "r-2",
      values,
    });
    expect(constraintChanges(drives([vc(["a,b"])]), drives([vc(["a", "b"])])))
      .toEqual([["constraintsModified", [["vc-1", "vc-1"]]]]);
  });

  it("names both kinds when an edit changes the kind", () => {
    const a = drives([{ id: "c-1", type: "mandatory", roleId: "r-1" }]);
    const b = drives([uc("c-1", ["r-1"])]);
    const delta = diffModels(a, b).deltas.find((d) => d.elementType === "fact_type")!;
    expect(delta.changeDescriptions).toEqual([
      "constraints modified: mandatory to internal_uniqueness",
    ]);
  });
});

describe("content-only constraint matching", () => {
  it("never pairs two different constraints by a coincidental id", () => {
    const a = drives([uc("c-1", ["r-1"])]);
    const b = drives([uc("c-1", ["r-2"])]);
    expect(constraintChanges(a, b, { constraintMatching: "content" })).toEqual([
      ["constraintsAdded", ["c-1"]],
      ["constraintsRemoved", ["c-1"]],
    ]);
  });

  it("still pairs equal content whatever the ids", () => {
    expect(
      constraintChanges(drives([uc("c-a", ["r-1"])]), drives([uc("c-b", ["r-1"])]), {
        constraintMatching: "content",
      }),
    ).toEqual([]);
  });
});
