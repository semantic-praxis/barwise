/**
 * Lineage over constraints across fact types (orm-format-3, Open decision
 * 9, WS3a-ii-c). A constraint is traced to, and named by, the fact types
 * it applies to rather than the one a 2.0 file nests it under, and an
 * entity's lineage lists it once even when it spans two of the entity's
 * fact types.
 */
import { describe, expect, it } from "vitest";
import { generateDdlLineage, generateModelLineage } from "../../src/lineage/generate.js";
import type { RelationalSchema } from "../../src/mapping/RelationalSchema.js";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** Room is in Building, Room has RoomNumber, Room has Area; the key nests in `host`. */
function rooms(host: "ft-in" | "ft-nr" | "ft-area"): OrmModel {
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
  model.addObjectType({ id: "ot-area", name: "Area", kind: "value" });
  const fact = (id: string, name: string, a: string, b: string, other: string) =>
    model.addFactType({
      id,
      name,
      roles: [
        { id: a, name: "r", playerId: "ot-room" },
        { id: b, name: "s", playerId: other },
      ],
      readings: [`{0} ${name} {1}`],
      constraints: host === id ? [key] : [],
    });
  fact("ft-in", "Room is in Building", "r-1", "r-2", "ot-building");
  fact("ft-nr", "Room has RoomNumber", "r-3", "r-4", "ot-nr");
  fact("ft-area", "Room has Area", "r-5", "r-6", "ot-area");
  return model;
}

/** A room table whose key traces to the composite key. */
function schemaFor(model: OrmModel): RelationalSchema {
  return {
    sourceModelId: model.id,
    tables: [
      {
        name: "room",
        columns: [],
        primaryKey: { columnNames: ["building_code", "room_number"] },
        foreignKeys: [
          {
            columnNames: ["building_code"],
            referencedTable: "building",
            referencedColumns: ["code"],
            sourceConstraintId: "c-room-key",
          },
        ],
        sourceElementId: "ot-room",
      },
    ],
  };
}

const KEY_NAME = "External UC: Room is in Building and Room has RoomNumber";

describe("lineage over constraints across fact types", () => {
  it("traces a key to every fact type it spans, named by them, whichever fact type nests it", () => {
    const traced = (host: "ft-in" | "ft-nr" | "ft-area") => {
      const model = rooms(host);
      return generateDdlLineage(model, schemaFor(model)).find((e) => e.artifact === "room")!
        .sources;
    };
    const fromIn = traced("ft-in");
    expect(fromIn.filter((s) => s.elementType === "Constraint")).toEqual([
      { elementId: "c-room-key", elementType: "Constraint", elementName: KEY_NAME },
    ]);
    expect(fromIn.filter((s) => s.elementType === "FactType").map((s) => s.elementId)).toEqual([
      "ft-in",
      "ft-nr",
    ]);
    expect(traced("ft-nr")).toEqual(fromIn);
    expect(traced("ft-area")).toEqual(fromIn);
  });

  it("labels a constraint none of whose roles resolve without an empty span", () => {
    const model = rooms("ft-in");
    // Nested anywhere, a constraint across fact types with no roles has no span.
    model.getFactType("ft-in")!.addConstraint({
      id: "c-empty",
      type: "external_uniqueness",
      roleIds: [],
    });
    const schema = schemaFor(model);
    schema.tables[0]!.foreignKeys[0] = {
      ...schema.tables[0]!.foreignKeys[0]!,
      sourceConstraintId: "c-empty",
    };
    const sources = generateDdlLineage(model, schema).find((e) => e.artifact === "room")!.sources;
    expect(sources.filter((s) => s.elementType === "Constraint")).toEqual([
      { elementId: "c-empty", elementType: "Constraint", elementName: "External UC" },
    ]);
  });

  it("lists the key once in its entity's lineage, named by its span, whichever fact type nests it", () => {
    for (const host of ["ft-in", "ft-nr", "ft-area"] as const) {
      const room = generateModelLineage(rooms(host)).find((e) => e.artifact === "Room")!;
      expect(room.sources.filter((s) => s.elementType === "Constraint"), host).toEqual([
        { elementId: "c-room-key", elementType: "Constraint", elementName: KEY_NAME },
      ]);
    }
  });
});
