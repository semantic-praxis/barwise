/**
 * Structural well-formedness tests for join constraints.
 *
 * The rule checks the declaration only: every step is a real hop, steps are
 * contiguous, the path starts at the root, and all operand paths share a
 * root and an endpoint type. Population satisfaction is a separate rule.
 */
import { describe, expect, it } from "vitest";
import type { Constraint, RolePath } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { joinConstraintRules } from "../../src/validation/rules/joinConstraintRules.js";

const bornIn: RolePath = {
  root: "ot-person",
  steps: [{ entry: "pb-person", exit: "pb-country" }],
};
const citizenOf: RolePath = {
  root: "ot-person",
  steps: [{ entry: "pc-person", exit: "pc-country" }],
};

function buildModel(constraint: Constraint): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const person = model.addObjectType({
    id: "ot-person",
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });
  const country = model.addObjectType({
    name: "Country",
    kind: "entity",
    referenceMode: "country_code",
  });
  model.addFactType({
    name: "Person was born in Country",
    roles: [
      { name: "was born in", playerId: person.id, id: "pb-person" },
      { name: "is birthplace of", playerId: country.id, id: "pb-country" },
    ],
    readings: ["{0} was born in {1}"],
  });
  model.addFactType({
    name: "Person is citizen of Country",
    roles: [
      { name: "is citizen of", playerId: person.id, id: "pc-person" },
      { name: "has citizen", playerId: country.id, id: "pc-country" },
    ],
    readings: ["{0} is citizen of {1}"],
    constraints: [constraint],
  });
  return model;
}

describe("joinConstraintRules", () => {
  it("accepts a well-formed join_equality", () => {
    const diags = joinConstraintRules(buildModel({
      type: "join_equality",
      paths: [bornIn, citizenOf],
    }));
    expect(diags).toHaveLength(0);
  });

  it("accepts a well-formed join_subset", () => {
    const diags = joinConstraintRules(buildModel({
      type: "join_subset",
      subset: bornIn,
      superset: citizenOf,
    }));
    expect(diags).toHaveLength(0);
  });

  it("flags an unknown root object type", () => {
    const diags = joinConstraintRules(buildModel({
      type: "join_equality",
      paths: [{ root: "ot-missing", steps: bornIn.steps }, citizenOf],
    }));
    expect(diags.some((d) => d.ruleId === "constraint/join-unknown-root")).toBe(true);
  });

  it("flags a step whose entry/exit are not roles of one fact type", () => {
    const diags = joinConstraintRules(buildModel({
      type: "join_equality",
      paths: [
        { root: "ot-person", steps: [{ entry: "pb-person", exit: "pc-country" }] },
        citizenOf,
      ],
    }));
    expect(diags.some((d) => d.ruleId === "constraint/join-bad-step")).toBe(true);
  });

  it("flags a discontiguous path (entry not played by the current node)", () => {
    // Start the path at the Country end of bornIn while rooted at Person.
    const diags = joinConstraintRules(buildModel({
      type: "join_equality",
      paths: [
        { root: "ot-person", steps: [{ entry: "pb-country", exit: "pb-person" }] },
        citizenOf,
      ],
    }));
    expect(diags.some((d) => d.ruleId === "constraint/join-discontiguous")).toBe(true);
  });

  it("flags fewer than two paths for join_equality", () => {
    const diags = joinConstraintRules(buildModel({
      type: "join_equality",
      paths: [bornIn],
    }));
    expect(diags.some((d) => d.ruleId === "constraint/join-too-few-paths")).toBe(true);
  });
});
