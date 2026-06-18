import { describe, expect, it } from "vitest";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

describe("DdlImportFormat", () => {
  const importer = new DdlImportFormat();

  describe("metadata", () => {
    it("should have correct name and description", () => {
      expect(importer.name).toBe("ddl");
      expect(importer.description).toContain("SQL DDL");
    });
  });

  describe("parse", () => {
    it("should handle empty input", () => {
      const result = importer.parse("");
      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.warnings).toContain("No CREATE TABLE statements found in input");
      expect(result.confidence).toBe("low");
    });

    it("should parse simple table with primary key", () => {
      const ddl = `
        CREATE TABLE users (
          id INT PRIMARY KEY,
          name VARCHAR(100) NOT NULL
        );
      `;

      const result = importer.parse(ddl);

      // Should create User entity
      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("Users");
      expect(entities[0]?.referenceMode).toBe("id");

      // Should create Name value type
      const values = result.model.objectTypes.filter((ot) => ot.kind === "value");
      expect(values.length).toBeGreaterThan(0);
      const nameType = values.find((v) => v.name === "Name");
      expect(nameType).toBeDefined();
      expect(nameType?.dataType?.name).toBe("text");

      // Should create "User has Name" fact type
      const factTypes = result.model.factTypes;
      const hasNameFact = factTypes.find((ft) => ft.name.includes("has Name"));
      expect(hasNameFact).toBeDefined();
      expect(hasNameFact?.roles).toHaveLength(2);

      // Should have mandatory constraint on name (NOT NULL)
      const allConstraints = result.model.factTypes.flatMap((ft) => ft.constraints);
      const mandatoryConstraints = allConstraints.filter((c) => c.type === "mandatory");
      expect(mandatoryConstraints.length).toBeGreaterThan(0);

      expect(result.confidence).toBe("medium");
    });

    it("should parse foreign key relationships", () => {
      const ddl = `
        CREATE TABLE departments (
          id INT PRIMARY KEY,
          name VARCHAR(100)
        );

        CREATE TABLE employees (
          id INT PRIMARY KEY,
          name VARCHAR(100),
          department_id INT,
          FOREIGN KEY (department_id) REFERENCES departments (id)
        );
      `;

      const result = importer.parse(ddl);

      // Should create two entity types
      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(2);

      const dept = entities.find((e) => e.name === "Departments");
      const emp = entities.find((e) => e.name === "Employees");
      expect(dept).toBeDefined();
      expect(emp).toBeDefined();

      // Should create a fact type for the foreign key relationship
      const factTypes = result.model.factTypes;
      const fkFact = factTypes.find(
        (ft) =>
          ft.roles.some((r) => r.playerId === dept?.id)
          && ft.roles.some((r) => r.playerId === emp?.id),
      );
      expect(fkFact).toBeDefined();

      // FK relationship should have uniqueness constraint (many-to-one)
      const uniquenessConstraints = fkFact?.constraints.filter(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uniquenessConstraints).toHaveLength(1);
    });

    it("should handle UNIQUE constraints", () => {
      const ddl = `
        CREATE TABLE users (
          id INT PRIMARY KEY,
          email VARCHAR(255) UNIQUE NOT NULL
        );
      `;

      const result = importer.parse(ddl);

      // Should create user entity and email value type
      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(1);

      const factTypes = result.model.factTypes;
      const emailFact = factTypes.find((ft) => ft.name.includes("Email"));
      expect(emailFact).toBeDefined();

      // Should have uniqueness on the entity side (unique email per user)
      const constraints = emailFact?.constraints.filter(
        (c) => c.type === "internal_uniqueness",
      );
      // At least one uniqueness constraint
      expect(constraints?.length).toBeGreaterThan(0);
    });

    it("should handle multiple tables", () => {
      const ddl = `
        CREATE TABLE customers (
          id INT PRIMARY KEY,
          name VARCHAR(100)
        );

        CREATE TABLE orders (
          id INT PRIMARY KEY,
          order_date DATE
        );

        CREATE TABLE products (
          id INT PRIMARY KEY,
          name VARCHAR(100),
          price DECIMAL(10, 2)
        );
      `;

      const result = importer.parse(ddl);

      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(3);
      expect(entities.map((e) => e.name).sort()).toEqual([
        "Customers",
        "Orders",
        "Products",
      ]);
    });

    it("should handle unsupported syntax gracefully", () => {
      const ddl = `
        CREATE TABLE test (
          id INT PRIMARY KEY,
          computed_col INT GENERATED ALWAYS AS (id * 2) STORED
        );
      `;

      const result = importer.parse(ddl);

      // Should still create the entity even if some columns fail
      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(1);

      // May have warnings about unsupported syntax
      expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    });

    it("should convert snake_case to PascalCase", () => {
      const ddl = `
        CREATE TABLE user_accounts (
          id INT PRIMARY KEY
        );
      `;

      const result = importer.parse(ddl);

      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(1);
      expect(entities[0]?.name).toBe("UserAccounts");
    });

    it("should map SQL types to conceptual types", () => {
      const ddl = `
        CREATE TABLE test_types (
          id INT PRIMARY KEY,
          text_col VARCHAR(100),
          int_col INTEGER,
          dec_col DECIMAL(10, 2),
          bool_col BOOLEAN,
          date_col DATE,
          time_col TIME,
          datetime_col DATETIME,
          uuid_col UUID
        );
      `;

      const result = importer.parse(ddl);

      const valueTypes = result.model.objectTypes.filter((ot) => ot.kind === "value");

      // Check a few key type mappings
      const textType = valueTypes.find((v) => v.name === "TextCol");
      expect(textType?.dataType?.name).toBe("text");

      const intType = valueTypes.find((v) => v.name === "IntCol");
      expect(intType?.dataType?.name).toBe("integer");

      const decType = valueTypes.find((v) => v.name === "DecCol");
      expect(decType?.dataType?.name).toBe("decimal");

      const boolType = valueTypes.find((v) => v.name === "BoolCol");
      expect(boolType?.dataType?.name).toBe("boolean");

      const dateType = valueTypes.find((v) => v.name === "DateCol");
      expect(dateType?.dataType?.name).toBe("date");

      const uuidType = valueTypes.find((v) => v.name === "UuidCol");
      expect(uuidType?.dataType?.name).toBe("uuid");
    });

    it("should use custom model name from options", () => {
      const ddl = `
        CREATE TABLE test (
          id INT PRIMARY KEY
        );
      `;

      const result = importer.parse(ddl, { modelName: "Custom Model" });
      expect(result.model.name).toBe("Custom Model");
    });

    it("should handle nullable columns correctly", () => {
      const ddl = `
        CREATE TABLE test (
          id INT PRIMARY KEY,
          required_col VARCHAR(100) NOT NULL,
          optional_col VARCHAR(100)
        );
      `;

      const result = importer.parse(ddl);

      // Required column should have mandatory constraint
      const requiredFact = result.model.factTypes.find((ft) => ft.name.includes("RequiredCol"));
      expect(requiredFact).toBeDefined();

      const mandatoryOnRequired = requiredFact?.constraints.filter(
        (c) => c.type === "mandatory",
      );
      expect(mandatoryOnRequired?.length).toBeGreaterThan(0);

      // Optional column should NOT have mandatory constraint
      const optionalFact = result.model.factTypes.find((ft) => ft.name.includes("OptionalCol"));
      expect(optionalFact).toBeDefined();

      const mandatoryOnOptional = optionalFact?.constraints.filter(
        (c) => c.type === "mandatory",
      );
      expect(mandatoryOnOptional?.length).toBe(0);
    });

    it("should handle inline PRIMARY KEY syntax", () => {
      const ddl = `
        CREATE TABLE test (
          id INT PRIMARY KEY,
          name VARCHAR(100)
        );
      `;

      const result = importer.parse(ddl);

      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(1);
      expect(entities[0]?.referenceMode).toBe("id");
    });

    it("should handle table-level PRIMARY KEY constraint", () => {
      const ddl = `
        CREATE TABLE test (
          id INT,
          code VARCHAR(10),
          PRIMARY KEY (id)
        );
      `;

      const result = importer.parse(ddl);

      const entities = result.model.objectTypes.filter((ot) => ot.kind === "entity");
      expect(entities).toHaveLength(1);
      expect(entities[0]?.referenceMode).toBe("id");
    });
  });
});
