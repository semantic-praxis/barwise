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
import type { ExternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { loadNestedUnder } from "../helpers/nestedUnder.js";

type Host = "ft-in" | "ft-nr" | "ft-area" | "ft-campus";

/**
 * Room is in Building, Room has RoomNumber, Room has Area, and Campus has
 * Area, which no Room plays in, with the key, loaded from a 2.0 file that
 * nests the key under `host`.
 */
function rooms(host: Host): OrmModel {
  const key: ExternalConstraint = {
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
  model.addObjectType({ id: "ot-campus", name: "Campus", kind: "entity", referenceMode: "name" });
  const fact = (
    id: string,
    name: string,
    a: string,
    b: string,
    other: string,
    player = "ot-room",
  ) =>
    model.addFactType({
      id,
      name,
      roles: [
        { id: a, name: "r", playerId: player },
        { id: b, name: "s", playerId: other },
      ],
      readings: [`{0} ${name} {1}`],
    });
  fact("ft-in", "Room is in Building", "r-1", "r-2", "ot-building");
  fact("ft-nr", "Room has RoomNumber", "r-3", "r-4", "ot-nr");
  fact("ft-area", "Room has Area", "r-5", "r-6", "ot-area");
  fact("ft-campus", "Campus has Area", "r-7", "r-8", "ot-area", "ot-campus");
  model.addConstraint(key);
  return loadNestedUnder(model, host);
}

/** A room table whose foreign key traces to `constraintId`. */
function schemaFor(model: OrmModel, constraintId = "c-room-key"): RelationalSchema {
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
            sourceConstraintId: constraintId,
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
    const traced = (host: Host) => {
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
    expect(traced("ft-campus")).toEqual(fromIn);
  });

  it("labels a constraint none of whose roles resolve without an empty span", () => {
    const model = rooms("ft-in");
    // A constraint across fact types with no roles has no span.
    model.addConstraint({
      id: "c-empty",
      type: "external_uniqueness",
      roleIds: [],
    });
    const sources =
      generateDdlLineage(model, schemaFor(model, "c-empty")).find((e) => e.artifact === "room")!
        .sources;
    expect(sources.filter((s) => s.elementType === "Constraint")).toEqual([
      { elementId: "c-empty", elementType: "Constraint", elementName: "External UC" },
    ]);
  });

  it("lists the key once in its entity's lineage, named by its span, whichever fact type nests it", () => {
    for (const host of ["ft-in", "ft-nr", "ft-area", "ft-campus"] as const) {
      const room = generateModelLineage(rooms(host)).find((e) => e.artifact === "Room")!;
      expect(room.sources.filter((s) => s.elementType === "Constraint"), host).toEqual([
        { elementId: "c-room-key", elementType: "Constraint", elementName: KEY_NAME },
      ]);
    }
  });

  it("leaves the key out of the lineage of an entity whose fact type nests it without being spanned", () => {
    const campus = generateModelLineage(rooms("ft-campus")).find((e) => e.artifact === "Campus")!;
    expect(campus.sources.filter((s) => s.elementType === "Constraint")).toEqual([]);
    expect(campus.sources.map((s) => s.elementId)).toContain("ft-campus");
  });
});
