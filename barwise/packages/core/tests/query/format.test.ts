import { describe, expect, it } from "vitest";
import { formatQueryResult } from "../../src/query/format.js";
import { runQuery } from "../../src/query/index.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

const model = new ModelBuilder("Shop")
  .withEntityType("Customer", { referenceMode: "customer_id" })
  .withEntityType("Order", { referenceMode: "order_number" })
  .withEntityType("Product", { referenceMode: "sku" })
  .withBinaryFactType("Customer places Order", {
    role1: { player: "Customer", name: "places" },
    role2: { player: "Order", name: "is placed by" },
    uniqueness: "role2",
    mandatory: "role2",
  })
  .withBinaryFactType("Order contains Product", {
    role1: { player: "Order", name: "contains" },
    role2: { player: "Product", name: "is in" },
  })
  .build();

describe("formatQueryResult", () => {
  it("renders an entity list", () => {
    const text = formatQueryResult(runQuery(model, "entities"));
    expect(text).toContain("Object types (3)");
    expect(text).toContain("Customer");
  });

  it("renders a fact-type list", () => {
    const text = formatQueryResult(runQuery(model, "fact-types"));
    expect(text).toContain("Fact types (2)");
  });

  it("renders a constraint list", () => {
    const text = formatQueryResult(runQuery(model, "constraints"));
    expect(text).toContain("Constraints (2)");
  });

  it("renders entity detail with sections", () => {
    const text = formatQueryResult(runQuery(model, "entity Customer"));
    expect(text).toContain("Entity: Customer");
    expect(text).toContain("Fact types:");
    expect(text).toContain("Constraints:");
  });

  it("renders fact-type detail", () => {
    const text = formatQueryResult(runQuery(model, 'fact-type "Customer places Order"'));
    expect(text).toContain("Fact type: Customer places Order");
    expect(text).toContain("Arity: 2");
  });

  it("renders a found path", () => {
    const text = formatQueryResult(runQuery(model, "path Customer Product"));
    expect(text).toContain('Path from "Customer" to "Product"');
    expect(text).toContain("via");
  });

  it("renders model stats", () => {
    const text = formatQueryResult(runQuery(model, "stats"));
    expect(text).toContain("Model: Shop");
    expect(text).toContain("Fact types:");
  });

  it("renders a not-found message", () => {
    const text = formatQueryResult(runQuery(model, "entity Ghost"));
    expect(text).toContain("Ghost");
  });

  it("renders an empty role list without throwing", () => {
    const text = formatQueryResult(runQuery(model, "mandatory-roles Customer"));
    expect(text).toContain("Roles (0)");
  });
});
