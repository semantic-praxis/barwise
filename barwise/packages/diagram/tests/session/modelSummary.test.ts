/**
 * Tests for the model summary the presentation contract carries to the
 * webview tree and inspector (diagram-ui-modernization, Phase 2).
 */
import { describe, expect, it } from "vitest";
import { ModelBuilder } from "../../../core/tests/helpers/ModelBuilder.js";
import { buildModelSummary } from "../../src/session/modelSummary.js";

function orderModel() {
  return new ModelBuilder("Orders")
    .withEntityType("Customer", { referenceMode: "customer_id" })
    .withEntityType("Order", { referenceMode: "order_number" })
    .withValueType("OrderDate")
    .withBinaryFactType("Customer places Order", {
      role1: { player: "Customer", name: "places" },
      role2: { player: "Order", name: "is placed by" },
      uniqueness: "role2",
      mandatory: "role2",
    })
    .withBinaryFactType("Order was placed on OrderDate", {
      role1: { player: "Order", name: "was placed on" },
      role2: { player: "OrderDate", name: "is of" },
      uniqueness: "role1",
    })
    .build();
}

describe("buildModelSummary", () => {
  const model = orderModel();
  const summary = buildModelSummary(model);

  it("summarizes object types with kind, reference mode, and played fact types", () => {
    expect(summary.objectTypes.map((ot) => ot.name)).toEqual([
      "Customer",
      "Order",
      "OrderDate",
    ]);

    const customer = summary.objectTypes.find((ot) => ot.name === "Customer")!;
    expect(customer.kind).toBe("entity");
    expect(customer.referenceMode).toBe("customer_id");
    expect(customer.factTypeIds).toHaveLength(1);

    const order = summary.objectTypes.find((ot) => ot.name === "Order")!;
    expect(order.factTypeIds).toHaveLength(2);
  });

  it("summarizes fact types with resolved roles and constraint tags", () => {
    const places = summary.factTypes.find((ft) => ft.name === "Customer places Order")!;
    expect(places.roles.map((r) => r.playerName)).toEqual(["Customer", "Order"]);
    expect(places.constraints.map((c) => c.type)).toContain("internal_uniqueness");
    expect(places.constraints.map((c) => c.type)).toContain("mandatory");
  });

  it("substitutes player names into reading templates", () => {
    const places = summary.factTypes.find((ft) => ft.name === "Customer places Order")!;
    expect(places.readings.some((r) => r.includes("Customer") && r.includes("Order"))).toBe(
      true,
    );
    expect(places.readings.every((r) => !r.includes("{0}"))).toBe(true);
  });

  it("summarizes subtype links with resolved names", () => {
    const withSubtype = new ModelBuilder("Sub")
      .withEntityType("Party", { referenceMode: "party_id" })
      .withEntityType("Person", { referenceMode: "party_id" })
      .withSubtypeFact("Person", "Party")
      .build();

    const s = buildModelSummary(withSubtype);
    expect(s.subtypes).toHaveLength(1);
    expect(s.subtypes[0]!.subtypeName).toBe("Person");
    expect(s.subtypes[0]!.supertypeName).toBe("Party");
  });
});
