/**
 * Tests for the model summary the presentation contract carries to the
 * webview tree and inspector (diagram-ui-modernization, Phase 2).
 */
import { OrmModel } from "@barwise/core";
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

  it("renders a data type label for length-only and length+scale value types", () => {
    const withDataTypes = new ModelBuilder("Catalog")
      .withEntityType("Product", { referenceMode: "product_id" })
      .withValueType("Sku", { dataType: { name: "text", length: 12 } })
      .withValueType("Price", { dataType: { name: "decimal", length: 10, scale: 2 } })
      .withValueType("InStock", { dataType: { name: "boolean" } })
      .withBinaryFactType("Product has Sku", {
        role1: { player: "Product", name: "has" },
        role2: { player: "Sku", name: "identifies" },
        uniqueness: "role1",
      })
      .build();

    const s = buildModelSummary(withDataTypes);
    expect(s.objectTypes.find((ot) => ot.name === "Sku")!.dataType).toBe("text(12)");
    expect(s.objectTypes.find((ot) => ot.name === "Price")!.dataType).toBe("decimal(10,2)");
    expect(s.objectTypes.find((ot) => ot.name === "InStock")!.dataType).toBe("boolean");
  });

  it("omits aliases when the list is present but empty", () => {
    const withEmptyAliases = new ModelBuilder("Aliased")
      .withEntityType("Widget", { referenceMode: "widget_id", aliases: [] })
      .build();

    const s = buildModelSummary(withEmptyAliases);
    expect(s.objectTypes[0]!.aliases).toBeUndefined();
  });

  it("includes aliases when the list is non-empty", () => {
    const withAliases = new ModelBuilder("Aliased")
      .withEntityType("Widget", { referenceMode: "widget_id", aliases: ["Gadget", "Gizmo"] })
      .build();

    const s = buildModelSummary(withAliases);
    expect(s.objectTypes[0]!.aliases).toEqual(["Gadget", "Gizmo"]);
  });

  it("falls back to the raw id when a role player or subtype link is unresolved", () => {
    // OrmModel.addFactType/addSubtypeFact always validate reading templates
    // against role count, so renderReading's own `?? match` fallback (an
    // out-of-range placeholder) cannot be reached through any public
    // construction path with a valid role count -- see the final report.
    const model = new OrmModel({ name: "Fragment" });
    const customer = model.addObjectType({ name: "Customer", kind: "value" });
    model.addFactType(
      {
        name: "Customer places Order",
        roles: [
          { name: "places", playerId: customer.id },
          { name: "is placed by", playerId: "missing-order-type" },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
      },
      { skipPlayerValidation: true },
    );
    model.addSubtypeFact(
      { subtypeId: "missing-subtype", supertypeId: "missing-supertype" },
      { skipPlayerValidation: true },
    );

    const s = buildModelSummary(model);
    const places = s.factTypes.find((ft) => ft.name === "Customer places Order")!;
    expect(places.roles[1]!.playerName).toBe("missing-order-type");
    expect(s.subtypes[0]!.subtypeName).toBe("missing-subtype");
    expect(s.subtypes[0]!.supertypeName).toBe("missing-supertype");
  });
});
