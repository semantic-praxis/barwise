/**
 * Tests for describe_domain MCP tool.
 *
 * Verifies that the tool returns structured domain descriptions.
 */

import { describe, expect, it } from "vitest";
import { executeDescribeDomain } from "../../src/tools/describeDomain.js";

describe("describe_domain tool", () => {
  const simpleModel = `
orm_version: "1.0"
model:
  name: Test Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
      definition: A person who buys products
    - id: ot-order
      name: Order
      kind: entity
      reference_mode: order_num
  fact_types:
    - id: ft-customer-places-order
      name: Customer places Order
      roles:
        - id: r-cust-places
          player: ot-customer
          role_name: places
        - id: r-order-placed-by
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
      constraints:
        - type: internal_uniqueness
          roles: [r-order-placed-by]
        - type: mandatory
          role: r-order-placed-by
`;

  describe("full summary (no focus)", () => {
    it("returns structured domain description", () => {
      const result = executeDescribeDomain(simpleModel);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.summary).toBeDefined();
      expect(parsed.summary).toContain("Test Model");

      expect(parsed.entities).toHaveLength(2);
      expect(parsed.factTypes).toHaveLength(1);
      expect(parsed.constraints.length).toBeGreaterThanOrEqual(2);
    });

    it("includes entity definitions", () => {
      const result = executeDescribeDomain(simpleModel);

      const parsed = JSON.parse(result.content[0]!.text);

      const customer = parsed.entities.find(
        (e: { name: string; }) => e.name === "Customer",
      );
      expect(customer).toBeDefined();
      expect(customer.definition).toBe("A person who buys products");
    });

    it("includes fact type readings", () => {
      const result = executeDescribeDomain(simpleModel);

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.factTypes[0]!.primaryReading).toContain("places");
    });

    it("includes constraint verbalizations", () => {
      const result = executeDescribeDomain(simpleModel);

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.constraints.length).toBeGreaterThanOrEqual(1);
      expect(parsed.constraints[0]!.verbalization).toBeDefined();
    });
  });

  describe("entity focus", () => {
    it("returns only the focused entity and related elements", () => {
      const result = executeDescribeDomain(simpleModel, "Customer");

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(1);
      expect(parsed.entities[0]!.name).toBe("Customer");

      // Should include fact types involving Customer.
      expect(parsed.factTypes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("constraint type focus", () => {
    it("returns all constraints of the specified type", () => {
      const result = executeDescribeDomain(simpleModel, "mandatory");

      const parsed = JSON.parse(result.content[0]!.text);

      // Should have at least one mandatory constraint.
      expect(parsed.constraints.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("includePopulations option", () => {
    const modelWithPopulation = `
orm_version: "1.0"
model:
  name: Test Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
    - id: ot-order
      name: Order
      kind: entity
      reference_mode: order_num
  fact_types:
    - id: ft-customer-places-order
      name: Customer places Order
      roles:
        - id: r-cust-places
          player: ot-customer
          role_name: places
        - id: r-order-placed-by
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
      constraints:
        - type: internal_uniqueness
          roles: [r-order-placed-by]
  populations:
    - id: pop-1
      fact_type: ft-customer-places-order
      description: Sample orders
      instances:
        - id: inst-1
          role_values:
            r-cust-places: C001
            r-order-placed-by: O123
        - id: inst-2
          role_values:
            r-cust-places: C001
            r-order-placed-by: O124
`;

    it("includes populations by default", () => {
      const result = executeDescribeDomain(modelWithPopulation);

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.populations).toBeDefined();
      expect(parsed.populations.length).toBeGreaterThanOrEqual(1);
    });

    it("excludes populations when includePopulations is false", () => {
      const result = executeDescribeDomain(
        modelWithPopulation,
        undefined,
        false,
      );

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.populations).toBeUndefined();
    });
  });

  describe("minimal model", () => {
    it("handles minimal valid model", () => {
      // Minimal valid model with no fact types
      const minimalModel = `
orm_version: "1.0"
model:
  name: Minimal Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
`;

      const result = executeDescribeDomain(minimalModel);

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.summary).toBeDefined();
      expect(parsed.entities).toHaveLength(1);
      expect(parsed.factTypes).toHaveLength(0);
    });
  });

  describe("truncation of large models", () => {
    function modelWithEntities(n: number): string {
      const types = Array.from(
        { length: n },
        (_, i) =>
          `    - id: ot-${i}\n      name: Entity${i}\n`
          + `      kind: entity\n      reference_mode: id${i}`,
      ).join("\n");
      return `orm_version: "1.0"\nmodel:\n  name: Big Model\n`
        + `  object_types:\n${types}\n`;
    }

    it("does not truncate a model within the cap", () => {
      const result = executeDescribeDomain(modelWithEntities(10));
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(10);
      expect(parsed.truncation).toBeUndefined();
    });

    it("caps the entity array and reports truncation", () => {
      const result = executeDescribeDomain(modelWithEntities(40));
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(25);
      expect(parsed.truncation.entities).toEqual({ shown: 25, total: 40 });
      expect(parsed.note).toContain("query_model");
    });
  });
});
