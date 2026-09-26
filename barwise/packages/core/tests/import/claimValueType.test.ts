/**
 * The value-type sharing rule both the dbt and DDL importers call
 * (ddl-import-fidelity.spec.md). A shared name must lose nothing: no
 * entity, no second fact type for the same entity, no type change.
 */
import { describe, expect, it } from "vitest";
import { claimValueTypeName } from "../../src/import/claimValueType.js";
import { OrmModel } from "../../src/model/OrmModel.js";

function setup() {
  const model = new OrmModel({ name: "Claim" });
  const customer = model.addObjectType({ name: "Customer", kind: "entity", referenceMode: "id" });
  const order = model.addObjectType({ name: "Order", kind: "entity", referenceMode: "id" });
  const name = model.addObjectType({
    name: "Name",
    kind: "value",
    dataType: { name: "text", length: 50 },
  });
  const untyped = model.addObjectType({ name: "Note", kind: "value" });
  model.addFactType({
    name: "Customer has Name",
    roles: [
      { name: "has", playerId: customer.id },
      { name: "is of", playerId: name.id },
    ],
    readings: ["{0} has {1}"],
  });
  return { model, customer, order, name, untyped };
}

describe("claimValueTypeName", () => {
  it("creates under the candidate name when nothing holds it", () => {
    const { model, order } = setup();
    expect(claimValueTypeName(model, order.id, "Order", "Total", { name: "decimal" }, "attribute"))
      .toEqual({ kind: "create", name: "Total" });
  });

  it("shares a value type with the same type that this entity does not play", () => {
    const { model, order, name } = setup();
    const text50 = { name: "text" as const, length: 50 };
    expect(claimValueTypeName(model, order.id, "Order", "Name", text50, "attribute"))
      .toEqual({ kind: "share", valueType: name });
    expect(claimValueTypeName(model, order.id, "Order", "Name", text50, "key"))
      .toEqual({ kind: "share", valueType: name });
  });

  it("does not share when the declared type differs", () => {
    const { model, order, name } = setup();
    expect(
      claimValueTypeName(
        model,
        order.id,
        "Order",
        "Name",
        { name: "text", length: 9 },
        "attribute",
      ),
    ).toEqual({ kind: "create", name: "OrderName", displaced: name });
  });

  it("lets an untyped attribute share, but never an untyped key", () => {
    const { model, order, name, untyped } = setup();
    expect(claimValueTypeName(model, order.id, "Order", "Name", undefined, "attribute"))
      .toEqual({ kind: "share", valueType: name });
    expect(claimValueTypeName(model, order.id, "Order", "Note", undefined, "key"))
      .toEqual({ kind: "create", name: "OrderNote", displaced: untyped });
  });

  it("does not share a value type this entity already plays, or an entity", () => {
    const { model, customer, order, name } = setup();
    const text50 = { name: "text" as const, length: 50 };
    expect(claimValueTypeName(model, customer.id, "Customer", "Name", text50, "attribute"))
      .toEqual({ kind: "create", name: "CustomerName", displaced: name });
    expect(claimValueTypeName(model, order.id, "Order", "Customer", undefined, "attribute").kind)
      .toBe("create");
  });

  it("numbers the fallback name when it is taken too", () => {
    const { model, order, name } = setup();
    model.addObjectType({ name: "OrderName", kind: "value" });
    expect(
      claimValueTypeName(model, order.id, "Order", "Name", { name: "integer" }, "attribute"),
    ).toEqual({ kind: "create", name: "OrderName2", displaced: name });
  });

  it("shares only when the value constraints admit the same values", () => {
    // PR #572 review: a constraint is part of what a value type means.
    const { model, order } = setup();
    const status = model.addObjectType({
      name: "Status",
      kind: "value",
      dataType: { name: "text" },
      valueConstraint: { values: ["active", "closed"] },
    });
    const text = { name: "text" as const };
    const claim = (vc?: { values: string[]; }) =>
      claimValueTypeName(model, order.id, "Order", "Status", text, "attribute", vc);
    expect(claim({ values: ["closed", "active"] })).toEqual({ kind: "share", valueType: status });
    expect(claim({ values: ["pending"] })).toEqual({
      kind: "create",
      name: "OrderStatus",
      displaced: status,
    });
    expect(claim(undefined).kind).toBe("create");
  });

  it("does not let a constrained column share an unconstrained value type", () => {
    const { model, order, name } = setup();
    expect(
      claimValueTypeName(model, order.id, "Order", "Name", undefined, "attribute", {
        values: ["x"],
      }),
    ).toEqual({ kind: "create", name: "OrderName", displaced: name });
  });
});
