/**
 * Tests for aliases serialization round-trip.
 *
 * Verifies that the `aliases` property on object types survives
 * serialize -> deserialize without loss, and that models without
 * aliases produce clean YAML output (no empty `aliases:` key).
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

describe("Aliases serialization", () => {
  const serializer = new OrmYamlSerializer();

  it("round-trips aliases on an entity type", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      aliases: ["Client", "Account"],
    });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    const ot = restored.getObjectTypeByName("Customer")!;
    expect(ot.aliases).toEqual(["Client", "Account"]);
  });

  it("round-trips aliases on a value type", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Rating",
      kind: "value",
      aliases: ["Grade", "Score"],
    });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    const ot = restored.getObjectTypeByName("Rating")!;
    expect(ot.aliases).toEqual(["Grade", "Score"]);
  });

  it("omits aliases key when not present", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });

    const yaml = serializer.serialize(model);
    expect(yaml).not.toContain("aliases");

    const restored = serializer.deserialize(yaml);
    // `[]`, not `undefined`: the record applies the default. The
    // assertion that matters is the one above -- the key is absent from
    // the file.
    expect(restored.getObjectTypeByName("Customer")!.aliases).toEqual([]);
  });

  it("round-trips mixed model with some OTs having aliases and some not", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      aliases: ["Client"],
    });
    model.addObjectType({
      name: "Order",
      kind: "entity",
      referenceMode: "order_number",
      // No aliases.
    });
    model.addObjectType({
      name: "Name",
      kind: "value",
      aliases: ["FullName", "DisplayName"],
    });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    expect(restored.getObjectTypeByName("Customer")!.aliases).toEqual(["Client"]);
    expect(restored.getObjectTypeByName("Order")!.aliases).toEqual([]);
    expect(restored.getObjectTypeByName("Name")!.aliases).toEqual(["FullName", "DisplayName"]);
  });

  it("serializes aliases as a YAML list", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      aliases: ["Client", "Account"],
    });

    const yaml = serializer.serialize(model);
    expect(yaml).toContain("aliases:");
    expect(yaml).toContain("- Client");
    expect(yaml).toContain("- Account");
  });

  it("preserves alias order through round-trip", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      aliases: ["Buyer", "Account", "Client"],
    });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    expect(restored.getObjectTypeByName("Customer")!.aliases).toEqual([
      "Buyer",
      "Account",
      "Client",
    ]);
  });
});
