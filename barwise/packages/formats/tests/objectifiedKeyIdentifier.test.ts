/**
 * An annotated table whose entity objectifies a relationship keyed on its
 * one column gets no second, typed identifier over that column
 * (objectified-key-identifier.spec.md, barwise-i3r). The round trips of the
 * tracked models are cli's dbtUniquenessRoundTrip test; this pins the
 * branches they cannot reach.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();

const line = (json: object) => `-- barwise:v1 ${JSON.stringify(json)}`;

/** Fact type names a player plays in. */
const factsOf = (model: OrmModel, player: string) => {
  const id = model.getObjectTypeByName(player)!.id;
  return model.factTypes.filter((f) => f.roles.some((r) => r.playerId === id)).map((f) => f.name)
    .sort();
};

const runTable = (supertypes: boolean) =>
  `CREATE TABLE material (material_number INT PRIMARY KEY);
CREATE TABLE batch (batch_number INT PRIMARY KEY);
${
    line({
      kind: "table",
      table: "work_order",
      entity: "WorkOrder",
      referenceMode: "work_order_number",
      objectifies: {
        factType: "Material is produced in Batch",
        readings: ["{0} is produced in {1}"],
        roles: [
          { name: "is produced in", player: "Material", columns: ["material_number"] },
          { name: "results from", player: "Batch", columns: ["batch_number"] },
        ],
      },
      ...(supertypes ? { supertypes: [] } : {}),
    })
  }
CREATE TABLE work_order (
  material_number INT NOT NULL REFERENCES material (material_number),
  batch_number INT NOT NULL REFERENCES batch (batch_number),
  ${
    line({
      kind: "column",
      table: "work_order",
      column: "work_order_number",
      factType: "WorkOrder has WorkOrderNumber",
      readings: ["{0} has {1}"],
      roles: [{ name: "has", player: "WorkOrder" }, {
        name: "identifies",
        player: "WorkOrderNumber",
      }],
      rowRole: 0,
    })
  }
  work_order_number INT NOT NULL UNIQUE,
  PRIMARY KEY (batch_number)
);`;

describe("a key the objectified relationship gives", () => {
  for (const supertypes of [true, false]) {
    it(`gets no typed identifier, ${supertypes ? "with" : "without"} a supertypes list`, () => {
      const { model } = ddl.parse(runTable(supertypes));
      expect(factsOf(model, "WorkOrder")).toEqual(["WorkOrder has WorkOrderNumber"]);
      expect(model.objectifiedFactTypes).toHaveLength(1);
      // Identified by the column the table line names as its reference mode.
      const work = model.getObjectTypeByName("WorkOrder")!;
      const id = model.preferredIdentifierOf(work.id);
      const ft = model.getFactTypeByName("WorkOrder has WorkOrderNumber")!;
      const valueRole = ft.roles.find((r) => r.playerId !== work.id)!.id;
      expect(ft.internalConstraints.find((c) => c.id === id)).toMatchObject({
        type: "internal_uniqueness",
        roleIds: [valueRole],
      });
    });
  }

  it("over values alone gives no key, so the table keeps its typed identifier", () => {
    // RelationalMapper keys an objectified table on its roles only when an
    // entity plays one; here none does, so the key column needs its own.
    const { model } = ddl.parse(`${
      line({
        kind: "table",
        table: "reading",
        entity: "Reading",
        referenceMode: "reading_id",
        objectifies: {
          factType: "MeterCode is read at ReadInstant",
          readings: ["{0} is read at {1}"],
          roles: [
            { name: "is read at", player: "MeterCode", columns: ["meter_code"] },
            { name: "is when", player: "ReadInstant", columns: ["read_instant"] },
          ],
        },
        supertypes: [],
      })
    }
CREATE TABLE reading (
  meter_code VARCHAR(10) NOT NULL,
  read_instant TIMESTAMP NOT NULL,
  PRIMARY KEY (meter_code)
);`);
    expect(model.objectifiedFactTypes).toHaveLength(1);
    expect(factsOf(model, "Reading")).toEqual(["Reading has MeterCode"]);
  });
});
