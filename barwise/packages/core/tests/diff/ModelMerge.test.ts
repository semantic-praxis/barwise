/**
 * Tests for the selective model merge engine.
 *
 * mergeModels takes an existing model, an incoming model, a list of
 * deltas (from diffModels), and a set of accepted delta indices. It
 * produces a new OrmModel that applies only the accepted changes.
 * This powers the "review and accept changes" UI for LLM re-extraction.
 * These tests verify:
 *   - No changes when nothing is accepted
 *   - Adding/removing/modifying object types, fact types, and definitions
 *   - UUID preservation (existing elements keep their IDs after merge)
 *   - Player-ID remapping (new fact types reference existing OT IDs)
 *   - Full replacement (accept all deltas)
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { getStructuralErrors, mergeAndValidate, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

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

describe("mergeModels", () => {
  it("returns existing model unchanged when no deltas are accepted", () => {
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

    const diff = diffModels(existing, incoming);
    const accepted = new Set<number>(); // Nothing accepted.
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Customer", "Name", "Order"],
    );
    expect(merged.factTypes.map((f) => f.name)).toEqual(
      ["Customer places Order"],
    );
  });

  it("adds new object type when its delta is accepted", () => {
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

    const diff = diffModels(existing, incoming);
    const addedIdx = diff.deltas.findIndex(
      (d) => d.kind === "added" && d.name === "Product",
    );
    expect(addedIdx).toBeGreaterThanOrEqual(0);

    const accepted = new Set([addedIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Customer", "Name", "Order", "Product"],
    );
  });

  it("removes object type when removal delta is accepted", () => {
    const existing = baseModel();
    // Incoming does not have Name.
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

    const diff = diffModels(existing, incoming);
    const removedIdx = diff.deltas.findIndex(
      (d) => d.kind === "removed" && d.name === "Name",
    );
    expect(removedIdx).toBeGreaterThanOrEqual(0);

    const accepted = new Set([removedIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Customer", "Order"],
    );
  });

  it("keeps existing object type when removal delta is rejected", () => {
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

    const diff = diffModels(existing, incoming);
    const accepted = new Set<number>(); // Reject everything.
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Customer", "Name", "Order"],
    );
  });

  it("preserves existing UUIDs for modified object types", () => {
    const existing = baseModel();
    const existingCustomer = existing.getObjectTypeByName("Customer")!;

    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        definition: "A buyer of goods",
      })
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

    const diff = diffModels(existing, incoming);
    const modifiedIdx = diff.deltas.findIndex(
      (d) => d.kind === "modified" && d.name === "Customer",
    );
    expect(modifiedIdx).toBeGreaterThanOrEqual(0);

    const accepted = new Set([modifiedIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    const mergedCustomer = merged.getObjectTypeByName("Customer")!;
    // UUID should be preserved from existing.
    expect(mergedCustomer.id).toBe(existingCustomer.id);
    // Content should come from incoming.
    expect(mergedCustomer.definition).toBe("A buyer of goods");
  });

  it("adds new fact type with correct role player references", () => {
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

    const diff = diffModels(existing, incoming);
    const addedIdx = diff.deltas.findIndex(
      (d) => d.kind === "added" && d.name === "Customer has Name",
    );
    const accepted = new Set([addedIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.factTypes).toHaveLength(2);
    const newFt = merged.getFactTypeByName("Customer has Name")!;
    expect(newFt).toBeDefined();

    // The role player ids should reference object types that exist in the merged model.
    for (const role of newFt.roles) {
      expect(merged.getObjectType(role.playerId)).toBeDefined();
    }
  });

  it("handles definition additions and removals independently", () => {
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
      // Replace Customer definition with Order definition.
      .withDefinition("Order", "A request to purchase goods.")
      .build();

    const diff = diffModels(existing, incoming);

    // Accept the new definition but reject the removal.
    const addedDefIdx = diff.deltas.findIndex(
      (d) => d.kind === "added" && d.elementType === "definition",
    );
    const accepted = new Set([addedDefIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    // Both definitions should be present.
    const terms = merged.definitions.map((d) => d.term).sort();
    expect(terms).toEqual(["Customer", "Order"]);
  });

  it("removes fact type when removal delta is accepted", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const diff = diffModels(existing, incoming);
    const removedIdx = diff.deltas.findIndex(
      (d) => d.kind === "removed" && d.elementType === "fact_type",
    );
    expect(removedIdx).toBeGreaterThanOrEqual(0);

    const accepted = new Set([removedIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.factTypes).toHaveLength(0);
  });

  it("keeps fact type when removal delta is rejected", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withValueType("Name")
      .withDefinition("Customer", "A person or organization that purchases goods.")
      .build();

    const diff = diffModels(existing, incoming);
    const accepted = new Set<number>(); // Reject everything.
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.factTypes).toHaveLength(1);
    expect(merged.factTypes[0]!.name).toBe("Customer places Order");
  });

  it("applies accepted definition modification", () => {
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
      .withDefinition("Customer", "A buyer of products.")
      .build();

    const diff = diffModels(existing, incoming);
    const modIdx = diff.deltas.findIndex(
      (d) => d.kind === "modified" && d.elementType === "definition",
    );
    expect(modIdx).toBeGreaterThanOrEqual(0);

    const accepted = new Set([modIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    expect(merged.definitions).toHaveLength(1);
    expect(merged.definitions[0]!.definition).toBe("A buyer of products.");
  });

  it("applies modified fact type when accepted", () => {
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

    const diff = diffModels(existing, incoming);
    const modIdx = diff.deltas.findIndex(
      (d) => d.kind === "modified" && d.elementType === "fact_type",
    );
    expect(modIdx).toBeGreaterThanOrEqual(0);

    // Accept the modification.
    const accepted = new Set([modIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    const ft = merged.getFactTypeByName("Customer places Order")!;
    // Should keep the existing id.
    expect(ft.id).toBe(existing.getFactTypeByName("Customer places Order")!.id);
    // Should take the incoming content.
    expect(ft.roles[0]!.name).toBe("submits");
  });

  it("keeps existing fact type when modified delta is rejected", () => {
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

    const diff = diffModels(existing, incoming);
    // Reject everything.
    const merged = mergeModels(existing, incoming, diff.deltas, new Set<number>());

    const ft = merged.getFactTypeByName("Customer places Order")!;
    expect(ft.roles[0]!.name).toBe("places");
  });

  it("remaps incoming player ids when adding a fact type for existing object types", () => {
    // This exercises the resolvePlayerId incoming-id mapping path.
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("Name")
      .build();

    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("Name")
      .withBinaryFactType("Customer has Name", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Name", name: "is of" },
        uniqueness: "role1",
      })
      .build();

    const diff = diffModels(existing, incoming);
    const addedFtIdx = diff.deltas.findIndex(
      (d) => d.kind === "added" && d.elementType === "fact_type",
    );
    const accepted = new Set([addedFtIdx]);
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    const ft = merged.getFactTypeByName("Customer has Name")!;
    expect(ft).toBeDefined();
    // Player ids should reference the existing model's object type ids.
    const existingCustomerId = existing.getObjectTypeByName("Customer")!.id;
    const existingNameId = existing.getObjectTypeByName("Name")!.id;
    expect(ft.roles[0]!.playerId).toBe(existingCustomerId);
    expect(ft.roles[1]!.playerId).toBe(existingNameId);
  });

  it("accepts all deltas to fully replace the model", () => {
    const existing = baseModel();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withValueType("Email")
      .withBinaryFactType("Person has Email", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Email", name: "belongs to" },
        uniqueness: "role1",
      })
      .withDefinition("Person", "A human user.")
      .build();

    const diff = diffModels(existing, incoming);
    // Accept everything.
    const allIndices = new Set(diff.deltas.map((_, i) => i));
    const merged = mergeModels(existing, incoming, diff.deltas, allIndices);

    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Email", "Person"],
    );
    expect(merged.factTypes.map((f) => f.name)).toEqual(["Person has Email"]);
    expect(merged.definitions.map((d) => d.term)).toEqual(["Person"]);
  });

  it("preserves dataType on unchanged object types", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Price", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Price", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .build();

    const diff = diffModels(existing, incoming);
    const merged = mergeModels(existing, incoming, diff.deltas, new Set());
    const price = merged.getObjectTypeByName("Price")!;
    expect(price.dataType).toBeDefined();
    expect(price.dataType!.name).toBe("decimal");
    expect(price.dataType!.length).toBe(10);
    expect(price.dataType!.scale).toBe(2);
  });

  it("propagates dataType when accepting added object type", () => {
    const existing = new ModelBuilder("Test").build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Amount", { dataType: { name: "money" } })
      .build();

    const diff = diffModels(existing, incoming);
    const allIndices = new Set(diff.deltas.map((_, i) => i));
    const merged = mergeModels(existing, incoming, diff.deltas, allIndices);
    const amount = merged.getObjectTypeByName("Amount")!;
    expect(amount.dataType).toBeDefined();
    expect(amount.dataType!.name).toBe("money");
  });

  // --- Alias merge tests ---

  it("preserves aliases on unchanged object types", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client"],
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client"],
      })
      .build();

    const diff = diffModels(existing, incoming);
    const merged = mergeModels(existing, incoming, diff.deltas, new Set());

    const customer = merged.getObjectTypeByName("Customer")!;
    expect(customer.aliases).toEqual(["Client"]);
  });

  it("unions aliases when accepting modified object type", () => {
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

    const diff = diffModels(existing, incoming);
    const modIdx = diff.deltas.findIndex(
      (d) => d.name === "Customer" && d.kind === "modified",
    );
    expect(modIdx).toBeGreaterThanOrEqual(0);

    const merged = mergeModels(
      existing,
      incoming,
      diff.deltas,
      new Set([modIdx]),
    );

    const customer = merged.getObjectTypeByName("Customer")!;
    // Should contain both existing and incoming aliases, deduplicated.
    expect(customer.aliases).toContain("Client");
    expect(customer.aliases).toContain("Account");
    expect(customer.aliases).toHaveLength(2);
  });

  it("keeps existing aliases when rejecting modification", () => {
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

    const diff = diffModels(existing, incoming);
    // Reject everything.
    const merged = mergeModels(existing, incoming, diff.deltas, new Set());

    const customer = merged.getObjectTypeByName("Customer")!;
    expect(customer.aliases).toEqual(["Client"]);
  });

  it("carries aliases on added object types", () => {
    const existing = new ModelBuilder("Test").build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client", "Account"],
      })
      .build();

    const diff = diffModels(existing, incoming);
    const addedIdx = diff.deltas.findIndex(
      (d) => d.kind === "added" && d.name === "Customer",
    );
    const merged = mergeModels(
      existing,
      incoming,
      diff.deltas,
      new Set([addedIdx]),
    );

    const customer = merged.getObjectTypeByName("Customer")!;
    expect(customer.aliases).toEqual(["Client", "Account"]);
  });

  it("deduplicates when unioning overlapping aliases", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client", "Buyer"],
      })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", {
        referenceMode: "customer_id",
        aliases: ["Client", "Account"],
      })
      .build();

    const diff = diffModels(existing, incoming);
    const modIdx = diff.deltas.findIndex(
      (d) => d.name === "Customer" && d.kind === "modified",
    );

    const merged = mergeModels(
      existing,
      incoming,
      diff.deltas,
      new Set([modIdx]),
    );

    const customer = merged.getObjectTypeByName("Customer")!;
    const aliases = customer.aliases!;
    // All three unique aliases should be present.
    expect(aliases).toContain("Client");
    expect(aliases).toContain("Buyer");
    expect(aliases).toContain("Account");
    expect(aliases).toHaveLength(3);
  });

  it("takes incoming dataType when accepting modification", () => {
    const existing = new ModelBuilder("Test")
      .withValueType("Code", { dataType: { name: "text" } })
      .build();
    const incoming = new ModelBuilder("Test")
      .withValueType("Code", { dataType: { name: "text", length: 10 } })
      .build();

    const diff = diffModels(existing, incoming);
    const modifiedIdx = diff.deltas.findIndex(
      (d) => d.name === "Code" && d.kind === "modified",
    );
    expect(modifiedIdx).toBeGreaterThanOrEqual(0);

    const merged = mergeModels(existing, incoming, diff.deltas, new Set([modifiedIdx]));
    const code = merged.getObjectTypeByName("Code")!;
    expect(code.dataType).toBeDefined();
    expect(code.dataType!.length).toBe(10);
  });

  it("preserves independent, defaultValue, note and cardinality on unchanged object types", () => {
    const existing = new OrmModel({ name: "Test" });
    existing.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      independent: true,
      note: "a note on Customer",
      cardinality: { min: 1, max: 100 },
    });
    existing.addObjectType({
      name: "Amount",
      kind: "value",
      dataType: { name: "money" },
      defaultValue: "0",
    });

    const incoming = new OrmModel({ name: "Test" });
    incoming.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      independent: true,
      note: "a note on Customer",
      cardinality: { min: 1, max: 100 },
    });
    incoming.addObjectType({
      name: "Amount",
      kind: "value",
      dataType: { name: "money" },
      defaultValue: "0",
    });

    const diff = diffModels(existing, incoming);
    const merged = mergeModels(existing, incoming, diff.deltas, new Set());

    const customer = merged.getObjectTypeByName("Customer")!;
    expect(customer.independent).toBe(true);
    expect(customer.note).toBe("a note on Customer");
    expect(customer.cardinality).toEqual({ min: 1, max: 100 });

    const amount = merged.getObjectTypeByName("Amount")!;
    expect(amount.defaultValue).toBe("0");
  });

  // The user-visible half of barwise-927/-934 together: barwise-927 taught
  // the merge to carry an existing element's note forward, which made an
  // INCOMING note unreachable while the diff still called the pair
  // unchanged. With both fixed the edit is a delta an operator can accept.
  it("adopts an incoming note on an accepted object-type modification", () => {
    const make = (note: string) => {
      const m = new OrmModel({ name: "Test" });
      m.addObjectType({ name: "Customer", kind: "entity", referenceMode: "customer_id", note });
      return m;
    };
    const existing = make("the old note");
    const incoming = make("the new note");

    const diff = diffModels(existing, incoming);
    const modifiedIdx = diff.deltas.findIndex(
      (d) => d.kind === "modified" && d.name === "Customer",
    );
    expect(modifiedIdx).toBeGreaterThanOrEqual(0);

    const merged = mergeModels(existing, incoming, diff.deltas, new Set([modifiedIdx]));
    expect(merged.getObjectTypeByName("Customer")!.note).toBe("the new note");
  });

  it("preserves note and derivation on unchanged fact types", () => {
    const existing = new OrmModel({ name: "Test" });
    const existingCustomer = existing.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const existingOrder = existing.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });
    existing.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: existingCustomer.id },
        { name: "is placed by", playerId: existingOrder.id },
      ],
      readings: ["{0} places {1}"],
      note: "a note on the fact type",
      derivation: { kind: "derived", expression: "Customer places Order if ..." },
    });

    const incoming = new OrmModel({ name: "Test" });
    const incomingCustomer = incoming.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const incomingOrder = incoming.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
    });
    incoming.addFactType({
      name: "Customer places Order",
      roles: [
        { name: "places", playerId: incomingCustomer.id },
        { name: "is placed by", playerId: incomingOrder.id },
      ],
      readings: ["{0} places {1}"],
      note: "a note on the fact type",
      derivation: { kind: "derived", expression: "Customer places Order if ..." },
    });

    const diff = diffModels(existing, incoming);
    const merged = mergeModels(existing, incoming, diff.deltas, new Set());

    const ft = merged.getFactTypeByName("Customer places Order")!;
    expect(ft.note).toBe("a note on the fact type");
    expect(ft.derivation).toEqual({
      kind: "derived",
      expression: "Customer places Order if ...",
    });
  });

  it("remaps a join constraint's path root to the merged object-type id", () => {
    // The existing model already has Person and Country (their ids win in
    // the merge); the incoming model brings the same object types under
    // different ids plus two fact types and a join equality whose operand
    // paths are rooted at the INCOMING Person id. Accepting the added
    // fact types must rewrite each operand root to the merged Person id.
    // Role ids are preserved by the merge, so the steps pass through.
    const existing = new OrmModel({ name: "Test" });
    const existingPerson = existing.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    existing.addObjectType({
      name: "Country",
      kind: "entity",
      referenceMode: "country_name",
    });

    const incoming = new OrmModel({ name: "Test" });
    const person = incoming.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const country = incoming.addObjectType({
      name: "Country",
      kind: "entity",
      referenceMode: "country_name",
    });
    incoming.addFactType({
      name: "Person was born in Country",
      roles: [
        { name: "born", playerId: person.id, id: "r-born-person" },
        { name: "birthplace of", playerId: country.id, id: "r-born-country" },
      ],
      readings: ["{0} was born in {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r-born-person"] },
        {
          type: "join_equality",
          operands: [
            {
              path: {
                root: person.id,
                steps: [{ entry: "r-born-person", exit: "r-born-country" }],
              },
              projection: [0, 1],
            },
            {
              path: {
                root: person.id,
                steps: [{ entry: "r-citizen-person", exit: "r-citizen-country" }],
              },
              projection: [0, 1],
            },
          ],
        },
      ],
    });
    incoming.addFactType({
      name: "Person is a citizen of Country",
      roles: [
        { name: "citizen", playerId: person.id, id: "r-citizen-person" },
        { name: "grants citizenship to", playerId: country.id, id: "r-citizen-country" },
      ],
      readings: ["{0} is a citizen of {1}"],
      constraints: [
        { type: "internal_uniqueness", roleIds: ["r-citizen-person", "r-citizen-country"] },
      ],
    });

    const diff = diffModels(existing, incoming);
    const accepted = new Set(
      diff.deltas
        .map((d, i) => [d, i] as const)
        .filter(([d]) => d.kind === "added")
        .map(([, i]) => i),
    );
    const merged = mergeModels(existing, incoming, diff.deltas, accepted);

    const bornIn = merged.getFactTypeByName("Person was born in Country")!;
    const join = bornIn.constraints.find((c) => c.type === "join_equality");
    expect(join).toBeDefined();
    if (join?.type !== "join_equality") throw new Error("unreachable");

    for (const operand of join.operands) {
      expect(operand.path.root).toBe(existingPerson.id);
      expect(operand.path.root).not.toBe(person.id);
    }
    // Role ids inside the steps pass through unchanged.
    expect(join.operands[0]!.path.steps).toEqual([
      { entry: "r-born-person", exit: "r-born-country" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Post-merge validation tests (Stage 5)
// ---------------------------------------------------------------------------

describe("mergeAndValidate", () => {
  it("returns valid result when merge produces no structural errors", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const diff = diffModels(existing, incoming);
    const addedIdx = diff.deltas.findIndex(
      (d) => d.kind === "added" && d.name === "Order",
    );
    const result = mergeAndValidate(
      existing,
      incoming,
      diff.deltas,
      new Set([addedIdx]),
    );

    expect(result.isValid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
    expect(result.model).toBeDefined();
    expect(result.model!.objectTypes.map((o) => o.name).sort()).toEqual(
      ["Customer", "Order"],
    );
  });

  it("reports error when removing entity type breaks a kept fact type", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    // Incoming has no Customer and no fact type.
    const incoming = new ModelBuilder("Test")
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const diff = diffModels(existing, incoming);

    // Accept removal of Customer but NOT removal of the fact type.
    const removeOtIdx = diff.deltas.findIndex(
      (d) => d.kind === "removed" && d.name === "Customer",
    );
    expect(removeOtIdx).toBeGreaterThanOrEqual(0);

    const result = mergeAndValidate(
      existing,
      incoming,
      diff.deltas,
      new Set([removeOtIdx]),
    );

    expect(result.isValid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    // The error should mention the dangling reference.
    expect(result.diagnostics.some((e) => e.severity === "error")).toBe(true);
  });

  it("validates structural integrity via getStructuralErrors", () => {
    // A valid model should produce no errors.
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const errors = getStructuralErrors(model);
    expect(errors).toHaveLength(0);
  });

  it("returns isValid true when errors array is empty", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const diff = diffModels(existing, incoming);
    const result = mergeAndValidate(
      existing,
      incoming,
      diff.deltas,
      new Set(),
    );

    expect(result.isValid).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });

  it("returns isValid false when diagnostics array is non-empty", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const incoming = new ModelBuilder("Test")
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const diff = diffModels(existing, incoming);
    const removeIdx = diff.deltas.findIndex(
      (d) => d.kind === "removed" && d.name === "Customer",
    );

    const result = mergeAndValidate(
      existing,
      incoming,
      diff.deltas,
      new Set([removeIdx]),
    );

    expect(result.isValid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });

  it("mergeModels still returns OrmModel directly (unchanged API)", () => {
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();
    const incoming = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .build();

    const diff = diffModels(existing, incoming);
    const merged = mergeModels(existing, incoming, diff.deltas, new Set());

    // mergeModels returns OrmModel, not MergeValidationResult.
    expect(merged.objectTypes).toBeDefined();
    expect(merged.name).toBe("Test");
  });

  it("model is null when merge throws due to structural error", () => {
    // When mergeModels throws (e.g. addFactType rejects dangling player),
    // mergeAndValidate should capture the error rather than crashing.
    const existing = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withEntityType("Order", { referenceMode: "order_number" })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
      })
      .build();

    const incoming = new ModelBuilder("Test")
      .withEntityType("Order", { referenceMode: "order_number" })
      .build();

    const diff = diffModels(existing, incoming);
    const removeIdx = diff.deltas.findIndex(
      (d) => d.kind === "removed" && d.name === "Customer",
    );

    const result = mergeAndValidate(
      existing,
      incoming,
      diff.deltas,
      new Set([removeIdx]),
    );

    // Should not throw -- diagnostics are captured in the result.
    expect(result.isValid).toBe(false);
    expect(result.diagnostics.length).toBeGreaterThan(0);
  });
});
