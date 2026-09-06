/**
 * Tests for the import_model tool.
 */
import { describe, expect, it } from "vitest";
import { executeImportModel } from "../../src/tools/importModel.js";

describe("import_model tool", () => {
  describe("DDL format", () => {
    it("should import simple DDL", async () => {
      const ddl = `
        CREATE TABLE users (
          id INT PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          email VARCHAR(100)
        );
      `;

      const result = await executeImportModel(ddl, "ddl", "Test Model");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("name: Test Model");
      expect(yaml).toContain("Users");
      expect(yaml).toContain("confidence: medium");
    });

    it("should import DDL with foreign keys", async () => {
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

      const result = await executeImportModel(ddl, "ddl");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("Departments");
      expect(yaml).toContain("Employees");
      expect(yaml).toContain("fact_types");
    });

    it("should include warnings in output", async () => {
      const ddl = ""; // Empty DDL

      const result = await executeImportModel(ddl, "ddl");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("# Import Warnings:");
      expect(yaml).toContain("confidence: low");
    });
  });

  describe("OpenAPI format", () => {
    it("should import simple OpenAPI spec", async () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            User: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
              },
              required: ["id", "name"],
            },
          },
        },
      });

      const result = await executeImportModel(spec, "openapi", "API Model");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("name: API Model");
      expect(yaml).toContain("User");
      expect(yaml).toContain("confidence: medium");
    });

    it("should import OpenAPI with relationships", async () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Department: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
              },
            },
            Employee: {
              type: "object",
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                department: {
                  $ref: "#/components/schemas/Department",
                },
              },
            },
          },
        },
      });

      const result = await executeImportModel(spec, "openapi");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("Department");
      expect(yaml).toContain("Employee");
      expect(yaml).toContain("fact_types");
    });

    it("should import OpenAPI YAML format", async () => {
      const yamlSpec = `
openapi: 3.0.0
info:
  title: Test API
  version: 1.0.0
components:
  schemas:
    Product:
      type: object
      properties:
        id:
          type: integer
        name:
          type: string
      required:
        - id
        - name
`;

      const result = await executeImportModel(yamlSpec, "openapi");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("Product");
      expect(yaml).toContain("confidence: medium");
    });

    it("should include warnings for unsupported features", async () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test API", version: "1.0.0" },
        components: {
          schemas: {
            Pet: {
              type: "object",
              oneOf: [{ type: "object" }],
              properties: {
                id: { type: "integer" },
              },
            },
          },
        },
      });

      const result = await executeImportModel(spec, "openapi");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("# Import Warnings:");
      expect(yaml).toContain("oneOf");
    });
  });

  describe("TypeScript format", () => {
    it("should import TypeScript project directory", async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = join(tmpdir(), `mcp-ts-test-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      try {
        writeFileSync(
          join(dir, "models.ts"),
          `export enum OrderStatus { Draft, Submitted, Fulfilled }
export interface Order { id: string; total: number; }`,
        );

        const result = await executeImportModel(dir, "typescript", "TS Model");
        const yaml = result.content[0]!.text;

        expect(yaml).toContain("name: TS Model");
        expect(yaml).toContain("OrderStatus");
        expect(yaml).toContain("Order");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("Java format", () => {
    it("should import Java project directory", async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = join(tmpdir(), `mcp-java-test-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      try {
        writeFileSync(
          join(dir, "Customer.java"),
          `@Entity
public class Customer {
    @Id
    private Long id;
    private String name;
}`,
        );
        writeFileSync(
          join(dir, "Status.java"),
          `public enum Status { Active, Inactive }`,
        );

        const result = await executeImportModel(dir, "java", "Java Model");
        const yaml = result.content[0]!.text;

        expect(yaml).toContain("name: Java Model");
        expect(yaml).toContain("Customer");
        expect(yaml).toContain("Status");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("Kotlin format", () => {
    it("should import Kotlin project directory", async () => {
      const { mkdirSync, writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = join(tmpdir(), `mcp-kotlin-test-${Date.now()}`);
      mkdirSync(dir, { recursive: true });
      try {
        writeFileSync(
          join(dir, "Color.kt"),
          `enum class Color { Red, Green, Blue }`,
        );

        const result = await executeImportModel(dir, "kotlin", "Kotlin Model");
        const yaml = result.content[0]!.text;

        expect(yaml).toContain("name: Kotlin Model");
        expect(yaml).toContain("Color");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("SQL format", () => {
    it("should import a single SQL file path with an explicit dialect", async () => {
      const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = mkdtempSync(join(tmpdir(), "mcp-sql-file-"));
      try {
        const file = join(dir, "schema.sql");
        writeFileSync(file, "CREATE TABLE accounts (id INT PRIMARY KEY, name VARCHAR(100));");

        const result = await executeImportModel(file, "sql", "SQL File Model", "postgres");
        const yaml = result.content[0]!.text;

        expect(yaml).toContain("name: SQL File Model");
        expect(yaml).toContain("# Import confidence:");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should import a directory of SQL files (async directory route)", async () => {
      const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = mkdtempSync(join(tmpdir(), "mcp-sql-dir-"));
      try {
        writeFileSync(
          join(dir, "orders.sql"),
          "CREATE TABLE orders (id INT PRIMARY KEY, total DECIMAL(10,2));",
        );

        const result = await executeImportModel(dir, "sql", "SQL Dir Model");
        const yaml = result.content[0]!.text;

        expect(yaml).toContain("name: SQL Dir Model");
        // Proves the directory (async) route ran, not the single-file parse.
        expect(yaml).toContain("SQL file(s)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("dbt format", () => {
    // Schema-only project (no .sql models): compileDbtSql finds nothing to
    // compile and returns early, so this exercises the dbt import path
    // without shelling out to the dbt CLI.
    async function writeDbtProject(dir: string): Promise<void> {
      const { mkdirSync, writeFileSync } = await import("node:fs");
      const { join } = await import("node:path");
      const modelsDir = join(dir, "models");
      mkdirSync(modelsDir, { recursive: true });
      writeFileSync(
        join(modelsDir, "schema.yml"),
        [
          "version: 2",
          "models:",
          "  - name: customers",
          "    columns:",
          "      - name: id",
          "      - name: name",
        ].join("\n"),
      );
    }

    it("should import a dbt project directory (env vars unset)", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = mkdtempSync(join(tmpdir(), "mcp-dbt-"));
      const savedTarget = process.env["DBT_TARGET_TYPE"];
      const savedAdapter = process.env["DBT_ADAPTER"];
      delete process.env["DBT_TARGET_TYPE"];
      delete process.env["DBT_ADAPTER"];
      try {
        await writeDbtProject(dir);
        const result = await executeImportModel(dir, "dbt", "dbt Model");
        const yaml = result.content[0]!.text;
        expect(yaml).toContain("name: dbt Model");
        // Proves the dbt schema-YAML pipeline ran over our fixture model.
        expect(yaml).toContain("customers");
      } finally {
        if (savedTarget !== undefined) process.env["DBT_TARGET_TYPE"] = savedTarget;
        if (savedAdapter !== undefined) process.env["DBT_ADAPTER"] = savedAdapter;
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it("should import a dbt project directory (env vars set)", async () => {
      const { mkdtempSync, rmSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");

      const dir = mkdtempSync(join(tmpdir(), "mcp-dbt-env-"));
      const savedTarget = process.env["DBT_TARGET_TYPE"];
      const savedHome = process.env["HOME"];
      process.env["DBT_TARGET_TYPE"] = "postgres";
      process.env["HOME"] = dir;
      try {
        await writeDbtProject(dir);
        const result = await executeImportModel(dir, "dbt", "dbt Env Model");
        const yaml = result.content[0]!.text;
        expect(yaml).toContain("name: dbt Env Model");
      } finally {
        if (savedTarget !== undefined) process.env["DBT_TARGET_TYPE"] = savedTarget;
        else delete process.env["DBT_TARGET_TYPE"];
        if (savedHome !== undefined) process.env["HOME"] = savedHome;
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("unknown format", () => {
    it("should return error for unknown format", async () => {
      const result = await executeImportModel(
        "content",
        "unknown" as any,
      );
      const text = result.content[0]!.text;

      expect(text).toContain("Error");
      expect(text).toContain("Unknown import format");
    });
  });

  describe("MCP format", () => {
    it("should return content in MCP format", async () => {
      const ddl = "CREATE TABLE test (id INT PRIMARY KEY);";
      const result = await executeImportModel(ddl, "ddl");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      expect(typeof result.content[0]!.text).toBe("string");
    });
  });

  describe("model naming", () => {
    it("should use provided model name", async () => {
      const ddl = "CREATE TABLE test (id INT PRIMARY KEY);";
      const result = await executeImportModel(ddl, "ddl", "Custom Name");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("name: Custom Name");
    });

    it("should use default model name if not provided", async () => {
      const ddl = "CREATE TABLE test (id INT PRIMARY KEY);";
      const result = await executeImportModel(ddl, "ddl");
      const yaml = result.content[0]!.text;

      // Should have some default name from the format
      expect(yaml).toMatch(/name:/);
    });
  });

  describe("comprehensive fixtures", () => {
    it("should handle realistic DDL with multiple tables and FKs", async () => {
      const ddl = `
        CREATE TABLE customers (
          customer_id INT PRIMARY KEY,
          customer_name VARCHAR(100) NOT NULL,
          email VARCHAR(255) UNIQUE,
          status VARCHAR(20)
        );

        CREATE TABLE orders (
          order_id INT PRIMARY KEY,
          customer_id INT NOT NULL,
          order_date DATE NOT NULL,
          total_amount DECIMAL(10, 2),
          FOREIGN KEY (customer_id) REFERENCES customers (customer_id)
        );

        CREATE TABLE order_items (
          item_id INT PRIMARY KEY,
          order_id INT NOT NULL,
          product_name VARCHAR(100) NOT NULL,
          quantity INT NOT NULL,
          unit_price DECIMAL(10, 2),
          FOREIGN KEY (order_id) REFERENCES orders (order_id)
        );
      `;

      const result = await executeImportModel(ddl, "ddl", "Order Management");
      const yaml = result.content[0]!.text;

      // Should have all three tables
      expect(yaml).toContain("Customers");
      expect(yaml).toContain("Orders");
      expect(yaml).toContain("OrderItems");

      // Should have fact types
      expect(yaml).toContain("fact_types");

      // Should have confidence
      expect(yaml).toMatch(/confidence: (high|medium|low)/);
    });

    it("should handle realistic OpenAPI spec with nested objects", async () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: {
          title: "Inventory API",
          version: "1.0.0",
        },
        components: {
          schemas: {
            Category: {
              type: "object",
              required: ["id", "name"],
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                description: { type: "string" },
              },
            },
            Product: {
              type: "object",
              required: ["id", "name", "category"],
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                sku: { type: "string" },
                price: { type: "number", format: "decimal" },
                category: {
                  $ref: "#/components/schemas/Category",
                },
                inStock: { type: "boolean" },
              },
            },
            Warehouse: {
              type: "object",
              required: ["id", "name"],
              properties: {
                id: { type: "integer" },
                name: { type: "string" },
                location: { type: "string" },
                products: {
                  type: "array",
                  items: {
                    $ref: "#/components/schemas/Product",
                  },
                },
              },
            },
          },
        },
      });

      const result = await executeImportModel(spec, "openapi", "Inventory System");
      const yaml = result.content[0]!.text;

      // Should have all entities
      expect(yaml).toContain("Category");
      expect(yaml).toContain("Product");
      expect(yaml).toContain("Warehouse");

      // Should have relationships
      expect(yaml).toContain("fact_types");

      // Should have confidence
      expect(yaml).toMatch(/confidence: (high|medium)/);
    });

    it("should include confidence level in output", async () => {
      const ddl = "CREATE TABLE simple (id INT PRIMARY KEY);";
      const result = await executeImportModel(ddl, "ddl");
      const yaml = result.content[0]!.text;

      expect(yaml).toMatch(/confidence: (high|medium|low)/);
    });

    it("should report warnings in YAML comments", async () => {
      const spec = JSON.stringify({
        openapi: "3.0.0",
        info: { title: "Test", version: "1.0.0" },
        components: {
          schemas: {
            ComplexType: {
              type: "object",
              allOf: [{ type: "object" }],
              properties: { id: { type: "integer" } },
            },
          },
        },
      });

      const result = await executeImportModel(spec, "openapi");
      const yaml = result.content[0]!.text;

      expect(yaml).toContain("# Import Warnings:");
      expect(yaml).toContain("allOf");
    });
  });
});
