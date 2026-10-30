/**
 * Tests for the model diff engine.
 *
 * diffModels compares two OrmModels and produces a list of deltas
 * (added, removed, modified, unchanged) for object types, fact types,
 * and definitions. This is used by the LLM re-extraction workflow to
 * show users what changed between the existing model and the new
 * extraction. These tests verify detection of:
 *   - Added, removed, and unchanged elements
 *   - Modified properties (kind, referenceMode, definition, sourceContext,
 *     valueConstraint, readings, role names, role players, constraints)
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";
import { loadNestedUnder } from "../helpers/nestedUnder.js";
import { placeFlags } from "../helpers/placeFlags.js";

function baseModel() {
  return new ModelBuilder("Test")
    .withEntityType("Customer", { referenceMode: "customer_id" })
    .withEntityType("Order", { referenceMode: "order_number" })
    .withValueType("Name")
    .withBinaryFactType("Customer places Order", {
      role1: { player: "Customer", name: "places" },
      role2: { player: "Order", name: "is placed by" },
      uniqueness: "role2",
      mandatory: "role2",
    })
    .withDefinition("Customer", "A person or organization that purchases goods.")
    .build();
}

describe("diffModels", () => {
  it("reports no changes when models are identical", () => {
    const a = baseModel();
    const b = baseModel();
    const result = diffModels(a, b);

    expect(result.hasChanges).toBe(false);
    expect(result.deltas.every((d) => d.kind === "unchanged")).toBe(true);
  });

  it("detects an added object type", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withEntityType("Product", { referenceMode: "product_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.hasChanges).toBe(true);

    const added = result.deltas.filter((d) => d.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0]!.elementType).toBe("object_type");
    expect(added[0]!.name).toBe("Product");
  });

  it("detects a removed object type", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.hasChanges).toBe(true);

    const removed = result.deltas.filter((d) => d.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.elementType).toBe("object_type");
    expect(removed[0]!.name).toBe("Name");
  });

  it("detects a modified object type (kind changed)", () => {
    const existing = baseModel();
    // Rebuild with Name as entity instead of value.
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withEntityType("Name", { referenceMode: "name_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.hasChanges).toBe(true);

    const modified = result.deltas.filter((d) => d.kind === "modified");
    expect(modified.length).toBeGreaterThanOrEqual(1);
    const nameDelta = modified.find((d) => d.name === "Name");
    expect(nameDelta).toBeDefined();
    expect(nameDelta!.changeDescriptions).toContain("kind: value -> entity");
  });

  it("detects an added fact type", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
      })
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.hasChanges).toBe(true);

    const added = result.deltas.filter(
      (d) => d.kind === "added" && d.elementType === "fact_type",
    );
    expect(added).toHaveLength(1);
    expect(added[0]!.name).toBe("Customer has Name");
  });

  it("detects a removed fact type", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.hasChanges).toBe(true);

    const removed = result.deltas.filter(
      (d) => d.kind === "removed" && d.elementType === "fact_type",
    );
    expect(removed).toHaveLength(1);
    expect(removed[0]!.name).toBe("Customer places Order");
  });

  it("detects modified fact type readings", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        readings: ["{0} submits {1}", "{1} is submitted by {0}"],
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const result = diffModels(existing, incoming);
    const modified = result.deltas.find(
      (d) => d.kind === "modified" && d.elementType === "fact_type",
    );
    expect(modified).toBeDefined();
    expect(modified!.changeDescriptions).toContain("readings changed");
  });

  it("detects added and removed definitions", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      // Customer definition removed, Order definition added.
      .withDefinition("Order", "A request to purchase goods.")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.hasChanges).toBe(true);

    const removedDef = result.deltas.find(
      (d) => d.kind === "removed" && d.elementType === "definition",
    );
    expect(removedDef).toBeDefined();
    expect(removedDef!.term).toBe("Customer");

    const addedDef = result.deltas.find(
      (d) => d.kind === "added" && d.elementType === "definition",
    );
    expect(addedDef).toBeDefined();
    expect(addedDef!.term).toBe("Order");
  });

  it("detects modified object type source context", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        sourceContext: "CRM",
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        sourceContext: "Sales",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions).toContain('source context: "CRM" -> "Sales"');
  });

  it("detects modified value constraint", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Rating", { valueConstraint: { values: ["A", "B", "C"] } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Rating", { valueConstraint: { values: ["A", "B", "C", "D"] } })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Rating");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions).toContain("value constraint changed");
  });

  it("detects fact type definition change", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        definition: "A customer submits an order.",
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        definition: "A customer creates an order.",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("definition changed");
  });

  it("detects fact type role player changes", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withEntityType("Agent", { referenceMode: "agent_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withEntityType("Agent", { referenceMode: "agent_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Agent", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions.some((c) => c.includes("player Customer -> Agent"))).toBe(
      true,
    );
  });

  it("detects fact type role name changes", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "submits" },
        role2: { player: "Order", name: "is submitted by" },
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions.some((c) => c.includes('"places" -> "submits"'))).toBe(true);
    expect(delta!.changeDescriptions.some((c) => c.includes('"is placed by" -> "is submitted by"')))
      .toBe(true);
  });

  it("detects constraint additions and removals on fact types", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        mandatory: "role2",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions.some((c) => c.includes("constraints added"))).toBe(true);
    expect(delta!.changeDescriptions.some((c) => c.includes("constraints removed"))).toBe(true);
  });

  it("detects definition context change", () => {
    const existing = new ModelBuilder("Test")
      .withDefinition("Customer", "A buyer.", "CRM")
      .build();
    const incoming = new ModelBuilder("Test")
      .withDefinition("Customer", "A buyer.", "Sales")
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "definition" && d.kind === "modified",
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain('context: "CRM" -> "Sales"');
  });

  it("detects added data type on value type", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Price")
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Price", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Price");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions.some((c) => c.includes("data type added"))).toBe(true);
  });

  it("detects changed data type on value type", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Age", { dataType: { name: "text" } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Age", { dataType: { name: "integer" } })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Age");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions.some((c) => c.includes("data type: text -> integer"))).toBe(
      true,
    );
  });

  it("detects removed data type on value type", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Code", { dataType: { name: "text", length: 10 } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Code")
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Code");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions.some((c) => c.includes("data type removed"))).toBe(true);
  });

  it("reports no change when data types are identical", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Price", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Price", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Price");
    expect(delta!.kind).toBe("unchanged");
  });

  // --- Alias diff tests ---

  it("detects added aliases on an object type", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client"],
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions.some((c) => c.includes("aliases"))).toBe(true);
  });

  it("detects removed aliases on an object type", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client", "Account"],
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions.some((c) => c.includes("aliases"))).toBe(true);
  });

  it("detects changed aliases on an object type", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client"],
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Account"],
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.changeDescriptions.some((c) => c.includes("aliases"))).toBe(true);
  });

  it("reports no change when aliases are the same but in different order", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client", "Account"],
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Account", "Client"],
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("unchanged");
  });

  it("reports no change when both have no aliases", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("unchanged");
  });

  // --- Constraint normalization tests (Stage 2) ---

  it("reports no diff when constraints are identical but role IDs differ", () => {
    // This is the core false-positive bug: two LLM extractions produce
    // the same constraints but with fresh UUIDs for every role.
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    // Build fact type with explicit role IDs on existing model.
    const custA = existing.getObjectTypeByName("Customer")!;
    const ordA = existing.getObjectTypeByName("Order")!;
    existing.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: custA.id, id: "aaa-role1" },
        { name: "is placed by", playerId: ordA.id, id: "aaa-role2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["aaa-role2"] },
        { type: "mandatory", roleId: "aaa-role2" },
      ],
    });

    // Build incoming model with different role UUIDs but same structure.
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const custB = incoming.getObjectTypeByName("Customer")!;
    const ordB = incoming.getObjectTypeByName("Order")!;
    incoming.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: custB.id, id: "bbb-role1" },
        { name: "is placed by", playerId: ordB.id, id: "bbb-role2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["bbb-role2"] },
        { type: "mandatory", roleId: "bbb-role2" },
      ],
    });

    const result = diffModels(existing, incoming);
    const ftDelta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.name === "Customer places Order",
    );
    expect(ftDelta).toBeDefined();
    expect(ftDelta!.kind).toBe("unchanged");
    expect(ftDelta!.changeDescriptions).toHaveLength(0);
  });

  it("detects real constraint change when uniqueness moves to a different role position", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const custA = existing.getObjectTypeByName("Customer")!;
    const ordA = existing.getObjectTypeByName("Order")!;
    existing.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: custA.id, id: "aaa-role1" },
        { name: "is placed by", playerId: ordA.id, id: "aaa-role2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["aaa-role2"] },
      ],
    });

    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const custB = incoming.getObjectTypeByName("Customer")!;
    const ordB = incoming.getObjectTypeByName("Order")!;
    incoming.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: custB.id, id: "bbb-role1" },
        { name: "is placed by", playerId: ordB.id, id: "bbb-role2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        // Uniqueness on role1 instead of role2 -- a real semantic change.
        { type: "internal_uniqueness", roleIds: ["bbb-role1"] },
      ],
    });

    const result = diffModels(existing, incoming);
    const ftDelta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.name === "Customer places Order",
    );
    expect(ftDelta).toBeDefined();
    expect(ftDelta!.kind).toBe("modified");
    expect(ftDelta!.changeDescriptions.some((c) => c.includes("constraints"))).toBe(true);
  });

  it("reports a changed preferred identifier once, as a breaking change to the entity", () => {
    // The reference is the entity's (orm-format-3 WS4b): the fact type's
    // constraints are the same on both sides.
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const custA = existing.getObjectTypeByName("Customer")!;
    const ordA = existing.getObjectTypeByName("Order")!;
    existing.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: custA.id, id: "aaa-role1" },
        { name: "is placed by", playerId: ordA.id, id: "aaa-role2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["aaa-role2"], isPreferred: true },
      ],
    });

    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const custB = incoming.getObjectTypeByName("Customer")!;
    const ordB = incoming.getObjectTypeByName("Order")!;
    incoming.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: custB.id, id: "bbb-role1" },
        { name: "is placed by", playerId: ordB.id, id: "bbb-role2" },
      ],
      readings: ["{0} places {1}"],
      constraints: [
        // Same role position but isPreferred removed.
        { type: "internal_uniqueness", roleIds: ["bbb-role2"] },
      ],
    });

    const result = diffModels(placeFlags(existing), incoming);
    const ftDelta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.name === "Customer places Order",
    );
    expect(ftDelta!.kind).toBe("unchanged");
    const otDelta = result.deltas.find(
      (d) => d.elementType === "object_type" && d.name === "Customer",
    );
    expect(otDelta).toMatchObject({ kind: "modified", breakingLevel: "breaking" });
    expect(otDelta!.changeDescriptions).toEqual([
      'preferred identifier: "Customer places Order" (role 2: Order) -> (none)',
    ]);
  });

  it("reports no preferred identifier change when the uniqueness lists its roles in another order", () => {
    const build = (roleIds: string[]) => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ id: "s", name: "Student", kind: "entity", referenceMode: "nr" });
      model.addObjectType({ id: "c", name: "Course", kind: "entity", referenceMode: "code" });
      model.addObjectType({ id: "e", name: "Enrollment", kind: "entity", referenceMode: "id" });
      model.addFactType({
        id: "ft",
        name: "Student takes Course",
        roles: [{ id: "r-s", name: "takes", playerId: "s" }, {
          id: "r-c",
          name: "is taken by",
          playerId: "c",
        }],
        readings: ["{0} takes {1}"],
        constraints: [{ id: "u", type: "internal_uniqueness", roleIds }],
      });
      model.addObjectifiedFactType({ factTypeId: "ft", objectTypeId: "e" });
      model.setPreferredIdentifier("e", "u");
      return model;
    };
    const result = diffModels(build(["r-s", "r-c"]), build(["r-c", "r-s"]));
    const enrollment = result.deltas.find((d) =>
      d.elementType === "object_type" && d.name === "Enrollment"
    );
    expect(enrollment?.kind).toBe("unchanged");
  });

  it("reports no preferred identifier change when only a role of the identifying fact type is renamed", () => {
    const build = (roleName: string) => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ id: "ot-c", name: "Customer", kind: "entity", referenceMode: "id" });
      model.addObjectType({ id: "ot-cid", name: "CustomerId", kind: "value" });
      model.addFactType({
        id: "ft",
        name: "Customer has CustomerId",
        roles: [
          { id: "r-c", name: "has", playerId: "ot-c" },
          { id: "r-cid", name: roleName, playerId: "ot-cid" },
        ],
        readings: ["{0} has {1}"],
        constraints: [{ id: "u-cid", type: "internal_uniqueness", roleIds: ["r-cid"] }],
      });
      model.setPreferredIdentifier("ot-c", "u-cid");
      return model;
    };
    const result = diffModels(build("is of"), build("identifies"));
    const customer = result.deltas.find((d) =>
      d.elementType === "object_type" && d.name === "Customer"
    );
    expect(customer?.kind).toBe("unchanged");
  });

  it("reports no diff for Phase 2 constraints with different role IDs", () => {
    // Subset, ring, and frequency constraints with fresh UUIDs.
    const existing = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Person2", { referenceMode: "person2_id" })
      .build();

    const p1A = existing.getObjectTypeByName("Person")!;
    const p2A = existing.getObjectTypeByName("Person2")!;
    existing.addFactType({
      name: "Person mentors Person2",
      roles: [
        { name: "mentors", playerId: p1A.id, id: "aaa-r1" },
        { name: "is mentored by", playerId: p2A.id, id: "aaa-r2" },
      ],
      readings: ["{0} mentors {1}"],
      constraints: [
        { type: "ring", roleId1: "aaa-r1", roleId2: "aaa-r2", ringType: "irreflexive" },
        { type: "frequency", roleIds: ["aaa-r1"], min: 1, max: 5 },
      ],
    });

    const incoming = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Person2", { referenceMode: "person2_id" })
      .build();

    const p1B = incoming.getObjectTypeByName("Person")!;
    const p2B = incoming.getObjectTypeByName("Person2")!;
    incoming.addFactType({
      name: "Person mentors Person2",
      roles: [
        { name: "mentors", playerId: p1B.id, id: "bbb-r1" },
        { name: "is mentored by", playerId: p2B.id, id: "bbb-r2" },
      ],
      readings: ["{0} mentors {1}"],
      constraints: [
        { type: "ring", roleId1: "bbb-r1", roleId2: "bbb-r2", ringType: "irreflexive" },
        { type: "frequency", roleIds: ["bbb-r1"], min: 1, max: 5 },
      ],
    });

    const result = diffModels(existing, incoming);
    const ftDelta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.name === "Person mentors Person2",
    );
    expect(ftDelta).toBeDefined();
    expect(ftDelta!.kind).toBe("unchanged");
    expect(ftDelta!.changeDescriptions).toHaveLength(0);
  });

  it("detects Phase 2 semantic change (ring type changed)", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Person2", { referenceMode: "person2_id" })
      .build();

    const p1A = existing.getObjectTypeByName("Person")!;
    const p2A = existing.getObjectTypeByName("Person2")!;
    existing.addFactType({
      name: "Person mentors Person2",
      roles: [
        { name: "mentors", playerId: p1A.id, id: "aaa-r1" },
        { name: "is mentored by", playerId: p2A.id, id: "aaa-r2" },
      ],
      readings: ["{0} mentors {1}"],
      constraints: [
        { type: "ring", roleId1: "aaa-r1", roleId2: "aaa-r2", ringType: "irreflexive" },
      ],
    });

    const incoming = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withEntityType("Person2", { referenceMode: "person2_id" })
      .build();

    const p1B = incoming.getObjectTypeByName("Person")!;
    const p2B = incoming.getObjectTypeByName("Person2")!;
    incoming.addFactType({
      name: "Person mentors Person2",
      roles: [
        { name: "mentors", playerId: p1B.id, id: "bbb-r1" },
        { name: "is mentored by", playerId: p2B.id, id: "bbb-r2" },
      ],
      readings: ["{0} mentors {1}"],
      constraints: [
        // Same positions but ringType changed.
        { type: "ring", roleId1: "bbb-r1", roleId2: "bbb-r2", ringType: "asymmetric" },
      ],
    });

    const result = diffModels(existing, incoming);
    const ftDelta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.name === "Person mentors Person2",
    );
    expect(ftDelta).toBeDefined();
    expect(ftDelta!.kind).toBe("modified");
    expect(ftDelta!.changeDescriptions.some((c) => c.includes("constraints"))).toBe(true);
  });

  it("detects modified definition text", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2",
      })
      .withDefinition("Customer", "A buyer of products or services.")
      .build();

    const result = diffModels(existing, incoming);
    const modified = result.deltas.find(
      (d) => d.kind === "modified" && d.elementType === "definition",
    );
    expect(modified).toBeDefined();
    expect(modified!.changeDescriptions).toContain("definition text changed");
  });

  // --- Synonym candidate detection tests (Stage 3) ---

  it("flags synonym candidate when removed name appears in added type aliases", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Client", {
        referenceMode: "client_id",
        aliases: ["Customer"],
      })
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(1);
    expect(result.synonymCandidates[0]!.removedName).toBe("Customer");
    expect(result.synonymCandidates[0]!.addedName).toBe("Client");
    expect(result.synonymCandidates[0]!.elementType).toBe("object_type");
    expect(result.synonymCandidates[0]!.reasons.some((r) => r.includes("alias"))).toBe(true);
  });

  it("flags synonym candidate when entities have matching reference mode suffix", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Client", { referenceMode: "client_id" })
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(1);
    expect(result.synonymCandidates[0]!.removedName).toBe("Customer");
    expect(result.synonymCandidates[0]!.addedName).toBe("Client");
    expect(result.synonymCandidates[0]!.reasons.some((r) => r.includes("reference mode"))).toBe(
      true,
    );
  });

  it("flags synonym candidate when value types have overlapping value constraints", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Rating", { valueConstraint: { values: ["A", "B", "C"] } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Grade", { valueConstraint: { values: ["A", "B", "D"] } })
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(1);
    expect(result.synonymCandidates[0]!.removedName).toBe("Rating");
    expect(result.synonymCandidates[0]!.addedName).toBe("Grade");
    expect(result.synonymCandidates[0]!.reasons.some((r) => r.includes("value constraint"))).toBe(
      true,
    );
  });

  it("does not flag synonym when kinds differ", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Client")
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(0);
  });

  it("does not flag synonym when no structural signal matches", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Foo", { referenceMode: "foo_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Bar", { referenceMode: "bar_code" })
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(0);
  });

  it("reports multiple synonym candidates when one removed matches multiple added", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Client", {
        referenceMode: "client_id",
        aliases: ["Customer"],
      })
      .withEntityType("Account", {
        referenceMode: "account_id",
        aliases: ["Customer"],
      })
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(2);
    const names = result.synonymCandidates.map((c) => c.addedName).sort();
    expect(names).toEqual(["Account", "Client"]);
    expect(result.synonymCandidates.every((c) => c.removedName === "Customer")).toBe(true);
  });

  it("flags fact type synonym when role players are OT synonym candidates", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Client", { referenceMode: "client_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Client places Order", {
        role1: { player: "Client", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const result = diffModels(existing, incoming);

    // Customer/Client should be an OT synonym candidate.
    const otCandidates = result.synonymCandidates.filter(
      (c) => c.elementType === "object_type",
    );
    expect(otCandidates).toHaveLength(1);
    expect(otCandidates[0]!.removedName).toBe("Customer");
    expect(otCandidates[0]!.addedName).toBe("Client");

    // The fact type pair should also be flagged via transitive matching.
    const ftCandidates = result.synonymCandidates.filter(
      (c) => c.elementType === "fact_type",
    );
    expect(ftCandidates).toHaveLength(1);
    expect(ftCandidates[0]!.removedName).toBe("Customer places Order");
    expect(ftCandidates[0]!.addedName).toBe("Client places Order");
  });

  it("does not flag fact type synonym when arity differs", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("A", { referenceMode: "a_id" })
      .withEntityType("B", { referenceMode: "b_id" })
      .withBinaryFactType("A relates B", {
        role1: { player: "A", name: "relates" },
        role2: { player: "B", name: "is related by" },
      })
      .build();
    // Can't easily build a ternary via ModelBuilder, so just ensure
    // a binary-only incoming with no matching fact type doesn't crash.
    const incoming = new ModelBuilder("Test")
      .withEntityType("A", { referenceMode: "a_id" })
      .withEntityType("B", { referenceMode: "b_id" })
      .build();

    const result = diffModels(existing, incoming);
    const ftCandidates = result.synonymCandidates.filter(
      (c) => c.elementType === "fact_type",
    );
    expect(ftCandidates).toHaveLength(0);
  });

  it("returns empty synonymCandidates when diff has no removes or no adds", () => {
    // Only additions, no removals.
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const result = diffModels(existing, incoming);
    expect(result.synonymCandidates).toHaveLength(0);
  });

  // --- Breaking change classification tests (Stage 4) ---

  it("classifies unchanged delta as safe", () => {
    const a = baseModel();
    const b = baseModel();
    const result = diffModels(a, b);
    const unchanged = result.deltas.filter((d) => d.kind === "unchanged");
    expect(unchanged.length).toBeGreaterThan(0);
    for (const d of unchanged) {
      expect(d.breakingLevel).toBe("safe");
    }
  });

  it("classifies added delta as safe", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const result = diffModels(existing, incoming);
    const added = result.deltas.filter((d) => d.kind === "added");
    expect(added).toHaveLength(1);
    expect(added[0]!.breakingLevel).toBe("safe");
  });

  it("classifies removed delta as breaking", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("Name")
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const result = diffModels(existing, incoming);
    const removed = result.deltas.filter((d) => d.kind === "removed");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.breakingLevel).toBe("breaking");
  });

  it("classifies definition-only change as safe", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "Old def",
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "New def",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.breakingLevel).toBe("safe");
  });

  it("classifies alias-only change as safe", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client"],
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.breakingLevel).toBe("safe");
  });

  it("classifies reference mode change as caution", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_code" })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Customer");
    expect(delta!.kind).toBe("modified");
    expect(delta!.breakingLevel).toBe("caution");
  });

  it("classifies kind change (entity -> value) as breaking", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Name")
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Name", { referenceMode: "name_id" })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Name");
    expect(delta!.kind).toBe("modified");
    expect(delta!.breakingLevel).toBe("breaking");
  });

  it("classifies arity change as breaking", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("A", { referenceMode: "a_id" })
      .withEntityType("B", { referenceMode: "b_id" })
      .withEntityType("C", { referenceMode: "c_id" })
      .build();

    const aA = existing.getObjectTypeByName("A")!;
    const bA = existing.getObjectTypeByName("B")!;
    existing.addFactType({
      name: "A relates B",
      roles: [
        { name: "relates", playerId: aA.id, id: "r1" },
        { name: "is related by", playerId: bA.id, id: "r2" },
      ],
      readings: ["{0} relates {1}"],
      constraints: [],
    });

    const incoming = new ModelBuilder("Test")
      .withEntityType("A", { referenceMode: "a_id" })
      .withEntityType("B", { referenceMode: "b_id" })
      .withEntityType("C", { referenceMode: "c_id" })
      .build();

    const aB = incoming.getObjectTypeByName("A")!;
    const bB = incoming.getObjectTypeByName("B")!;
    const cB = incoming.getObjectTypeByName("C")!;
    incoming.addFactType({
      name: "A relates B",
      roles: [
        { name: "relates", playerId: aB.id, id: "s1" },
        { name: "is related by", playerId: bB.id, id: "s2" },
        { name: "involves", playerId: cB.id, id: "s3" },
      ],
      readings: ["{0} relates {1} involving {2}"],
      constraints: [],
    });

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.name === "A relates B",
    );
    expect(delta!.kind).toBe("modified");
    expect(delta!.breakingLevel).toBe("breaking");
  });

  it("classifies role player change as breaking", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withEntityType("Agent", { referenceMode: "agent_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withEntityType("Agent", { referenceMode: "agent_id" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Agent", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta!.breakingLevel).toBe("breaking");
  });

  it("classifies constraint addition as caution", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        mandatory: "role2",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta!.breakingLevel).toBe("caution");
  });

  it("classifies mixed safe + breaking changes as breaking (most severe wins)", () => {
    // Definition change (safe) + kind change (breaking) = breaking.
    const existing = new ModelBuilder("Test")
      .withValueType("Name", { definition: "Old" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Name", {
        referenceMode: "name_id",
        definition: "New",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find((d) => d.name === "Name");
    expect(delta!.kind).toBe("modified");
    expect(delta!.breakingLevel).toBe("breaking");
  });

  it("classifies role name change only as safe", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "submits" },
        role2: { player: "Order", name: "is submitted by" },
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta!.breakingLevel).toBe("safe");
  });

  it("classifies readings-only change as safe", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        readings: ["{0} submits {1}"],
        uniqueness: "role2",
      })
      .build();

    const result = diffModels(existing, incoming);
    const delta = result.deltas.find(
      (d) => d.elementType === "fact_type" && d.kind === "modified",
    );
    expect(delta!.breakingLevel).toBe("safe");
  });

  it("does not alter deltas or synonymCandidates with breakingLevel classification", () => {
    // Verify existing behavior unchanged.
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Client", { referenceMode: "client_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Client places Order", {
        role1: { player: "Client", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const result = diffModels(existing, incoming);

    // deltas still show remove + add, not modified.
    const removed = result.deltas.filter((d) => d.kind === "removed");
    const added = result.deltas.filter((d) => d.kind === "added");
    expect(removed.length).toBeGreaterThan(0);
    expect(added.length).toBeGreaterThan(0);

    // Synonym detection still works.
    expect(result.synonymCandidates.length).toBeGreaterThan(0);

    // Every delta has a breakingLevel.
    for (const d of result.deltas) {
      expect(["safe", "caution", "breaking"]).toContain(d.breakingLevel);
    }
  });

  it("does not alter deltas array when synonym candidates are detected", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Client", { referenceMode: "client_id" })
      .build();

    const result = diffModels(existing, incoming);

    // Synonym candidate should exist.
    expect(result.synonymCandidates.length).toBeGreaterThan(0);

    // But deltas should still show a remove + add, not a modification.
    const removed = result.deltas.filter((d) => d.kind === "removed");
    const added = result.deltas.filter((d) => d.kind === "added");
    expect(removed).toHaveLength(1);
    expect(removed[0]!.name).toBe("Customer");
    expect(added).toHaveLength(1);
    expect(added[0]!.name).toBe("Client");
  });

  it("detects a constraint modality change (alethic vs deontic)", () => {
    function model(modality: "alethic" | "deontic") {
      const m = new OrmModel({ name: "Test" });
      const customer = m.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      const order = m.addObjectType({
        name: "Order",
        kind: "entity",
        referenceMode: "order_number",
      });
      m.addFactType({
        name: "Customer places Order",
        roles: [
          { name: "places", playerId: customer.id, id: "r1" },
          { name: "is placed by", playerId: order.id, id: "r2" },
        ],
        readings: ["{0} places {1}"],
        constraints: [{ type: "mandatory", roleId: "r2", modality }],
      });
      return m;
    }

    const result = diffModels(model("alethic"), model("deontic"));
    expect(result.hasChanges).toBe(true);
    expect(
      result.deltas.some((d) => d.kind === "modified" && d.elementType === "fact_type"),
    ).toBe(true);
  });

  it("detects an object-type cardinality change", () => {
    const make = (max: number | "unbounded") => {
      const m = new OrmModel({ name: "Test" });
      m.addObjectType({
        name: "Department",
        kind: "entity",
        referenceMode: "dept_id",
        cardinality: { min: 0, max },
      });
      return m;
    };

    const result = diffModels(make(50), make(100));
    const delta = result.deltas.find((d) => d.kind === "modified" && d.name === "Department");
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("cardinality changed");
  });

  // barwise-934: the diff compared eight of an object type's fields and
  // not these three, so a model whose only edit was one of them diffed as
  // "unchanged". After barwise-927 taught the merge to carry the existing
  // element forward, that made the incoming value unreachable through
  // every surface: no delta to accept, so the edit could not be merged.
  it("detects an object-type note change", () => {
    const make = (note: string) => {
      const m = new OrmModel({ name: "Test" });
      m.addObjectType({ name: "Department", kind: "entity", referenceMode: "dept_id", note });
      return m;
    };
    const result = diffModels(make("first"), make("second"));
    const delta = result.deltas.find((d) => d.kind === "modified" && d.name === "Department");
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("note changed");
    // Free text about the model, not a change to what the model permits.
    expect(delta!.breakingLevel).toBe("safe");
  });

  it("detects an object-type independence change", () => {
    const make = (independent: boolean) => {
      const m = new OrmModel({ name: "Test" });
      m.addObjectType({
        name: "Department",
        kind: "entity",
        referenceMode: "dept_id",
        independent,
      });
      return m;
    };
    const result = diffModels(make(false), make(true));
    const delta = result.deltas.find((d) => d.kind === "modified" && d.name === "Department");
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("independent: false -> true");
    // Changes which populations are legal, so a consumer should look.
    expect(delta!.breakingLevel).toBe("caution");
  });

  it("detects an object-type default value change", () => {
    const make = (defaultValue: string) => {
      const m = new OrmModel({ name: "Test" });
      m.addObjectType({ name: "Amount", kind: "value", dataType: { name: "money" }, defaultValue });
      return m;
    };
    const result = diffModels(make("0"), make("1"));
    const delta = result.deltas.find((d) => d.kind === "modified" && d.name === "Amount");
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain('default value: "0" -> "1"');
    expect(delta!.breakingLevel).toBe("caution");
  });

  // Found while grounding barwise-934: the value-constraint comparison read
  // `values` and never `ranges`, so a narrowed range was invisible for the
  // same reason and with a worse consequence -- it changes what the model
  // permits.
  it("detects a value-constraint range change when the enumerated values match", () => {
    const make = (max: string) => {
      const m = new OrmModel({ name: "Test" });
      m.addObjectType({
        name: "Rating",
        kind: "value",
        dataType: { name: "integer" },
        valueConstraint: { values: [], ranges: [{ min: "1", max }] },
      });
      return m;
    };
    const result = diffModels(make("10"), make("5"));
    const delta = result.deltas.find((d) => d.kind === "modified" && d.name === "Rating");
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("value constraint changed");
  });

  it("detects a fact-type note change", () => {
    const make = (note: string) => {
      const m = new OrmModel({ name: "Test" });
      const order = m.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_id" });
      const total = m.addObjectType({ name: "TotalPrice", kind: "value" });
      m.addFactType({
        id: "ft-1",
        name: "Order has TotalPrice",
        roles: [
          { name: "has", playerId: order.id, id: "r1" },
          { name: "of", playerId: total.id, id: "r2" },
        ],
        readings: ["{0} has {1}"],
        note,
      });
      return m;
    };
    const result = diffModels(make("first"), make("second"));
    const delta = result.deltas.find((d) =>
      d.kind === "modified" && d.name === "Order has TotalPrice"
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("note changed");
    expect(delta!.breakingLevel).toBe("safe");
  });

  it("detects a fact-type derivation change", () => {
    const make = (expression: string) => {
      const m = new OrmModel({ name: "Test" });
      const order = m.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_id" });
      const total = m.addObjectType({ name: "TotalPrice", kind: "value" });
      m.addFactType({
        id: "ft-1",
        name: "Order has TotalPrice",
        roles: [
          { name: "has", playerId: order.id, id: "r1" },
          { name: "of", playerId: total.id, id: "r2" },
        ],
        readings: ["{0} has {1}"],
        derivation: { kind: "derived", expression },
      });
      return m;
    };

    const result = diffModels(make("Quantity * UnitPrice"), make("Quantity * NetPrice"));
    const delta = result.deltas.find(
      (d) => d.kind === "modified" && d.elementType === "fact_type",
    );
    expect(delta).toBeDefined();
    expect(delta!.changeDescriptions).toContain("derivation changed");
  });

  it("detects a changed join constraint path", () => {
    const make = (citizenExit: string) => {
      const m = new OrmModel({ name: "Test" });
      const person = m.addObjectType({
        id: "ot-person",
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const country = m.addObjectType({
        name: "Country",
        kind: "entity",
        referenceMode: "country_code",
      });
      m.addFactType({
        name: "Person was born in Country",
        roles: [
          { name: "was born in", playerId: person.id, id: "pb-person" },
          { name: "is birthplace of", playerId: country.id, id: "pb-country" },
        ],
        readings: ["{0} was born in {1}"],
      });
      m.addFactType({
        id: "ft-citizen",
        name: "Person is citizen of Country",
        roles: [
          { name: "is citizen of", playerId: person.id, id: "pc-person" },
          { name: "has citizen", playerId: country.id, id: citizenExit },
        ],
        readings: ["{0} is citizen of {1}"],
      });
      m.addConstraint({
        type: "join_equality",
        operands: [
          {
            path: { root: person.id, steps: [{ entry: "pb-person", exit: "pb-country" }] },
            projection: [0, 1],
          },
          {
            path: { root: person.id, steps: [{ entry: "pc-person", exit: citizenExit }] },
            projection: [0, 1],
          },
        ],
      });
      return m;
    };

    const result = diffModels(make("pc-country"), make("pc-country-2"));
    // A join constraint spans fact types, so it is the model's and has a
    // delta of its own (WS3c). Built in code twice, it is named from its
    // sentence both times, which reads the same, so the two pair by id and
    // the changed path is one modification (iri-identity 6b).
    const kinds = result.deltas.flatMap((d) =>
      d.elementType === "constraint" && d.constraintType === "join_equality" ? [d.kind] : []
    );
    expect(kinds).toEqual(["modified"]);
  });
});

describe("a constraint over roles of other fact types", () => {
  // barwise-b7z: a role outside the host fact type was keyed by its raw
  // id, so two models differing only in role ids reported every external
  // uniqueness as removed and added.
  const model = (
    unique: "number" | "name",
    buildingRole = 1,
    other = "Room is in Building",
    dangling?: string,
    constraintId?: string,
  ) => {
    const m = new ModelBuilder("Rooms")
      .withEntityType("Room", { referenceMode: "room_id" })
      .withEntityType("Building", { referenceMode: "building_id" })
      .withValueType("RoomNumber")
      .withValueType("RoomName")
      .withBinaryFactType("Room has RoomNumber", {
        role1: { player: "Room", name: "has" },
        role2: { player: "RoomNumber", name: "is of" },
      })
      .withBinaryFactType("Room has RoomName", {
        role1: { player: "Room", name: "has" },
        role2: { player: "RoomName", name: "is of" },
      })
      .withBinaryFactType("Room is in Building", {
        role1: { player: "Room", name: "is in" },
        role2: { player: "Building", name: "houses" },
      })
      .build();
    const host = m.getFactTypeByName(
      unique === "number" ? "Room has RoomNumber" : "Room has RoomName",
    )!;
    const building = m.getFactTypeByName(other)!;
    m.addConstraint({
      type: "external_uniqueness",
      ...(constraintId !== undefined ? { id: constraintId } : {}),
      roleIds: [host.roles[1]!.id, dangling ?? building.roles[buildingRole]!.id],
    });
    return m;
  };
  // The same model with every role id replaced, as an import mints them.
  // The ids are read from the model, not matched by a pattern, so a change
  // to the builder's id format cannot leave this rewriting nothing.
  const withNewRoleIds = (m: OrmModel) => {
    const yaml = new OrmYamlSerializer();
    let text = yaml.serialize(m);
    for (const [i, id] of m.factTypes.flatMap((ft) => ft.roles.map((r) => r.id)).entries()) {
      text = text.split(id).join(`minted-role-${i}`);
    }
    return yaml.deserialize(text);
  };
  // A constraint across fact types has its own delta since WS3c; read an
  // added or removed one as the change kind a fact type used to report.
  const constraintChanges = (a: OrmModel, b: OrmModel) =>
    diffModels(a, b).deltas.flatMap((d) =>
      d.elementType === "constraint"
        ? d.kind === "added"
          ? [{ change: "constraintsAdded" }]
          : d.kind === "removed"
          ? [{ change: "constraintsRemoved" }]
          : []
        : d.changes.filter((c) =>
          c.change === "constraintsAdded" || c.change === "constraintsRemoved"
        )
    );

  it("is unchanged when only the role ids differ", () => {
    const a = model("number");
    const b = withNewRoleIds(a);
    expect(a.getFactTypeByName("Room is in Building")!.roles[1]!.id)
      .not.toBe(b.getFactTypeByName("Room is in Building")!.roles[1]!.id);
    expect(constraintChanges(a, b)).toEqual([]);
  });

  it("is reported when it names a different role of the other fact type", () => {
    expect(constraintChanges(model("number"), model("number", 0)).map((c) => c.change).sort())
      .toEqual(["constraintsAdded", "constraintsRemoved"]);
  });

  it("is reported when it names the same position of a different fact type", () => {
    // The fact type's name is part of the key, not only the position.
    expect(
      constraintChanges(model("number"), model("number", 1, "Room has RoomName")).map((c) =>
        c.change
      ).sort(),
    )
      .toEqual(["constraintsAdded", "constraintsRemoved"]);
  });

  it("keys a role id two fact types hold by its raw id, as graphOf refuses it", () => {
    // Ambiguous: naming either holder could match a constraint that names
    // the other. With the raw id, regenerated ids read as a change, which
    // is the conservative answer.
    const ambiguous = (m: OrmModel) => {
      const yaml = new OrmYamlSerializer();
      const text = yaml.serialize(m);
      const id = m.getFactTypeByName("Room is in Building")!.roles[1]!.id;
      const other = m.getFactTypeByName("Room has RoomName")!.roles[1]!.id;
      return yaml.deserialize(text.split(other).join(id));
    };
    // Unrelated constraint ids, as two 3.x imports of one schema give, so
    // the pairing falls to the key.
    const a = ambiguous(model("number", 1, undefined, undefined, "eu-a"));
    const b = ambiguous(withNewRoleIds(model("number", 1, undefined, undefined, "eu-b")));
    expect(constraintChanges(a, b).length).toBeGreaterThan(0);
  });

  it("keys a host role id another fact type also holds by its raw id", () => {
    // The host's own position is no safer an answer than either holder.
    const ambiguousHost = (m: OrmModel) => {
      const yaml = new OrmYamlSerializer();
      const id = m.getFactTypeByName("Room has RoomNumber")!.roles[1]!.id;
      const other = m.getFactTypeByName("Room has RoomName")!.roles[1]!.id;
      return yaml.deserialize(yaml.serialize(m).split(other).join(id));
    };
    const a = ambiguousHost(model("number", 1, undefined, undefined, "eu-a"));
    const b = ambiguousHost(withNewRoleIds(model("number", 1, undefined, undefined, "eu-b")));
    expect(constraintChanges(a, b).length).toBeGreaterThan(0);
  });

  it("resolves a role a lenient fragment does not define against the other model, both ways", () => {
    // The fragment holds the host fact type only; the Building role its
    // constraint names is defined in the full model alone.
    const full = new OrmModel({ name: "M" });
    full.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "nr" });
    full.addObjectType({ id: "ot-bld", name: "Building", kind: "entity", referenceMode: "code" });
    full.addObjectType({ id: "ot-num", name: "RoomNumber", kind: "value" });
    const hostConfig = {
      id: "ft-num",
      name: "Room has RoomNumber",
      roles: [
        { id: "r-room", name: "has", playerId: "ot-room" },
        { id: "r-num", name: "is of", playerId: "ot-num" },
      ],
      readings: ["{0} has {1}"],
    };
    const key = { type: "external_uniqueness" as const, roleIds: ["r-num", "r-bld"] };
    full.addFactType(hostConfig);
    full.addFactType({
      id: "ft-bld",
      name: "Room is in Building",
      roles: [
        { id: "r-in", name: "is in", playerId: "ot-room" },
        { id: "r-bld", name: "houses", playerId: "ot-bld" },
      ],
      readings: ["{0} is in {1}"],
    });
    full.addConstraint(key);
    const fragment = new OrmModel({ name: "M" });
    fragment.addFactType(hostConfig, { skipPlayerValidation: true });
    fragment.addConstraint(key);
    expect(constraintChanges(full, fragment)).toEqual([]);
    expect(constraintChanges(fragment, full)).toEqual([]);
  });

  it("does not match a dangling id spelled like the key of a resolved role", () => {
    // Raw, host and foreign keys are tagged apart; untagged, this id read
    // as position 1 of "Room is in Building".
    expect(
      constraintChanges(
        model("number"),
        model("number", 1, "Room is in Building", "Room is in Building#1"),
      )
        .map((c) => c.change).sort(),
    ).toEqual(["constraintsAdded", "constraintsRemoved"]);
  });

  it("that a 2.0 file nests under another fact type is the same constraint", () => {
    // Host-independent since WS3c: the model holds it, so where a file
    // nested it says nothing, and merge applies the constraint's own delta.
    const nested = (host: string) => {
      const m = model("number");
      return loadNestedUnder(m, m.getFactTypeByName(host)!.id);
    };
    const a = nested("Room has RoomNumber");
    const b = nested("Room is in Building");
    expect(constraintChanges(a, b)).toEqual([]);
    expect(diffModels(a, b).hasChanges).toBe(false);
  });
});
