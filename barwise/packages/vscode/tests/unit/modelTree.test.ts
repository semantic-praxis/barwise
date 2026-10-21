/**
 * The sidebar's model tree lists, under each fact type, every constraint
 * that applies to it (orm-format-3, Open decision 9): a composite key
 * spanning two fact types shows under both, and under neither of the
 * others, whichever fact type a 2.0 file nests it in.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it, vi } from "vitest";

vi.mock("vscode", async () => (await import("./helpers/inertModule.js")).inertModule());

const { buildTree } = await import("../../src/sidebar/ModelTreeProvider.js");

/** Room is in Building, Room has RoomNumber, Room has Area; the key nests in `host`. */
function rooms(host: "ft-in" | "ft-nr" | "ft-area"): OrmModel {
  const model = new OrmModel({ name: "Facilities" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-b", name: "Building", kind: "entity", referenceMode: "code" });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  model.addObjectType({ id: "ot-a", name: "Area", kind: "value" });
  const fact = (id: string, name: string, other: string) =>
    model.addFactType({
      id,
      name,
      roles: [
        { id: `${id}-room`, name: "r", playerId: "ot-room" },
        { id: `${id}-other`, name: "s", playerId: other },
      ],
      readings: ["{0} r {1}"],
      constraints: host === id
        ? [{ id: "c-key", type: "external_uniqueness", roleIds: ["ft-in-other", "ft-nr-other"] }]
        : [],
    });
  fact("ft-in", "Room is in Building", "ot-b");
  fact("ft-nr", "Room has RoomNumber", "ot-nr");
  fact("ft-area", "Room has Area", "ot-a");
  return model;
}

/** Fact type name to the labels of its constraint children. */
function constraintsByFactType(model: OrmModel): Record<string, string[]> {
  const factTypes = buildTree(model).find((c) => c.label === "Fact Types")!.children!;
  return Object.fromEntries(
    factTypes.map((ft) => [ft.label, (ft.children ?? []).map((c) => c.label)]),
  );
}

describe("model tree constraints", () => {
  it("lists a constraint touching no fact type under Unattached Constraints", () => {
    const model = rooms("ft-area");
    model.getFactType("ft-area")!.addConstraint({
      id: "c-gone",
      type: "exclusion",
      roleIds: ["r-gone", "r-lost"],
    });
    const unattached = buildTree(model).find((c) => c.label === "Unattached Constraints");
    expect(unattached?.children?.map((c) => [c.label, c.description])).toEqual([
      ["Exclusion", "r-gone, r-lost"],
    ]);
    expect(buildTree(rooms("ft-area")).map((c) => c.label)).not.toContain("Unattached Constraints");
  });

  it("lists a key under each fact type it spans, whichever fact type nests it", () => {
    for (const host of ["ft-in", "ft-nr", "ft-area"] as const) {
      expect(constraintsByFactType(rooms(host)), host).toEqual({
        "Room has Area": [],
        "Room has RoomNumber": ["External Uniqueness"],
        "Room is in Building": ["External Uniqueness"],
      });
    }
  });
});
