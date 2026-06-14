/**
 * Tests for the DbtImportFormat.
 *
 * Verifies the directory-based dbt importer that discovers and reads
 * schema YAML files from a dbt project directory, wrapping the existing
 * DbtProjectImporter.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DbtImportFormat } from "../src/DbtImportFormat.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let testDir: string;

function createTestDir(): string {
  const dir = join(tmpdir(), `barwise-dbt-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeYaml(dir: string, relativePath: string, content: string): void {
  const fullPath = join(dir, relativePath);
  const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
  mkdirSync(parentDir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CUSTOMERS_YAML = `
models:
  - name: customers
    description: Customer overview data mart.
    columns:
      - name: customer_id
        description: Unique customer identifier.
        data_tests:
          - not_null
          - unique
      - name: customer_name
        description: Full name of the customer.
      - name: customer_type
        data_tests:
          - accepted_values:
              values: ["new", "returning"]
`;

const ORDERS_YAML = `
models:
  - name: orders
    description: Order fact table.
    columns:
      - name: order_id
        data_tests:
          - not_null
          - unique
      - name: customer_id
        data_tests:
          - not_null
          - relationships:
              to: ref('customers')
              field: customer_id
      - name: order_total
        data_type: "decimal(10,2)"
        data_tests:
          - not_null
`;

const SOURCES_YAML = `
sources:
  - name: ecom
    tables:
      - name: raw_customers
        columns:
          - name: id
            data_type: integer
`;

const DBT_PROJECT_YAML = `
name: test_project
version: "1.0.0"
profile: test
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DbtImportFormat", () => {
  const format = new DbtImportFormat();

  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  describe("interface properties", () => {
    it("has name 'dbt'", () => {
      expect(format.name).toBe("dbt");
    });

    it("has inputKind 'directory'", () => {
      expect(format.inputKind).toBe("directory");
    });

    it("has a description", () => {
      expect(format.description).toBeTruthy();
    });

    it("does not implement parse() (directory-only)", () => {
      expect(format.parse).toBeUndefined();
    });

    it("implements parseAsync()", () => {
      expect(typeof format.parseAsync).toBe("function");
    });
  });

  describe("directory discovery", () => {
    it("discovers YAML files under models/ directory", async () => {
      writeYaml(testDir, "models/marts/customers.yml", CUSTOMERS_YAML);
      writeYaml(testDir, "models/marts/orders.yml", ORDERS_YAML);
      writeYaml(testDir, "models/staging/_sources.yml", SOURCES_YAML);
      writeYaml(testDir, "dbt_project.yml", DBT_PROJECT_YAML);

      const result = await format.parseAsync!(testDir);

      // Should have discovered and parsed the models.
      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers).toBeDefined();
      expect(customers!.kind).toBe("entity");

      const orders = result.model.getObjectTypeByName("Orders");
      expect(orders).toBeDefined();
      expect(orders!.kind).toBe("entity");
    });

    it("falls back to project root when no models/ directory exists", async () => {
      writeYaml(testDir, "customers.yml", CUSTOMERS_YAML);

      const result = await format.parseAsync!(testDir);

      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers).toBeDefined();
    });

    it("skips non-schema YAML files (dbt_project.yml)", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);
      writeYaml(testDir, "dbt_project.yml", DBT_PROJECT_YAML);

      const result = await format.parseAsync!(testDir);

      // Should only process the schema file, not dbt_project.yml.
      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers).toBeDefined();
    });

    it("skips node_modules and target directories", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);
      writeYaml(testDir, "node_modules/some_dep/schema.yml", CUSTOMERS_YAML);
      writeYaml(testDir, "target/compiled/schema.yml", CUSTOMERS_YAML);

      const result = await format.parseAsync!(testDir);

      // Should find only 1 entity type (from models/), not duplicates.
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(1);
    });
  });

  describe("model generation", () => {
    it("creates entity types with constraints from YAML", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);
      writeYaml(testDir, "models/orders.yml", ORDERS_YAML);

      const result = await format.parseAsync!(testDir);

      // Entity types.
      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers).toBeDefined();
      expect(customers!.referenceMode).toBe("customer_id");

      const orders = result.model.getObjectTypeByName("Orders");
      expect(orders).toBeDefined();
      expect(orders!.referenceMode).toBe("order_id");

      // Relationship fact type.
      const relFt = result.model.getFactTypeByName("Orders has Customers");
      expect(relFt).toBeDefined();

      // Value constraint from accepted_values.
      const typeFt = result.model.getFactTypeByName("Customers has CustomerType");
      expect(typeFt).toBeDefined();
      const vc = typeFt!.constraints.find((c) => c.type === "value_constraint");
      expect(vc).toBeDefined();
    });

    it("uses provided model name", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);

      const result = await format.parseAsync!(testDir, {
        modelName: "E-Commerce Domain",
      });

      expect(result.model.name).toBe("E-Commerce Domain");
    });

    it("defaults model name to 'dbt Import'", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);

      const result = await format.parseAsync!(testDir);

      expect(result.model.name).toBe("dbt Import");
    });
  });

  describe("warnings and confidence", () => {
    it("returns warnings from the dbt import report", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);

      const result = await format.parseAsync!(testDir);

      // Should have some warnings (e.g., inferred descriptions, missing data types).
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it("returns medium confidence", async () => {
      writeYaml(testDir, "models/customers.yml", CUSTOMERS_YAML);

      const result = await format.parseAsync!(testDir);

      expect(result.confidence).toBe("medium");
    });

    it("returns low confidence with warning when no YAML files found", async () => {
      // Empty directory.
      const result = await format.parseAsync!(testDir);

      expect(result.confidence).toBe("low");
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain("No .yml/.yaml files found");
    });

    it("returns low confidence when YAML files have no dbt schema content", async () => {
      writeYaml(testDir, "models/config.yml", "# Just a comment\nkey: value\n");

      const result = await format.parseAsync!(testDir);

      expect(result.confidence).toBe("low");
      expect(result.warnings.some((w) => w.includes("none contain dbt schema"))).toBe(
        true,
      );
    });
  });

  describe("multiple files", () => {
    it("aggregates models and sources from multiple YAML files", async () => {
      writeYaml(testDir, "models/marts/customers.yml", CUSTOMERS_YAML);
      writeYaml(testDir, "models/marts/orders.yml", ORDERS_YAML);
      writeYaml(testDir, "models/staging/_sources.yml", SOURCES_YAML);

      const result = await format.parseAsync!(testDir);

      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities).toHaveLength(2);

      const factTypes = result.model.factTypes;
      expect(factTypes.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("handles nonexistent directory gracefully", async () => {
      const result = await format.parseAsync!(
        join(testDir, "nonexistent"),
      );

      expect(result.confidence).toBe("low");
      expect(result.warnings.length).toBeGreaterThan(0);
    });
  });
});
