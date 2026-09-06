/**
 * Tests for subtype fact relational mapping.
 *
 * Verifies that the RelationalMapper correctly handles subtype facts:
 *   - Shared PK pattern: subtype table's PK is also a FK to supertype
 *   - Separate identification: FK column added to subtype table
 *   - DDL rendering includes FK constraints for subtype relationships
 *   - ModelBuilder withSubtypeFact() integration
 */
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { renderDdl } from "../../src/mapping/renderers/ddl.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("subtype relational mapping", () => {
  describe("shared PK (providesIdentification = true)", () => {
    it("adds FK from subtype PK to supertype table", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withSubtypeFact("Employee", "Person")
        .build();

      const schema = mapper.map(model);
      const employeeTable = schema.tables.find((t) => t.name === "employee")!;

      expect(employeeTable.foreignKeys).toHaveLength(1);
      expect(employeeTable.foreignKeys[0]!.referencedTable).toBe("person");
      expect(employeeTable.foreignKeys[0]!.columnNames).toEqual(["employee_id"]);
      expect(employeeTable.foreignKeys[0]!.referencedColumns).toEqual(["person_id"]);
    });

    it("does not add extra columns for shared PK", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withSubtypeFact("Employee", "Person")
        .build();

      const schema = mapper.map(model);
      const employeeTable = schema.tables.find((t) => t.name === "employee")!;

      // Only the PK column, no additional FK column.
      expect(employeeTable.columns).toHaveLength(1);
      expect(employeeTable.columns[0]!.name).toBe("employee_id");
    });

    it("still creates tables for both entity types", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withSubtypeFact("Employee", "Person")
        .build();

      const schema = mapper.map(model);
      expect(schema.tables).toHaveLength(2);
      expect(schema.tables.map((t) => t.name).sort()).toEqual(["employee", "person"]);
    });
  });

  describe("separate identification (providesIdentification = false)", () => {
    it("adds a FK column to the subtype table", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withSubtypeFact("Employee", "Person", { providesIdentification: false })
        .build();

      const schema = mapper.map(model);
      const employeeTable = schema.tables.find((t) => t.name === "employee")!;

      // PK column + FK column.
      expect(employeeTable.columns).toHaveLength(2);
      const fkCol = employeeTable.columns.find((c) => c.name === "person_id");
      expect(fkCol).toBeDefined();
      expect(fkCol!.nullable).toBe(false);

      expect(employeeTable.foreignKeys).toHaveLength(1);
      expect(employeeTable.foreignKeys[0]!.columnNames).toEqual(["person_id"]);
      expect(employeeTable.foreignKeys[0]!.referencedTable).toBe("person");
    });
  });

  describe("multi-level subtype hierarchy", () => {
    it("maps a three-level hierarchy", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withEntityType("Manager", { referenceMode: "manager_id" })
        .withSubtypeFact("Employee", "Person")
        .withSubtypeFact("Manager", "Employee")
        .build();

      const schema = mapper.map(model);
      expect(schema.tables).toHaveLength(3);

      const employeeTable = schema.tables.find((t) => t.name === "employee")!;
      expect(employeeTable.foreignKeys).toHaveLength(1);
      expect(employeeTable.foreignKeys[0]!.referencedTable).toBe("person");

      const managerTable = schema.tables.find((t) => t.name === "manager")!;
      expect(managerTable.foreignKeys).toHaveLength(1);
      expect(managerTable.foreignKeys[0]!.referencedTable).toBe("employee");
    });
  });

  describe("objectified entity with a composite PK used as a supertype (barwise-931)", () => {
    /**
     * "Employment" objectifies "Company employs Person", so its PK is the
     * composite [company_id, person_id] (objectifiedMapping.test.ts's
     * "sets PK to composite of FK columns"). "TemporaryEmployment" is then
     * declared a subtype of "Employment". Before the fix, mapSubtypeFact
     * read only primaryKey.columnNames[0], so the subtype's FK silently
     * referenced company_id alone and dropped person_id -- a composite key
     * truncated to its first column.
     */
    function buildCompositeSupertypeModel(providesIdentification: boolean) {
      return new ModelBuilder("Test")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withEntityType("TemporaryEmployment", { referenceMode: "temp_employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .withSubtypeFact("TemporaryEmployment", "Employment", { providesIdentification })
        .build();
    }

    it("shared PK: the subtype's FK to Employment covers both composite PK columns", () => {
      const model = buildCompositeSupertypeModel(true);
      const schema = mapper.map(model);
      const employmentTable = schema.tables.find((t) => t.name === "employment")!;
      expect(employmentTable.primaryKey.columnNames).toEqual(["company_id", "person_id"]);

      const tempTable = schema.tables.find((t) => t.name === "temporary_employment")!;
      const fk = tempTable.foreignKeys.find((f) => f.referencedTable === "employment")!;
      expect(fk).toBeDefined();
      expect(fk.referencedColumns).toEqual(["company_id", "person_id"]);
      expect(fk.columnNames).toHaveLength(fk.referencedColumns.length);
      // The subtype's own PK must extend to match, so the shared key is
      // actually shared rather than half-dropped.
      expect(tempTable.primaryKey.columnNames).toEqual(fk.columnNames);
    });

    it("separate identification: the subtype's FK to Employment covers both composite PK columns", () => {
      const model = buildCompositeSupertypeModel(false);
      const schema = mapper.map(model);

      const tempTable = schema.tables.find((t) => t.name === "temporary_employment")!;
      const fk = tempTable.foreignKeys.find((f) => f.referencedTable === "employment")!;
      expect(fk).toBeDefined();
      expect(fk.referencedColumns).toEqual(["company_id", "person_id"]);
      expect(fk.columnNames).toHaveLength(2);
      expect(new Set(fk.columnNames).size).toBe(2);
    });
  });

  describe("DDL rendering with subtype FK", () => {
    it("renders FK constraint for subtype relationship", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employee", { referenceMode: "employee_id" })
        .withSubtypeFact("Employee", "Person")
        .build();

      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      expect(ddl).toContain("FOREIGN KEY (employee_id) REFERENCES person (person_id)");
    });
  });
});
