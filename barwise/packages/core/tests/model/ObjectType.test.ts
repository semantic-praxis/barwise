/**
 * Tests for the ObjectType model class.
 *
 * ObjectType represents either an entity type (identified by a reference
 * mode) or a value type (self-identifying). These tests verify:
 *   - Construction of both entity and value types
 *   - Setter behavior for mutable properties (name, definition, etc.)
 *   - Validation of required fields (entity types must have a referenceMode)
 *   - Value constraints on value types
 *   - Source-context tracking for multi-domain models
 */
import { describe, expect, it } from "vitest";
import { ObjectType } from "../../src/model/ObjectType.js";

describe("ObjectType", () => {
  describe("entity types", () => {
    it("creates an entity type with a reference mode", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      expect(ot.name).toBe("Customer");
      expect(ot.kind).toBe("entity");
      expect(ot.referenceMode).toBe("customer_id");
      expect(ot.isEntity).toBe(true);
      expect(ot.isValue).toBe(false);
    });

    it("throws if entity type has no reference mode", () => {
      expect(
        () => new ObjectType({ name: "Customer", kind: "entity" }),
      ).toThrow("reference mode");
    });

    it("accepts a definition", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        definition: "A person or org that has placed at least one order.",
      });
      expect(ot.definition).toBe(
        "A person or org that has placed at least one order.",
      );
    });

    it("accepts a source context", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        sourceContext: "crm",
      });
      expect(ot.sourceContext).toBe("crm");
    });
  });

  describe("value types", () => {
    it("creates a value type without a reference mode", () => {
      const ot = new ObjectType({ name: "Name", kind: "value" });
      expect(ot.kind).toBe("value");
      expect(ot.referenceMode).toBeUndefined();
      expect(ot.isValue).toBe(true);
      expect(ot.isEntity).toBe(false);
    });

    it("throws if value type has a reference mode", () => {
      expect(
        () =>
          new ObjectType({
            name: "Name",
            kind: "value",
            referenceMode: "name_id",
          }),
      ).toThrow("should not have a reference mode");
    });

    it("accepts a value constraint", () => {
      const ot = new ObjectType({
        name: "Rating",
        kind: "value",
        valueConstraint: { values: ["A", "B", "C", "D", "F"] },
      });
      expect(ot.valueConstraint).toBeDefined();
      expect(ot.valueConstraint!.values).toEqual(["A", "B", "C", "D", "F"]);
    });

    it("accepts a data type definition", () => {
      const ot = new ObjectType({
        name: "FirstName",
        kind: "value",
        dataType: { name: "text", length: 50 },
      });
      expect(ot.dataType).toBeDefined();
      expect(ot.dataType!.name).toBe("text");
      expect(ot.dataType!.length).toBe(50);
      expect(ot.dataType!.scale).toBeUndefined();
    });

    it("accepts a data type with scale", () => {
      const ot = new ObjectType({
        name: "Price",
        kind: "value",
        dataType: { name: "decimal", length: 10, scale: 2 },
      });
      expect(ot.dataType!.name).toBe("decimal");
      expect(ot.dataType!.length).toBe(10);
      expect(ot.dataType!.scale).toBe(2);
    });

    it("allows value type without data type", () => {
      const ot = new ObjectType({ name: "Name", kind: "value" });
      expect(ot.dataType).toBeUndefined();
    });

    it("throws on empty value constraint", () => {
      expect(
        () =>
          new ObjectType({
            name: "Rating",
            kind: "value",
            valueConstraint: { values: [] },
          }),
      ).toThrow("at least one value");
    });
  });

  describe("aliases", () => {
    it("creates an entity type with aliases", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        aliases: ["Client", "Account"],
      });
      expect(ot.aliases).toEqual(["Client", "Account"]);
    });

    it("defaults aliases to undefined when not provided", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      expect(ot.aliases).toBeUndefined();
    });

    it("treats empty array as undefined", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        aliases: [],
      });
      expect(ot.aliases).toBeUndefined();
    });

    it("returns a frozen copy of aliases", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        aliases: ["Client"],
      });
      expect(() => {
        (ot.aliases as string[]).push("Account");
      }).toThrow();
    });

    it("accepts aliases on value types", () => {
      const ot = new ObjectType({
        name: "Rating",
        kind: "value",
        aliases: ["Grade", "Score"],
      });
      expect(ot.aliases).toEqual(["Grade", "Score"]);
    });
  });

  describe("mutability", () => {
    it("allows updating the definition", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      expect(ot.definition).toBeUndefined();
      ot.definition = "Updated definition.";
      expect(ot.definition).toBe("Updated definition.");
    });

    it("allows updating the source context", () => {
      const ot = new ObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      ot.sourceContext = "billing";
      expect(ot.sourceContext).toBe("billing");
    });
  });

  describe("cardinality", () => {
    it("stores a population cardinality bound", () => {
      const ot = new ObjectType({
        name: "Department",
        kind: "entity",
        referenceMode: "dept_id",
        cardinality: { min: 0, max: 50 },
      });
      expect(ot.cardinality).toEqual({ min: 0, max: 50 });
    });

    it("rejects a negative minimum", () => {
      expect(() =>
        new ObjectType({
          name: "Department",
          kind: "entity",
          referenceMode: "dept_id",
          cardinality: { min: -1, max: 50 },
        })
      ).toThrow();
    });

    it("rejects a maximum below the minimum", () => {
      expect(() =>
        new ObjectType({
          name: "Department",
          kind: "entity",
          referenceMode: "dept_id",
          cardinality: { min: 10, max: 5 },
        })
      ).toThrow();
    });
  });
});
