/**
 * Tests for the JSON Schema validator used during YAML deserialization.
 *
 * SchemaValidator uses AJV to validate parsed YAML documents against
 * the .orm.yaml JSON Schema. These tests ensure the schema correctly:
 *   - Accepts minimal, fully-populated, and constraint-bearing documents
 *   - Rejects documents missing required fields (orm_version, model, name)
 *   - Rejects structurally invalid documents (empty roles, wrong version)
 *   - Rejects unexpected top-level properties (additionalProperties: false)
 *   - Handles non-object and null inputs gracefully
 */
import { describe, expect, it } from "vitest";
import { SchemaValidator } from "../../src/serialization/SchemaValidator.js";

describe("SchemaValidator", () => {
  const validator = new SchemaValidator();

  describe("valid documents", () => {
    it("accepts a minimal valid document", () => {
      const doc = {
        orm_version: "1.1",
        model: { name: "Test" },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts a document with all fields populated", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Order Management",
          domain_context: "ecommerce",
          object_types: [
            {
              id: "ot-001",
              name: "Customer",
              kind: "entity",
              reference_mode: "customer_id",
              definition: "A person who places orders.",
              source_context: "crm",
            },
            {
              id: "ot-002",
              name: "Rating",
              kind: "value",
              value_constraint: { values: ["A", "B", "C"] },
            },
          ],
          fact_types: [
            {
              id: "ft-001",
              name: "Customer places Order",
              roles: [
                { id: "r-001", player: "ot-001", role_name: "places" },
                { id: "r-002", player: "ot-002", role_name: "is placed by" },
              ],
              readings: ["{0} places {1}", "{1} is placed by {0}"],
              constraints: [
                { type: "internal_uniqueness", roles: ["r-002"] },
                { type: "mandatory", role: "r-002" },
              ],
            },
          ],
          definitions: [
            {
              term: "Backorder",
              definition: "An order that cannot be fulfilled from current inventory.",
              context: "fulfillment",
            },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("accepts external_uniqueness constraints", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Test",
          fact_types: [
            {
              id: "ft-001",
              name: "Test Fact",
              roles: [{ id: "r-001", player: "ot-001", role_name: "test" }],
              readings: ["{0} test"],
              constraints: [
                { type: "external_uniqueness", roles: ["r-001", "r-002"] },
              ],
            },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(true);
    });

    it("accepts value_constraint constraints with optional role", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Test",
          fact_types: [
            {
              id: "ft-001",
              name: "Test Fact",
              roles: [{ id: "r-001", player: "ot-001", role_name: "test" }],
              readings: ["{0} test"],
              constraints: [
                { type: "value_constraint", values: ["X", "Y"], role: "r-001" },
              ],
            },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(true);
    });

    it("accepts value_constraint without role", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Test",
          fact_types: [
            {
              id: "ft-001",
              name: "Test Fact",
              roles: [{ id: "r-001", player: "ot-001", role_name: "test" }],
              readings: ["{0} test"],
              constraints: [
                { type: "value_constraint", values: ["X", "Y"] },
              ],
            },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(true);
    });
  });

  describe("invalid documents", () => {
    it("rejects a document missing orm_version", () => {
      const doc = { model: { name: "Test" } };
      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("rejects a document missing model", () => {
      const doc = { orm_version: "1.1" };
      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects a document missing model name", () => {
      const doc = { orm_version: "1.1", model: {} };
      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects an entity type without reference_mode", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Test",
          object_types: [
            { id: "ot-001", name: "Customer", kind: "entity" },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects a wrong orm_version", () => {
      const doc = { orm_version: "2.0", model: { name: "Test" } };
      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects additional properties at the top level", () => {
      const doc = {
        orm_version: "1.1",
        model: { name: "Test" },
        extra: "not allowed",
      };
      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects a fact type with no roles", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Test",
          fact_types: [
            { id: "ft-001", name: "Bad Fact", roles: [], readings: ["{0}"] },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects a fact type with no readings", () => {
      const doc = {
        orm_version: "1.1",
        model: {
          name: "Test",
          fact_types: [
            {
              id: "ft-001",
              name: "Bad Fact",
              roles: [{ id: "r-001", player: "ot-001", role_name: "test" }],
              readings: [],
            },
          ],
        },
      };

      const result = validator.validateModel(doc);
      expect(result.valid).toBe(false);
    });

    it("rejects non-object input", () => {
      const result = validator.validateModel("not an object");
      expect(result.valid).toBe(false);
    });

    it("rejects null input", () => {
      const result = validator.validateModel(null);
      expect(result.valid).toBe(false);
    });
  });
});
