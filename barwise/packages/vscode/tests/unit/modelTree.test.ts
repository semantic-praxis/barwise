/**
 * The sidebar's model tree lists, under each fact type, every constraint
 * that applies to it (orm-format-3, Open decision 9): a composite key
 * spanning two fact types shows under both, and under neither of the
 * others, whichever fact type a 2.0 file nests it in.
 */
import { OrmModel, OrmYamlSerializer } from "@barwise/core";
import { describe, expect, it, vi } from "vitest";
import { parse, stringify } from "yaml";

vi.mock("vscode", async () => (await import("./helpers/inertModule.js")).inertModule());

const { buildTree } = await import("../../src/sidebar/ModelTreeProvider.js");

/**
 * Room is in Building, Room has RoomNumber, Room has Area, read back from a
 * 2.0 file that nests the key in `host`: in memory the key belongs to the
 * model (WS3c), so only a file can nest it. A save writes 3.0, which lists
 * the key in the model, so the document is restated as 2.0.
 */
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
    });
  fact("ft-in", "Room is in Building", "ot-b");
  fact("ft-nr", "Room has RoomNumber", "ot-nr");
  fact("ft-area", "Room has Area", "ot-a");
  model.addConstraint({
    id: "c-key",
    type: "external_uniqueness",
    roleIds: ["ft-in-other", "ft-nr-other"],
  });
  const yaml = new OrmYamlSerializer();
  type NestedFactType = { id: string; constraints?: { id: string; }[]; };
  const doc = parse(yaml.serialize(model)) as {
    orm_version: string;
    model: { fact_types: NestedFactType[]; constraints?: { id: string; }[]; };
  };
  doc.orm_version = "2.0";
  const fts = doc.model.fact_types;
  // No fact type here has a constraint of its own, so the key is all there is.
  const key = doc.model.constraints!.find((c) => c.id === "c-key")!;
  delete doc.model.constraints;
  fts.find((ft) => ft.id === host)!.constraints = [key];
  return yaml.deserialize(stringify(doc));
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
    model.addConstraint({
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
