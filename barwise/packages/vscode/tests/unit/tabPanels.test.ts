/**
 * Tests for the diagram webview's tab-panel content builder
 * (modernization Phase 3): thin views over core's verbalizer,
 * serializer, DDL exporter, and populations. Pure module -- no VS Code
 * runtime needed.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { buildTabPanels } from "../../src/diagram/tabPanels.js";

function orderModel(): OrmModel {
  const model = new OrmModel({ name: "Orders" });
  const customer = model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  const order = model.addObjectType({
    name: "Order",
    kind: "entity",
    referenceMode: "order_number",
  });
  const ft = model.addFactType({
    name: "Customer places Order",
    roles: [
      { name: "places", playerId: customer.id },
      { name: "is placed by", playerId: order.id },
    ],
    readings: ["{0} places {1}"],
  });
  ft.addConstraint({ type: "internal_uniqueness", roleIds: [ft.roles[1]!.id] });
  return model;
}

describe("buildTabPanels", () => {
  const model = orderModel();
  const panels = buildTabPanels(model);

  it("verbalizes the model into FORML sentences", () => {
    expect(panels.verbalization.length).toBeGreaterThan(0);
    expect(panels.verbalization.join("\n")).toContain("Customer");
  });

  it("numbers statements only, leaving out a section heading", () => {
    // The tab renders an <ol>; a heading row there would read as a
    // numbered statement (orm-format-3 WS3a-ii).
    const spanning = orderModel();
    const [places] = spanning.factTypes;
    const ships = spanning.addFactType({
      name: "Customer ships Order",
      roles: [
        { name: "ships", playerId: places!.roles[0]!.playerId },
        { name: "is shipped by", playerId: places!.roles[1]!.playerId },
      ],
      readings: ["{0} ships {1}"],
    });
    places!.addConstraint({
      type: "exclusion",
      roleIds: [places!.roles[0]!.id, ships.roles[0]!.id],
    });
    const lines = buildTabPanels(spanning).verbalization;
    expect(lines.some((l) => l.startsWith("No Customer both"))).toBe(true);
    expect(lines).not.toContain("Constraints across fact types");
  });

  it("serializes the model to YAML", () => {
    expect(panels.yaml).toContain("orm_version");
    expect(panels.yaml).toContain("Customer places Order");
  });

  it("exports DDL through the format registry", () => {
    expect(panels.ddl.toUpperCase()).toContain("CREATE TABLE");
  });

  it("renders populations as tables keyed by fact type", () => {
    const ft = model.factTypes[0]!;
    model.addPopulation({
      factTypeId: ft.id,
      instances: [{
        roleValues: {
          [ft.roles[0]!.id]: "Alice",
          [ft.roles[1]!.id]: "PO-1",
        },
      }],
    });
    const withPop = buildTabPanels(model);
    expect(withPop.populations).toHaveLength(1);
    expect(withPop.populations[0]!.factTypeName).toBe("Customer places Order");
    expect(withPop.populations[0]!.columns).toEqual(["Customer", "Order"]);
    expect(withPop.populations[0]!.rows).toEqual([["Alice", "PO-1"]]);
  });

  it("is safe on an empty model", () => {
    const empty = buildTabPanels(new OrmModel({ name: "Empty" }));
    expect(empty.verbalization).toEqual([]);
    expect(empty.populations).toEqual([]);
    expect(typeof empty.yaml).toBe("string");
    expect(typeof empty.ddl).toBe("string");
  });
});
