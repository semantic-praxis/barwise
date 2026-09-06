/**
 * Tests for ContextMapping, which records how object types in one bounded
 * context relate to object types in another (e.g. CRM "Customer" maps to
 * Billing "Account"). These tests verify construction, entity-mapping
 * storage, semantic-conflict documentation, and context-involvement queries.
 */
import { describe, expect, it } from "vitest";
import { ContextMapping } from "../../src/model/ContextMapping.js";

describe("ContextMapping", () => {
  it("creates a mapping with required fields", () => {
    const mapping = new ContextMapping({
      path: "./crm-billing.map.yaml",
      sourceContext: "crm",
      targetContext: "billing",
      pattern: "shared_kernel",
    });

    expect(mapping.sourceContext).toBe("crm");
    expect(mapping.targetContext).toBe("billing");
    expect(mapping.pattern).toBe("shared_kernel");
    expect(mapping.entityMappings).toHaveLength(0);
    expect(mapping.semanticConflicts).toHaveLength(0);
  });

  it("rejects empty source context", () => {
    expect(
      () =>
        new ContextMapping({
          path: "./test.map.yaml",
          sourceContext: "",
          targetContext: "billing",
          pattern: "shared_kernel",
        }),
    ).toThrow();
  });

  it("rejects same source and target context", () => {
    expect(
      () =>
        new ContextMapping({
          path: "./test.map.yaml",
          sourceContext: "crm",
          targetContext: "crm",
          pattern: "shared_kernel",
        }),
    ).toThrow(/different/);
  });

  it("creates a mapping with entity mappings", () => {
    const mapping = new ContextMapping({
      path: "./crm-billing.map.yaml",
      sourceContext: "crm",
      targetContext: "billing",
      pattern: "anticorruption_layer",
      entityMappings: [
        {
          sourceObjectType: "Customer",
          targetObjectType: "Account",
          description: "CRM customer maps to billing account.",
        },
      ],
    });

    expect(mapping.entityMappings).toHaveLength(1);
    expect(mapping.entityMappings[0]!.sourceObjectType).toBe("Customer");
    expect(mapping.entityMappings[0]!.targetObjectType).toBe("Account");
  });

  it("creates a mapping with semantic conflicts", () => {
    const mapping = new ContextMapping({
      path: "./crm-billing.map.yaml",
      sourceContext: "crm",
      targetContext: "billing",
      pattern: "anticorruption_layer",
      semanticConflicts: [
        {
          term: "Customer",
          sourceMeaning: "A person who has contacted sales.",
          targetMeaning: "An entity with an active billing agreement.",
          resolution: "Use CRM definition as canonical; billing 'Customer' maps to 'Account'.",
        },
      ],
    });

    expect(mapping.semanticConflicts).toHaveLength(1);
    expect(mapping.semanticConflicts[0]!.term).toBe("Customer");
  });

  it("adds entity mappings after construction", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "a",
      targetContext: "b",
      pattern: "published_language",
    });

    mapping.addEntityMapping({
      sourceObjectType: "Foo",
      targetObjectType: "Bar",
    });

    expect(mapping.entityMappings).toHaveLength(1);
  });

  it("adds semantic conflicts after construction", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "a",
      targetContext: "b",
      pattern: "published_language",
    });

    mapping.addSemanticConflict({
      term: "Widget",
      sourceMeaning: "A UI element",
      targetMeaning: "A physical product",
      resolution: "Use 'UIWidget' and 'PhysicalWidget'.",
    });

    expect(mapping.semanticConflicts).toHaveLength(1);
  });

  it("rejects an empty source object type in an entity mapping", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "a",
      targetContext: "b",
      pattern: "published_language",
    });

    expect(() => mapping.addEntityMapping({ sourceObjectType: "", targetObjectType: "Bar" }))
      .toThrow("Source object type must be a non-empty string.");
  });

  it("rejects a whitespace-only target object type in an entity mapping", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "a",
      targetContext: "b",
      pattern: "published_language",
    });

    expect(() => mapping.addEntityMapping({ sourceObjectType: "Foo", targetObjectType: "   " }))
      .toThrow("Target object type must be a non-empty string.");
  });

  it("rejects an empty term in a semantic conflict", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "a",
      targetContext: "b",
      pattern: "published_language",
    });

    expect(() =>
      mapping.addSemanticConflict({
        term: "",
        sourceMeaning: "A",
        targetMeaning: "B",
        resolution: "Pick one.",
      })
    ).toThrow("Semantic conflict term must be a non-empty string.");
  });

  it("rejects a whitespace-only resolution in a semantic conflict", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "a",
      targetContext: "b",
      pattern: "published_language",
    });

    expect(() =>
      mapping.addSemanticConflict({
        term: "Widget",
        sourceMeaning: "A",
        targetMeaning: "B",
        resolution: "   ",
      })
    ).toThrow("Semantic conflict resolution must be a non-empty string.");
  });

  it("checks context involvement", () => {
    const mapping = new ContextMapping({
      path: "./test.map.yaml",
      sourceContext: "crm",
      targetContext: "billing",
      pattern: "shared_kernel",
    });

    expect(mapping.involvesContext("crm")).toBe(true);
    expect(mapping.involvesContext("billing")).toBe(true);
    expect(mapping.involvesContext("shipping")).toBe(false);
  });
});
