/**
 * Tests for the dbt schema YAML parser.
 *
 * Verifies parsing of models, sources, columns, and tests from
 * dbt schema YAML into the intermediate DbtProjectDocument.
 */
import { describe, expect, it } from "vitest";
import { DbtParseError, parseDbtSchema } from "../src/DbtSchemaParser.js";

describe("DbtSchemaParser", () => {
  describe("model parsing", () => {
    it("parses a model with columns and description", () => {
      const yaml = `
models:
  - name: customers
    description: Customer overview data mart.
    columns:
      - name: customer_id
        description: Unique customer identifier.
        tests:
          - unique
          - not_null
      - name: customer_name
        description: Full name.
`;
      const doc = parseDbtSchema([yaml]);

      expect(doc.models).toHaveLength(1);
      expect(doc.models[0]!.name).toBe("customers");
      expect(doc.models[0]!.description).toBe("Customer overview data mart.");
      expect(doc.models[0]!.columns).toHaveLength(2);
    });

    it("parses multiple models from one file", () => {
      const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        tests:
          - unique
          - not_null
  - name: orders
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
`;
      const doc = parseDbtSchema([yaml]);
      expect(doc.models).toHaveLength(2);
    });

    it("aggregates models across multiple YAML files", () => {
      const yaml1 = `
models:
  - name: customers
    columns:
      - name: customer_id
        tests:
          - unique
          - not_null
`;
      const yaml2 = `
models:
  - name: orders
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
`;
      const doc = parseDbtSchema([yaml1, yaml2]);
      expect(doc.models).toHaveLength(2);
    });
  });

  describe("test parsing", () => {
    it("parses string tests (unique, not_null)", () => {
      const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        tests:
          - unique
          - not_null
`;
      const doc = parseDbtSchema([yaml]);
      const col = doc.models[0]!.columns[0]!;
      expect(col.tests).toHaveLength(2);
      expect(col.tests[0]!.type).toBe("unique");
      expect(col.tests[1]!.type).toBe("not_null");
    });

    it("parses accepted_values test", () => {
      const yaml = `
models:
  - name: orders
    columns:
      - name: status
        tests:
          - accepted_values:
              values: ['placed', 'shipped', 'completed']
`;
      const doc = parseDbtSchema([yaml]);
      const col = doc.models[0]!.columns[0]!;
      const avTest = col.tests.find((t) => t.type === "accepted_values");
      expect(avTest).toBeDefined();
      expect(avTest!.type === "accepted_values" && avTest!.values).toEqual([
        "placed",
        "shipped",
        "completed",
      ]);
    });

    it("parses relationships test", () => {
      const yaml = `
models:
  - name: orders
    columns:
      - name: customer_id
        tests:
          - not_null
          - relationships:
              to: ref('customers')
              field: customer_id
`;
      const doc = parseDbtSchema([yaml]);
      const col = doc.models[0]!.columns[0]!;
      const relTest = col.tests.find((t) => t.type === "relationships");
      expect(relTest).toBeDefined();
      expect(
        relTest!.type === "relationships" && relTest!.to,
      ).toBe("customers");
      expect(
        relTest!.type === "relationships" && relTest!.field,
      ).toBe("customer_id");
    });

    it("parses custom/macro tests", () => {
      const yaml = `
models:
  - name: orders
    data_tests:
      - dbt_utils.expression_is_true:
          expression: "order_total > 0"
    columns:
      - name: order_id
        tests:
          - unique
          - not_null
`;
      const doc = parseDbtSchema([yaml]);
      const customTests = doc.models[0]!.modelTests.filter(
        (t) => t.type === "custom",
      );
      expect(customTests).toHaveLength(1);
      expect(
        customTests[0]!.type === "custom" && customTests[0]!.name,
      ).toBe("dbt_utils.expression_is_true");
    });

    it("supports data_tests key (dbt >= 1.8)", () => {
      const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        data_tests:
          - unique
          - not_null
`;
      const doc = parseDbtSchema([yaml]);
      const col = doc.models[0]!.columns[0]!;
      expect(col.tests).toHaveLength(2);
    });
  });

  describe("source parsing", () => {
    it("parses sources with tables and columns", () => {
      const yaml = `
sources:
  - name: ecom
    description: E-commerce source data.
    tables:
      - name: raw_customers
        columns:
          - name: id
            data_type: integer
          - name: name
            data_type: varchar(100)
`;
      const doc = parseDbtSchema([yaml]);

      expect(doc.sources).toHaveLength(1);
      expect(doc.sources[0]!.name).toBe("ecom");
      expect(doc.sources[0]!.tables).toHaveLength(1);
      expect(doc.sources[0]!.tables[0]!.columns).toHaveLength(2);
      expect(doc.sources[0]!.tables[0]!.columns[0]!.dataType).toBe("integer");
    });
  });

  describe("column data_type", () => {
    it("extracts data_type from columns", () => {
      const yaml = `
models:
  - name: products
    columns:
      - name: product_id
        data_type: integer
        tests:
          - unique
          - not_null
      - name: price
        data_type: "decimal(10,2)"
`;
      const doc = parseDbtSchema([yaml]);
      expect(doc.models[0]!.columns[0]!.dataType).toBe("integer");
      expect(doc.models[0]!.columns[1]!.dataType).toBe("decimal(10,2)");
    });
  });

  describe("edge cases", () => {
    it("handles empty YAML gracefully", () => {
      const doc = parseDbtSchema([""]);
      expect(doc.models).toHaveLength(0);
      expect(doc.sources).toHaveLength(0);
    });

    it("handles YAML with no models or sources", () => {
      const yaml = `
version: 2
`;
      const doc = parseDbtSchema([yaml]);
      expect(doc.models).toHaveLength(0);
      expect(doc.sources).toHaveLength(0);
    });

    it("handles models with no columns", () => {
      const yaml = `
models:
  - name: empty_model
`;
      const doc = parseDbtSchema([yaml]);
      expect(doc.models[0]!.columns).toHaveLength(0);
    });

    it("throws DbtParseError for invalid YAML", () => {
      expect(() => parseDbtSchema(["{{invalid: yaml"])).toThrow(DbtParseError);
    });

    it("extracts ref model name with package prefix", () => {
      const yaml = `
models:
  - name: orders
    columns:
      - name: customer_id
        tests:
          - relationships:
              to: ref('jaffle_shop', 'customers')
              field: customer_id
`;
      const doc = parseDbtSchema([yaml]);
      const relTest = doc.models[0]!.columns[0]!.tests.find(
        (t) => t.type === "relationships",
      );
      expect(
        relTest!.type === "relationships" && relTest!.to,
      ).toBe("customers");
    });
  });
});
