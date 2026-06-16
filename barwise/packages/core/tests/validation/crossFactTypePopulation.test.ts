/**
 * Tests for cross-fact-type population validation (WS4a): mandatory and
 * disjunctive mandatory, checked against the object universe (the set of
 * values appearing in any role played by a type across all populations).
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

/** Customer is identified, and must place an Order (mandatory on the Customer role). */
function mandatoryModel(playsOrder: boolean): OrmModel {
  const model = new OrmModel({ name: "M" });
  const customer = model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  const customerId = model.addObjectType({ name: "CustomerId", kind: "value" });
  const order = model.addObjectType({
    name: "Order",
    kind: "entity",
    referenceMode: "order_number",
  });

  const idFt = model.addFactType({
    name: "Customer has CustomerId",
    roles: [
      { name: "has", playerId: customer.id, id: "id1" },
      { name: "identifies", playerId: customerId.id, id: "id2" },
    ],
    readings: ["{0} has {1}"],
  });
  const placesFt = model.addFactType({
    name: "Customer places Order",
    roles: [
      { name: "places", playerId: customer.id, id: "p1" },
      { name: "is placed by", playerId: order.id, id: "p2" },
    ],
    readings: ["{0} places {1}"],
    constraints: [{ type: "mandatory", roleId: "p1" }],
  });

  // Customer C1 exists (plays the identifier role).
  model.addPopulation({ factTypeId: idFt.id }).addInstance({
    roleValues: { id1: "C1", id2: "CID1" },
  });
  if (playsOrder) {
    model.addPopulation({ factTypeId: placesFt.id }).addInstance({
      roleValues: { p1: "C1", p2: "O1" },
    });
  }
  return model;
}

/** Person must have a home OR mobile phone (disjunctive mandatory spanning two fact types). */
function disjunctiveModel(hasPhone: boolean): OrmModel {
  const model = new OrmModel({ name: "M" });
  const person = model.addObjectType({
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });
  const personId = model.addObjectType({ name: "PersonId", kind: "value" });
  const phone = model.addObjectType({ name: "Phone", kind: "value" });

  const idFt = model.addFactType({
    name: "Person has PersonId",
    roles: [
      { name: "has", playerId: person.id, id: "pid1" },
      { name: "identifies", playerId: personId.id, id: "pid2" },
    ],
    readings: ["{0} has {1}"],
  });
  const homeFt = model.addFactType({
    name: "Person has HomePhone",
    roles: [
      { name: "has", playerId: person.id, id: "h1" },
      { name: "is home of", playerId: phone.id, id: "h2" },
    ],
    readings: ["{0} has home {1}"],
  });
  model.addFactType({
    name: "Person has MobilePhone",
    roles: [
      { name: "has", playerId: person.id, id: "m1" },
      { name: "is mobile of", playerId: phone.id, id: "m2" },
    ],
    readings: ["{0} has mobile {1}"],
  });
  // Attach the spanning constraint after both phone fact types exist.
  homeFt.addConstraint({ type: "disjunctive_mandatory", roleIds: ["h1", "m1"] });

  model.addPopulation({ factTypeId: idFt.id }).addInstance({
    roleValues: { pid1: "P1", pid2: "PID1" },
  });
  if (hasPhone) {
    model.addPopulation({ factTypeId: homeFt.id }).addInstance({
      roleValues: { h1: "P1", h2: "555-1234" },
    });
  }
  return model;
}

describe("cross-fact-type population validation: mandatory", () => {
  it("flags an instance that does not play a mandatory role", () => {
    const diags = populationValidationRules(mandatoryModel(false));
    expect(diags.some((d) => d.ruleId === "population/mandatory-violation")).toBe(true);
  });

  it("passes when every instance plays the mandatory role", () => {
    const diags = populationValidationRules(mandatoryModel(true));
    expect(diags.some((d) => d.ruleId === "population/mandatory-violation")).toBe(false);
  });
});

describe("cross-fact-type population validation: disjunctive mandatory", () => {
  it("flags an instance that plays none of the disjunctive roles", () => {
    const diags = populationValidationRules(disjunctiveModel(false));
    expect(
      diags.some((d) => d.ruleId === "population/disjunctive-mandatory-violation"),
    ).toBe(true);
  });

  it("passes when the instance plays at least one of the roles", () => {
    const diags = populationValidationRules(disjunctiveModel(true));
    expect(
      diags.some((d) => d.ruleId === "population/disjunctive-mandatory-violation"),
    ).toBe(false);
  });
});
