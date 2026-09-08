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
import { createObjectType, isEntityType, isValueType } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

describe("ObjectType", () => {
  // The record does not extend ModelElement, so nothing else enforces the
  // naming rule on its behalf any more. Before WS1 these cases were covered
  // transitively by ModelElement's own tests and by nothing here: with the
  // `requireName` call deleted from `createObjectType`, the whole core
  // suite still passed. It does not now.
  describe("names", () => {
    it.each([
      ["empty", ""],
      ["whitespace only", "   "],
    ])("refuses a %s name", (_label, name) => {
      expect(() => createObjectType({ name, kind: "value" }))
        .toThrow("Model element name must be a non-empty string.");
    });

    it("stores the name trimmed", () => {
      const ot = createObjectType({ name: "  Customer  ", kind: "entity", referenceMode: "id" });
      expect(ot.name).toBe("Customer");
    });
  });

  describe("entity types", () => {
    it("creates an entity type with a reference mode", () => {
      const ot = createObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      expect(ot.name).toBe("Customer");
      expect(ot.kind).toBe("entity");
      expect(ot.referenceMode).toBe("customer_id");
      expect(isEntityType(ot)).toBe(true);
      expect(isValueType(ot)).toBe(false);
    });

    it("throws if entity type has no reference mode", () => {
      expect(
        () => createObjectType({ name: "Customer", kind: "entity" }),
      ).toThrow("reference mode");
    });

    it("accepts a definition", () => {
      const ot = createObjectType({
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
      const ot = createObjectType({
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
      const ot = createObjectType({ name: "Name", kind: "value" });
      expect(ot.kind).toBe("value");
      expect(ot.referenceMode).toBeUndefined();
      expect(isValueType(ot)).toBe(true);
      expect(isEntityType(ot)).toBe(false);
    });

    it("throws if value type has a reference mode", () => {
      expect(
        () =>
          createObjectType({
            name: "Name",
            kind: "value",
            referenceMode: "name_id",
          }),
      ).toThrow("should not have a reference mode");
    });

    it("accepts a value constraint", () => {
      const ot = createObjectType({
        name: "Rating",
        kind: "value",
        valueConstraint: { values: ["A", "B", "C", "D", "F"] },
      });
      expect(ot.valueConstraint).toBeDefined();
      expect(ot.valueConstraint!.values).toEqual(["A", "B", "C", "D", "F"]);
    });

    it("accepts a data type definition", () => {
      const ot = createObjectType({
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
      const ot = createObjectType({
        name: "Price",
        kind: "value",
        dataType: { name: "decimal", length: 10, scale: 2 },
      });
      expect(ot.dataType!.name).toBe("decimal");
      expect(ot.dataType!.length).toBe(10);
      expect(ot.dataType!.scale).toBe(2);
    });

    it("allows value type without data type", () => {
      const ot = createObjectType({ name: "Name", kind: "value" });
      expect(ot.dataType).toBeUndefined();
    });

    it("throws on empty value constraint", () => {
      expect(
        () =>
          createObjectType({
            name: "Rating",
            kind: "value",
            valueConstraint: { values: [] },
          }),
      ).toThrow("at least one value");
    });
  });

  describe("aliases", () => {
    it("creates an entity type with aliases", () => {
      const ot = createObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        aliases: ["Client", "Account"],
      });
      expect(ot.aliases).toEqual(["Client", "Account"]);
    });

    // The default is `[]`, not `undefined`. The old class stored
    // `undefined` for "none" and every reader carried a `?.` for it; the
    // record applies the default once so `aliases` is always a list.
    // What the two tests below used to pin -- that an absent or empty
    // alias list does not reach the file -- is asserted where it is true,
    // on the serialized bytes.
    it("defaults aliases to the empty list, and serializes nothing", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ name: "Customer", kind: "entity", referenceMode: "customer_id" });
      const ot = model.getObjectTypeByName("Customer")!;

      expect(ot.aliases).toEqual([]);
      expect(new OrmYamlSerializer().serialize(model)).not.toContain("aliases");
    });

    it("treats an empty array the same way", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        aliases: [],
      });
      const ot = model.getObjectTypeByName("Customer")!;

      expect(ot.aliases).toEqual([]);
      expect(new OrmYamlSerializer().serialize(model)).not.toContain("aliases");
    });

    it("returns a frozen copy of aliases", () => {
      const ot = createObjectType({
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
      const ot = createObjectType({
        name: "Rating",
        kind: "value",
        aliases: ["Grade", "Score"],
      });
      expect(ot.aliases).toEqual(["Grade", "Score"]);
    });
  });

  describe("immutability", () => {
    // These replace two tests that set `ot.definition` and
    // `ot.sourceContext` through setters. The setters are gone with the
    // class: an object type is a value, and changing one means deriving a
    // new one. That is not a capability lost -- these assert the same
    // updates still work -- but it is a different contract, so it is
    // stated rather than assumed.
    it("refuses a write to a built object type", () => {
      const ot = createObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });

      expect(() => {
        (ot as { definition?: string; }).definition = "Updated definition.";
      }).toThrow();
    });

    it("updates by deriving a new value, leaving the original alone", () => {
      const ot = createObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });

      const updated = { ...ot, definition: "Updated definition.", sourceContext: "billing" };

      expect(updated.definition).toBe("Updated definition.");
      expect(updated.sourceContext).toBe("billing");
      expect(ot.definition).toBeUndefined();
      expect(ot.sourceContext).toBeUndefined();
    });
  });

  describe("cardinality", () => {
    it("stores a population cardinality bound", () => {
      const ot = createObjectType({
        name: "Department",
        kind: "entity",
        referenceMode: "dept_id",
        cardinality: { min: 0, max: 50 },
      });
      expect(ot.cardinality).toEqual({ min: 0, max: 50 });
    });

    it("rejects a negative minimum", () => {
      expect(() =>
        createObjectType({
          name: "Department",
          kind: "entity",
          referenceMode: "dept_id",
          cardinality: { min: -1, max: 50 },
        })
      ).toThrow();
    });

    it("rejects a maximum below the minimum", () => {
      expect(() =>
        createObjectType({
          name: "Department",
          kind: "entity",
          referenceMode: "dept_id",
          cardinality: { min: 10, max: 5 },
        })
      ).toThrow();
    });
  });
});
