/**
 * Tests for derivation consistency rules.
 *
 * These check the declaration of a derivation, never its meaning:
 *   - A derived/semiderived element with blank rule text -> warning
 *   - A purely-derived (derive-on-request) fact type with a sample
 *     population -> warning (its facts are computed, not asserted)
 *   - Derived-and-stored and semiderived populations are accepted
 */
import { describe, expect, it } from "vitest";
import type { DerivationRule } from "../../src/model/FactType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { derivationRules } from "../../src/validation/rules/derivationRules.js";

function modelWithDerivedFactType(derivation: DerivationRule): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const order = model.addObjectType({
    name: "Order",
    kind: "entity",
    referenceMode: "order_id",
  });
  const total = model.addObjectType({ name: "TotalPrice", kind: "value" });
  model.addFactType({
    name: "Order has TotalPrice",
    roles: [
      { name: "has", playerId: order.id, id: "r1" },
      { name: "of", playerId: total.id, id: "r2" },
    ],
    readings: ["{0} has {1}"],
    derivation,
  });
  return model;
}

function populate(model: OrmModel): void {
  const ft = model.getFactTypeByName("Order has TotalPrice")!;
  const pop = model.addPopulation({ factTypeId: ft.id });
  pop.addInstance({ roleValues: { r1: "O1", r2: "10" } });
}

describe("derivationRules", () => {
  it("warns when a derived fact type has blank rule text", () => {
    const diags = derivationRules(modelWithDerivedFactType({ kind: "derived", expression: "  " }));
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("derivation/missing-rule");
    expect(diags[0]!.severity).toBe("warning");
  });

  it("does not warn when a derived fact type has rule text", () => {
    const diags = derivationRules(
      modelWithDerivedFactType({ kind: "derived", expression: "Quantity * UnitPrice" }),
    );
    expect(diags).toHaveLength(0);
  });

  it("warns when a purely-derived fact type carries a population", () => {
    const model = modelWithDerivedFactType({ kind: "derived", expression: "Quantity * UnitPrice" });
    populate(model);
    const diags = derivationRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("derivation/derived-with-population");
  });

  it("accepts a population on a derived-and-stored fact type", () => {
    const model = modelWithDerivedFactType({
      kind: "derived",
      storage: "derived_and_stored",
      expression: "Quantity * UnitPrice",
    });
    populate(model);
    expect(derivationRules(model)).toHaveLength(0);
  });

  it("accepts a population on a semiderived fact type", () => {
    const model = modelWithDerivedFactType({ kind: "semiderived", expression: "partial rule" });
    populate(model);
    expect(derivationRules(model)).toHaveLength(0);
  });

  it("warns when a subtype defining rule is blank", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const adult = model.addObjectType({
      name: "Adult",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addSubtypeFact({
      subtypeId: adult.id,
      supertypeId: person.id,
      definingRule: { kind: "derived", expression: "" },
    });

    const diags = derivationRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("derivation/missing-rule");
    expect(diags[0]!.message).toContain("Adult");
  });
});
