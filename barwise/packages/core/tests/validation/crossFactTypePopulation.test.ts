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

/**
 * Subtype existence witnessing
 * (docs/specs/mandatory-existence-witness.spec.md): a value recorded in
 * a subtype's role exists as the supertype too, when the subtype shares
 * the supertype's identification scheme.
 */
function subtypeWitnessModel(providesIdentification: boolean): OrmModel {
  const model = new OrmModel({ name: "M" });
  const employee = model.addObjectType({
    name: "Employee",
    kind: "entity",
    referenceMode: "employee_id",
  });
  // The entity constructor requires a reference mode either way; what
  // decides whether the value spaces are shared is the subtype fact's
  // providesIdentification flag, not the mode's presence.
  const manager = model.addObjectType({
    name: "Manager",
    kind: "entity",
    referenceMode: "manager_id",
  });
  const department = model.addObjectType({
    name: "Department",
    kind: "entity",
    referenceMode: "department_code",
  });
  model.addSubtypeFact({
    subtypeId: manager.id,
    supertypeId: employee.id,
    providesIdentification,
  });
  const managesFt = model.addFactType({
    name: "Manager manages Department",
    roles: [
      { name: "manages", playerId: manager.id, id: "m1" },
      { name: "is managed by", playerId: department.id, id: "m2" },
    ],
    readings: ["{0} manages {1}"],
  });
  model.addFactType({
    name: "Employee works in Department",
    roles: [
      { name: "works in", playerId: employee.id, id: "w1" },
      { name: "has", playerId: department.id, id: "w2" },
    ],
    readings: ["{0} works in {1}"],
    constraints: [{ type: "mandatory", roleId: "w1" }],
  });
  // Manager E1 exists -- only through the Manager role.
  model.addPopulation({ factTypeId: managesFt.id }).addInstance({
    roleValues: { m1: "E1", m2: "D1" },
  });
  return model;
}

describe("subtype instances witness supertype existence", () => {
  it("flags a Manager who works in no department, through the Employee mandatory", () => {
    const diags = populationValidationRules(subtypeWitnessModel(true));
    expect(diags.some((d) => d.ruleId === "population/mandatory-violation")).toBe(true);
  });

  it("does not conduct across a subtype link with an independent identifier", () => {
    // providesIdentification: false means Manager and Employee values
    // live in different spaces; crediting "E1" to Employee would assert
    // an identity nothing established.
    const diags = populationValidationRules(subtypeWitnessModel(false));
    expect(diags.some((d) => d.ruleId === "population/mandatory-violation")).toBe(false);
  });
});
