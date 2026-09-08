/**
 * Tests for objectified fact type relational mapping.
 *
 * Verifies that the RelationalMapper correctly handles objectified fact types:
 *   - Objectified entity table absorbs FK columns from the underlying fact type
 *   - PK becomes composite of the FK columns (replacing reference mode)
 *   - Underlying fact type is excluded from normal fact type processing
 *   - Same-player roles produce disambiguated column names
 *   - FK constraints reference the correct tables
 *   - DDL rendering includes the objectified table correctly
 */
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { renderDdl } from "../../src/mapping/renderers/ddl.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const mapper = new RelationalMapper();

describe("objectified fact type relational mapping", () => {
  describe("basic objectification (different role players)", () => {
    it("absorbs FK columns into the objectified entity table", () => {
      const model = new ModelBuilder("Employment")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .build();

      const schema = mapper.map(model);
      const empTable = schema.tables.find((t) => t.name === "employment")!;

      // The two absorbed FK columns and nothing else. Employment's
      // reference mode is not mapped: an objectified entity is identified
      // by the fact type it objectifies, so employment_id would be
      // neither key nor reference (mapper-key-settlement.spec.md).
      expect(empTable.columns.map((c) => c.name)).toEqual(["company_id", "person_id"]);
    });

    it("sets PK to composite of FK columns", () => {
      const model = new ModelBuilder("Employment")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .build();

      const schema = mapper.map(model);
      const empTable = schema.tables.find((t) => t.name === "employment")!;

      expect(empTable.primaryKey.columnNames).toEqual([
        "company_id",
        "person_id",
      ]);
    });

    it("creates FK constraints to both referenced tables", () => {
      const model = new ModelBuilder("Employment")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .build();

      const schema = mapper.map(model);
      const empTable = schema.tables.find((t) => t.name === "employment")!;

      expect(empTable.foreignKeys).toHaveLength(2);

      const companyFk = empTable.foreignKeys.find(
        (fk) => fk.referencedTable === "company",
      )!;
      expect(companyFk.columnNames).toEqual(["company_id"]);
      expect(companyFk.referencedColumns).toEqual(["company_id"]);

      const personFk = empTable.foreignKeys.find(
        (fk) => fk.referencedTable === "person",
      )!;
      expect(personFk.columnNames).toEqual(["person_id"]);
      expect(personFk.referencedColumns).toEqual(["person_id"]);
    });
  });

  describe("same-player roles (self-referencing fact type)", () => {
    it("disambiguates column names when same entity plays both roles", () => {
      const model = new ModelBuilder("Marriage")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Marriage", { referenceMode: "marriage_id" })
        .withBinaryFactType("Person marries Person", {
          role1: { player: "Person", name: "marries" },
          role2: { player: "Person", name: "is married to" },
        })
        .withObjectifiedFactType("Person marries Person", "Marriage")
        .build();

      const schema = mapper.map(model);
      const marriageTable = schema.tables.find((t) => t.name === "marriage")!;

      // First role gets "person_id", second gets disambiguated name.
      const colNames = marriageTable.columns.map((c) => c.name);
      expect(colNames).toContain("person_id");
      // The second column should be disambiguated.
      const nonPkCols = colNames.filter((n) => n !== "marriage_id");
      expect(nonPkCols).toHaveLength(2);
      expect(new Set(nonPkCols).size).toBe(2); // All unique names.
    });

    it("sets composite PK with both disambiguated columns", () => {
      const model = new ModelBuilder("Marriage")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Marriage", { referenceMode: "marriage_id" })
        .withBinaryFactType("Person marries Person", {
          role1: { player: "Person", name: "marries" },
          role2: { player: "Person", name: "is married to" },
        })
        .withObjectifiedFactType("Person marries Person", "Marriage")
        .build();

      const schema = mapper.map(model);
      const marriageTable = schema.tables.find((t) => t.name === "marriage")!;

      expect(marriageTable.primaryKey.columnNames).toHaveLength(2);
      // Both PK columns should reference person table.
      expect(marriageTable.foreignKeys).toHaveLength(2);
      for (const fk of marriageTable.foreignKeys) {
        expect(fk.referencedTable).toBe("person");
        expect(fk.referencedColumns).toEqual(["person_id"]);
      }
    });
  });

  describe("exclusion from normal processing", () => {
    it("does not create an associative table for the objectified fact type", () => {
      const model = new ModelBuilder("Employment")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .build();

      const schema = mapper.map(model);

      // Should have 3 entity tables, no associative table.
      expect(schema.tables).toHaveLength(3);
      expect(schema.tables.map((t) => t.name).sort()).toEqual([
        "company",
        "employment",
        "person",
      ]);
    });

    it("does not add FK columns to role players from the objectified fact type", () => {
      const model = new ModelBuilder("Employment")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .build();

      const schema = mapper.map(model);
      const companyTable = schema.tables.find((t) => t.name === "company")!;
      const personTable = schema.tables.find((t) => t.name === "person")!;

      // Role player tables should only have their PK column.
      expect(companyTable.columns).toHaveLength(1);
      expect(personTable.columns).toHaveLength(1);
      expect(companyTable.foreignKeys).toHaveLength(0);
      expect(personTable.foreignKeys).toHaveLength(0);
    });
  });

  describe("alongside other fact types", () => {
    it("maps non-objectified fact types normally", () => {
      const model = new ModelBuilder("Mixed")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .withBinaryFactType("Person lives in Company", {
          role1: { player: "Person", name: "lives in" },
          role2: { player: "Company", name: "has resident" },
          uniqueness: "role1",
        })
        .build();

      const schema = mapper.map(model);

      // The non-objectified fact type should produce a FK on Person's table.
      const personTable = schema.tables.find((t) => t.name === "person")!;
      expect(personTable.foreignKeys).toHaveLength(1);
      expect(personTable.foreignKeys[0]!.referencedTable).toBe("company");
    });
  });

  describe("DDL rendering", () => {
    it("renders objectified table with composite PK and FK constraints", () => {
      const model = new ModelBuilder("Employment")
        .withEntityType("Company", { referenceMode: "company_id" })
        .withEntityType("Person", { referenceMode: "person_id" })
        .withEntityType("Employment", { referenceMode: "employment_id" })
        .withBinaryFactType("Company employs Person", {
          role1: { player: "Company", name: "employs" },
          role2: { player: "Person", name: "works for" },
        })
        .withObjectifiedFactType("Company employs Person", "Employment")
        .build();

      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      expect(ddl).toContain("CREATE TABLE employment");
      expect(ddl).toContain("PRIMARY KEY (company_id, person_id)");
      expect(ddl).toContain("FOREIGN KEY (company_id) REFERENCES company (company_id)");
      expect(ddl).toContain("FOREIGN KEY (person_id) REFERENCES person (person_id)");
    });
  });
});
