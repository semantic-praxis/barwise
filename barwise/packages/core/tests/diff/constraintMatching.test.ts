/**
 * Id-first constraint matching (orm-format-3, Open decision 4 as revised
 * 2026-10-18; barwise-18n). A constraint whose id occurs once on each side
 * is paired by id, so an edit that keeps it is one `constraintsModified`
 * change; the rest pair by content key, so an import with fresh ids still
 * matches; and `matching: "content"` pairs by content alone, for
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
  const deltas = diffModels(a, b, options).deltas;
  // A constraint across fact types has its own delta since WS3c; it reads
  // here as the change its fact type used to report.
  const across = deltas.flatMap((d): ChangeDescription[] => {
    if (d.elementType !== "constraint") return [];
    if (d.kind === "added") return [{ change: "constraintsAdded", constraints: [d.incoming!] }];
    if (d.kind === "removed") return [{ change: "constraintsRemoved", constraints: [d.existing!] }];
    return [...d.changes];
  });
  const delta = deltas.find((d) => d.elementType === "fact_type")!;
  return [...delta.changes, ...across].flatMap((c: ChangeDescription) => {
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

  it("reads a role that swapped places as a change of an id-joined pair", () => {
    // The fact type's roles swap places under the same ids. The constraint
    // names the same role, now at the other position, which a reading
    // addresses it by.
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
    expect(constraintChanges(a, b)).toEqual([["constraintsModified", [["c-1", "c-1"]]]]);
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

  it("reads a reorder of a ring's look-alike roles as a change of an id-joined pair", () => {
    // Both roles are played by Person and share a name, and the reading is
    // unchanged, so only position says the uniqueness moved from the
    // parent's place to the child's.
    const ring = (order: [string, string]) => {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
      m.addFactType({
        id: "ft-r",
        name: "Person is parent of Person",
        roles: order.map((id) => ({ id, name: "is related to", playerId: "ot-p" })),
        readings: ["{0} is parent of {1}"],
        constraints: [uc("c-1", ["r-p"])],
      });
      return m;
    };
    const a = ring(["r-p", "r-c"]);
    const b = ring(["r-c", "r-p"]);
    const delta = diffModels(a, b).deltas.find((d) => d.elementType === "fact_type")!;
    expect(delta.changes.map((c) => c.change)).toEqual(["constraintsModified"]);
  });

  it("reads a holder that changed only its id as no change of the host's own roles", () => {
    const a = drives([uc("c-1", ["r-1"])]);
    const b = new OrmModel({ name: "M" });
    b.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
    b.addObjectType({ id: "ot-c", name: "Car", kind: "entity", referenceMode: "vin" });
    b.addFactType({
      id: "ft-drives",
      name: "Person drives Car",
      roles: [
        { id: "r-1", name: "drives", playerId: "ot-p" },
        { id: "r-2", name: "is driven by", playerId: "ot-c" },
      ],
      readings: ["{0} drives {1}"],
      constraints: [uc("c-1", ["r-1"])],
    });
    expect(constraintChanges(a, b)).toEqual([]);
  });

  it("names the modality when an edit changes only that", () => {
    const a = drives([{ id: "c-1", type: "mandatory", roleId: "r-1" }]);
    const b = drives([{ id: "c-1", type: "mandatory", roleId: "r-1", modality: "deontic" }]);
    const delta = diffModels(a, b).deltas.find((d) => d.elementType === "fact_type")!;
    expect(delta.changeDescriptions).toEqual([
      "constraints modified: mandatory to mandatory (deontic)",
    ]);
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

describe("which key reads a role", () => {
  /** Person drives Car with the role ids in `order`, and a mandatory on r-1. */
  const swapped = (order: [string, string]) => {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
    m.addObjectType({ id: "ot-c", name: "Car", kind: "entity", referenceMode: "vin" });
    m.addFactType({
      id: "ft-d",
      name: "Person drives Car",
      roles: [
        { id: order[0], name: "drives", playerId: "ot-p" },
        { id: order[1], name: "is driven by", playerId: "ot-c" },
      ],
      readings: ["{0} drives {1}"],
      constraints: [{ id: "c-1", type: "mandatory", roleId: "r-1" }],
    });
    return m;
  };

  it("keys by position in the content pass, so a coincidental role id pairs nothing", () => {
    // r-1 is the driver's role in one model and the car's in the other: a
    // different role under the same id, and a different constraint.
    expect(
      constraintChanges(swapped(["r-1", "r-2"]), swapped(["r-2", "r-1"]), {
        matching: "content",
      }),
    ).toEqual([
      ["constraintsAdded", ["c-1"]],
      ["constraintsRemoved", ["c-1"]],
    ]);
  });

  /**
   * Person drives Car, Person owns Car (ft-2) and Person rents Car (ft-3),
   * with an external uniqueness on "drives" spanning r-2 and r-4; `r4Host`
   * holds r-4, the other holds r-5, and ft-2 is named `ft2Name`.
   */
  const threeFacts = (r4Host: "ft-2" | "ft-3", ft2Name = "Person owns Car") => {
    const m = drives([]);
    for (const [id, name] of [["ft-2", ft2Name], ["ft-3", "Person rents Car"]] as const) {
      m.addFactType({
        id,
        name,
        roles: [
          { id: `${id}-p`, name: "x", playerId: "ot-p" },
          { id: r4Host === id ? "r-4" : "r-5", name: "y", playerId: "ot-c" },
        ],
        readings: ["{0} x {1}"],
      });
    }
    m.addConstraint({
      id: "eu-1",
      type: "external_uniqueness",
      roleIds: ["r-2", "r-4"],
    });
    return m;
  };

  it("reads a role moved to another fact type as a change of a pair joined by id", () => {
    expect(constraintChanges(threeFacts("ft-2"), threeFacts("ft-3")))
      .toEqual([["constraintsModified", [["eu-1", "eu-1"]]]]);
  });

  it("reads a holder renamed under its kept id as no change, since the diff pairs it by id", () => {
    // Before model-invariants workstream 2 the diff paired fact types by
    // name, so the rename read as a modification of every constraint
    // across the renamed fact type.
    expect(constraintChanges(threeFacts("ft-2"), threeFacts("ft-2", "Person leases Car")))
      .toEqual([]);
  });

  it("reads a holder that changed only its id as no change", () => {
    // What a merge leaves behind: an accepted fact type keeps the existing
    // id and takes the incoming roles.
    const reId = (m: OrmModel) => {
      const ft2 = m.getFactType("ft-2")!;
      // Removing a fact type drops the constraints across fact types that
      // touch it; a merge adds them back through their own deltas.
      const touching = m.constraints.filter((c) => m.factTypesOf(c).includes(ft2));
      m.removeFactType("ft-2");
      m.addFactType({
        id: "ft-2b",
        name: ft2.name,
        roles: ft2.roles.map((r) => ({ id: r.id, name: r.name, playerId: r.playerId })),
        readings: ft2.readings.map((r) => r.template),
      });
      for (const c of touching) m.addConstraint(c);
      return m;
    };
    expect(constraintChanges(threeFacts("ft-2"), reId(threeFacts("ft-2")))).toEqual([]);
  });
});

describe("content-only constraint matching", () => {
  it("names the modality in the added and removed prose too", () => {
    const a = drives([{ id: "c-1", type: "mandatory", roleId: "r-1" }]);
    const b = drives([{ id: "c-1", type: "mandatory", roleId: "r-1", modality: "deontic" }]);
    const delta = diffModels(a, b, { matching: "content" }).deltas
      .find((d) => d.elementType === "fact_type")!;
    expect(delta.changeDescriptions).toEqual([
      "constraints added: mandatory (deontic)",
      "constraints removed: mandatory",
    ]);
  });

  it("never pairs two different constraints by a coincidental id", () => {
    const a = drives([uc("c-1", ["r-1"])]);
    const b = drives([uc("c-1", ["r-2"])]);
    expect(constraintChanges(a, b, { matching: "content" })).toEqual([
      ["constraintsAdded", ["c-1"]],
      ["constraintsRemoved", ["c-1"]],
    ]);
  });

  it("still pairs equal content whatever the ids", () => {
    expect(
      constraintChanges(drives([uc("c-a", ["r-1"])]), drives([uc("c-b", ["r-1"])]), {
        matching: "content",
      }),
    ).toEqual([]);
  });
});
