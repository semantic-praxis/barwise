/**
 * Tests for the dbt project importer.
 *
 * Uses jaffle-shop-style YAML fixtures to verify end-to-end import:
 * entity type detection, value type creation, fact type inference,
 * constraint mapping, description inference, and gap reporting.
 */
import { describe, expect, it } from "vitest";
import { DbtImportError, importDbtProject } from "../src/DbtProjectImporter.js";

// ---------------------------------------------------------------------------
// Fixtures: jaffle-shop-style YAML
// ---------------------------------------------------------------------------

const CUSTOMERS_YAML = `
models:
  - name: customers
    description: Customer overview data mart. One row per customer.
    columns:
      - name: customer_id
        description: The unique key for each customer.
        data_tests:
          - not_null
          - unique
      - name: customer_name
        description: Full name of the customer.
      - name: first_ordered_at
        description: Timestamp of the first order.
        data_type: timestamp
      - name: lifetime_spend
        description: Total lifetime spend in USD.
        data_type: "decimal(10,2)"
      - name: customer_type
        description: New or returning customer.
        data_tests:
          - accepted_values:
              values: ["new", "returning"]
`;

const ORDERS_YAML = `
models:
  - name: orders
    description: Order fact table. One row per order.
    data_tests:
      - dbt_utils.expression_is_true:
          expression: "order_total = subtotal + tax_paid"
    columns:
      - name: order_id
        description: The unique key for each order.
        data_tests:
          - not_null
          - unique
      - name: customer_id
        description: Foreign key to the customers table.
        data_tests:
          - not_null
          - relationships:
              to: ref('customers')
              field: customer_id
      - name: order_total
        description: Total order amount including tax.
        data_type: "decimal(10,2)"
        data_tests:
          - not_null
      - name: ordered_at
        description: Timestamp when the order was placed.
        data_type: timestamp
      - name: status
        description: Current order status.
        data_tests:
          - accepted_values:
              values: ['placed', 'shipped', 'completed', 'returned']
      - name: is_food_order
        description: Whether this order included food items.
        data_type: boolean
`;

const SOURCES_YAML = `
sources:
  - name: ecom
    description: E-commerce source database.
    tables:
      - name: raw_customers
        columns:
          - name: id
            data_type: integer
          - name: name
            data_type: varchar(100)
      - name: raw_orders
        columns:
          - name: id
            data_type: integer
          - name: customer_id
            data_type: integer
          - name: order_date
            data_type: date
`;

const NO_PK_YAML = `
models:
  - name: metrics_daily
    columns:
      - name: metric_date
        data_type: date
      - name: total_revenue
        data_type: "decimal(10,2)"
`;

const NO_DESCRIPTIONS_YAML = `
models:
  - name: products
    columns:
      - name: product_id
        data_tests:
          - not_null
          - unique
      - name: product_name
      - name: price
        data_type: "decimal(8,2)"
      - name: is_active
        data_type: boolean
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DbtProjectImporter", () => {
  describe("entity type detection", () => {
    it("creates entity types from models with unique+not_null PK", () => {
      const result = importDbtProject([CUSTOMERS_YAML, ORDERS_YAML]);

      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers).toBeDefined();
      expect(customers!.kind).toBe("entity");
      expect(customers!.referenceMode).toBe("customer_id");

      const orders = result.model.getObjectTypeByName("Orders");
      expect(orders).toBeDefined();
      expect(orders!.kind).toBe("entity");
      expect(orders!.referenceMode).toBe("order_id");
    });

    it("skips models without identifiable PK", () => {
      const result = importDbtProject([NO_PK_YAML]);

      expect(result.model.objectTypes).toHaveLength(0);
      const gaps = result.report.entries.filter(
        (e) => e.severity === "gap" && e.category === "identifier",
      );
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.modelName).toBe("metrics_daily");
    });

    it("uses model description when provided", () => {
      const result = importDbtProject([CUSTOMERS_YAML]);
      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers!.definition).toBe(
        "Customer overview data mart. One row per customer.",
      );
    });
  });

  describe("value type creation", () => {
    it("creates value types for non-PK non-FK columns", () => {
      const result = importDbtProject([CUSTOMERS_YAML]);

      const customerName = result.model.getObjectTypeByName("CustomerName");
      expect(customerName).toBeDefined();
      expect(customerName!.kind).toBe("value");
    });

    it("resolves data types from column data_type", () => {
      const result = importDbtProject([CUSTOMERS_YAML]);

      const firstOrdered = result.model.getObjectTypeByName("FirstOrderedAt");
      expect(firstOrdered).toBeDefined();
      expect(firstOrdered!.dataType?.name).toBe("timestamp");

      const spend = result.model.getObjectTypeByName("LifetimeSpend");
      expect(spend).toBeDefined();
      expect(spend!.dataType?.name).toBe("decimal");
      expect(spend!.dataType?.length).toBe(10);
      expect(spend!.dataType?.scale).toBe(2);
    });

    it("reports gap for columns without data_type", () => {
      const result = importDbtProject([CUSTOMERS_YAML]);

      const gaps = result.report.entries.filter(
        (e) =>
          e.severity === "gap"
          && e.category === "data_type"
          && e.columnName === "customer_name",
      );
      expect(gaps).toHaveLength(1);
    });
  });

  describe("fact type creation", () => {
    it("creates binary fact types for value columns", () => {
      const result = importDbtProject([CUSTOMERS_YAML]);

      const ft = result.model.getFactTypeByName("Customers has CustomerName");
      expect(ft).toBeDefined();
      expect(ft!.roles).toHaveLength(2);
    });

    it("creates relationship fact types from FK columns", () => {
      const result = importDbtProject([CUSTOMERS_YAML, ORDERS_YAML]);

      const ft = result.model.getFactTypeByName("Orders has Customers");
      expect(ft).toBeDefined();
      expect(ft!.roles).toHaveLength(2);
    });
  });

  describe("constraint mapping", () => {
    it("maps not_null tests to mandatory constraints", () => {
      const result = importDbtProject([ORDERS_YAML, CUSTOMERS_YAML]);

      const ft = result.model.getFactTypeByName("Orders has OrderTotal");
      expect(ft).toBeDefined();
      const mandatory = ft!.constraints.filter(
        (c) => c.type === "mandatory",
      );
      expect(mandatory.length).toBeGreaterThan(0);
    });

    it("maps accepted_values tests to value constraints", () => {
      const result = importDbtProject([ORDERS_YAML, CUSTOMERS_YAML]);

      const ft = result.model.getFactTypeByName("Orders has Status");
      expect(ft).toBeDefined();
      const vc = ft!.constraints.find((c) => c.type === "value_constraint");
      expect(vc).toBeDefined();
      expect(
        vc!.type === "value_constraint" && vc!.values,
      ).toEqual(["placed", "shipped", "completed", "returned"]);
    });

    it("skips value_constraint when accepted_values list is empty and reports warning", () => {
      const yaml = `
models:
  - name: sites
    columns:
      - name: site_id
        data_tests:
          - not_null
          - unique
      - name: status
        data_tests:
          - accepted_values:
              values: []
`;
      const result = importDbtProject([yaml]);
      const ft = result.model.getFactTypeByName("Sites has Status");
      expect(ft).toBeDefined();
      const vc = ft!.constraints.find((c) => c.type === "value_constraint");
      expect(vc).toBeUndefined();

      // Should warn the user about the empty accepted_values list.
      const warnings = result.report.entries.filter(
        (e) =>
          e.severity === "warning"
          && e.category === "constraint"
          && e.columnName === "status",
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.message).toContain("empty values list");
    });

    it("maps unique tests to internal uniqueness on value role", () => {
      // A non-PK column with unique test means each value belongs to at most one entity.
      // We need a fixture with a unique non-PK column.
      const yaml = `
models:
  - name: employees
    columns:
      - name: employee_id
        data_tests:
          - not_null
          - unique
      - name: email
        data_tests:
          - unique
          - not_null
`;
      const result = importDbtProject([yaml]);
      const ft = result.model.getFactTypeByName("Employees has Email");
      expect(ft).toBeDefined();

      // Should have uniqueness on both roles:
      // role1 (entity has value) for functional dependency
      // role2 (value unique across entities) from unique test
      const ucs = ft!.constraints.filter(
        (c) => c.type === "internal_uniqueness",
      );
      expect(ucs).toHaveLength(2);
    });
  });

  describe("description inference", () => {
    it("infers descriptions when not provided", () => {
      const result = importDbtProject([NO_DESCRIPTIONS_YAML]);

      const products = result.model.getObjectTypeByName("Products");
      expect(products).toBeDefined();
      expect(products!.definition).toContain("inferred");

      const inferred = result.report.entries.filter(
        (e) => e.severity === "warning" && e.category === "description",
      );
      expect(inferred.length).toBeGreaterThan(0);
    });

    it("uses explicit descriptions when provided", () => {
      const result = importDbtProject([CUSTOMERS_YAML]);

      const explicit = result.report.entries.filter(
        (e) =>
          e.severity === "info"
          && e.category === "description"
          && e.modelName === "customers",
      );
      expect(explicit.length).toBeGreaterThan(0);
    });

    it("infers _id column descriptions", () => {
      const result = importDbtProject([NO_DESCRIPTIONS_YAML]);

      // "product_name" should get a generic inferred description.
      const vt = result.model.getObjectTypeByName("ProductName");
      expect(vt).toBeDefined();
      expect(vt!.definition).toBeDefined();
    });

    it("infers boolean column descriptions", () => {
      const result = importDbtProject([NO_DESCRIPTIONS_YAML]);

      const vt = result.model.getObjectTypeByName("IsActive");
      expect(vt).toBeDefined();
      expect(vt!.definition).toContain("Whether");
    });
  });

  describe("gap reporting", () => {
    it("reports custom macro tests as warnings", () => {
      const result = importDbtProject([ORDERS_YAML, CUSTOMERS_YAML]);

      const macroWarnings = result.report.entries.filter(
        (e) => e.category === "macro",
      );
      expect(macroWarnings.length).toBeGreaterThan(0);
      expect(macroWarnings[0]!.message).toContain("expression_is_true");
    });

    it("reports relationship mappings", () => {
      const result = importDbtProject([CUSTOMERS_YAML, ORDERS_YAML]);

      const relEntries = result.report.entries.filter(
        (e) => e.category === "relationship",
      );
      expect(relEntries.length).toBeGreaterThan(0);
    });

    it("reports missing PK as gap", () => {
      const result = importDbtProject([NO_PK_YAML]);

      const gaps = result.report.entries.filter(
        (e) => e.severity === "gap" && e.category === "identifier",
      );
      expect(gaps).toHaveLength(1);
      expect(gaps[0]!.message).toContain("Cannot determine primary identifier");
    });
  });

  describe("dbt naming conventions", () => {
    it("strips stg_ prefix from entity names", () => {
      const yaml = `
models:
  - name: stg_customers
    columns:
      - name: customer_id
        tests:
          - unique
          - not_null
      - name: name
`;
      const result = importDbtProject([yaml]);
      const customers = result.model.getObjectTypeByName("Customers");
      expect(customers).toBeDefined();
    });

    it("converts snake_case to PascalCase", () => {
      const yaml = `
models:
  - name: order_items
    columns:
      - name: order_item_id
        tests:
          - unique
          - not_null
      - name: unit_price
        data_type: "decimal(8,2)"
`;
      const result = importDbtProject([yaml]);
      const entity = result.model.getObjectTypeByName("OrderItems");
      expect(entity).toBeDefined();

      const vt = result.model.getObjectTypeByName("UnitPrice");
      expect(vt).toBeDefined();
    });
  });

  describe("source data types", () => {
    it("parses source definitions without error", () => {
      const result = importDbtProject([SOURCES_YAML]);
      // Sources alone don't create models, but they should parse.
      expect(result.model.objectTypes).toHaveLength(0);
    });

    it("resolves data_type from source when model column lacks it", () => {
      const modelYaml = `
models:
  - name: stg_products
    columns:
      - name: product_id
        data_tests:
          - unique
          - not_null
      - name: product_name
      - name: price
`;
      const sourceYaml = `
sources:
  - name: raw
    tables:
      - name: products
        columns:
          - name: product_id
            data_type: integer
          - name: product_name
            data_type: varchar(200)
          - name: price
            data_type: "decimal(10,2)"
`;
      const result = importDbtProject([modelYaml, sourceYaml]);

      const productName = result.model.getObjectTypeByName("ProductName");
      expect(productName).toBeDefined();
      expect(productName!.dataType?.name).toBe("text");
      expect(productName!.dataType?.length).toBe(200);

      const price = result.model.getObjectTypeByName("Price");
      expect(price).toBeDefined();
      expect(price!.dataType?.name).toBe("decimal");
      expect(price!.dataType?.length).toBe(10);
      expect(price!.dataType?.scale).toBe(2);
    });

    it("prefers model data_type over source data_type", () => {
      const modelYaml = `
models:
  - name: stg_products
    columns:
      - name: product_id
        data_tests:
          - unique
          - not_null
      - name: price
        data_type: "decimal(12,4)"
`;
      const sourceYaml = `
sources:
  - name: raw
    tables:
      - name: products
        columns:
          - name: price
            data_type: "decimal(10,2)"
`;
      const result = importDbtProject([modelYaml, sourceYaml]);

      const price = result.model.getObjectTypeByName("Price");
      expect(price).toBeDefined();
      // Model's decimal(12,4) should win over source's decimal(10,2).
      expect(price!.dataType?.length).toBe(12);
      expect(price!.dataType?.scale).toBe(4);
    });

    it("reports source-resolved types as info, not gap", () => {
      const modelYaml = `
models:
  - name: stg_products
    columns:
      - name: product_id
        data_tests:
          - unique
          - not_null
      - name: product_name
`;
      const sourceYaml = `
sources:
  - name: raw
    tables:
      - name: products
        columns:
          - name: product_name
            data_type: varchar(200)
`;
      const result = importDbtProject([modelYaml, sourceYaml]);

      // Should NOT have a gap for product_name.
      const gaps = result.report.entries.filter(
        (e) =>
          e.severity === "gap"
          && e.category === "data_type"
          && e.columnName === "product_name",
      );
      expect(gaps).toHaveLength(0);

      // Should have an info entry mentioning source resolution.
      const infos = result.report.entries.filter(
        (e) =>
          e.severity === "info"
          && e.category === "data_type"
          && e.columnName === "product_name",
      );
      expect(infos).toHaveLength(1);
      expect(infos[0]!.message).toContain("source");
    });

    it("reports gap when source types are ambiguous for same column name", () => {
      const modelYaml = `
models:
  - name: stg_products
    columns:
      - name: product_id
        data_tests:
          - unique
          - not_null
      - name: status
`;
      const sourceYaml = `
sources:
  - name: raw
    tables:
      - name: products
        columns:
          - name: status
            data_type: varchar(20)
      - name: orders
        columns:
          - name: status
            data_type: integer
`;
      const result = importDbtProject([modelYaml, sourceYaml]);

      // "status" appears in two source tables with different types.
      // Should still be a gap.
      const gaps = result.report.entries.filter(
        (e) =>
          e.severity === "gap"
          && e.category === "data_type"
          && e.columnName === "status",
      );
      expect(gaps).toHaveLength(1);
    });

    it("resolves source type when multiple sources agree", () => {
      const modelYaml = `
models:
  - name: stg_products
    columns:
      - name: product_id
        data_tests:
          - unique
          - not_null
      - name: status
`;
      const sourceYaml = `
sources:
  - name: raw
    tables:
      - name: products
        columns:
          - name: status
            data_type: varchar(20)
      - name: orders
        columns:
          - name: status
            data_type: varchar(20)
`;
      const result = importDbtProject([modelYaml, sourceYaml]);

      const status = result.model.getObjectTypeByName("Status");
      expect(status).toBeDefined();
      expect(status!.dataType?.name).toBe("text");
      expect(status!.dataType?.length).toBe(20);

      // No gap for status.
      const gaps = result.report.entries.filter(
        (e) =>
          e.severity === "gap"
          && e.category === "data_type"
          && e.columnName === "status",
      );
      expect(gaps).toHaveLength(0);
    });
  });

  describe("multiple files integration", () => {
    it("handles a full jaffle-shop-style import", () => {
      const result = importDbtProject([
        CUSTOMERS_YAML,
        ORDERS_YAML,
        SOURCES_YAML,
      ]);

      // Should have entity types.
      const entities = result.model.objectTypes.filter(
        (ot) => ot.kind === "entity",
      );
      expect(entities.length).toBe(2); // Customers, Orders

      // Should have value types.
      const values = result.model.objectTypes.filter(
        (ot) => ot.kind === "value",
      );
      expect(values.length).toBeGreaterThan(0);

      // Should have fact types.
      expect(result.model.factTypes.length).toBeGreaterThan(0);

      // Should have a gap report with entries.
      expect(result.report.entries.length).toBeGreaterThan(0);
    });
  });

  describe("error handling", () => {
    it("throws DbtImportError for invalid YAML", () => {
      expect(() => importDbtProject(["{{invalid"])).toThrow(DbtImportError);
    });

    it("handles empty input gracefully", () => {
      const result = importDbtProject([]);
      expect(result.model.objectTypes).toHaveLength(0);
      expect(result.model.factTypes).toHaveLength(0);
    });
  });
});
