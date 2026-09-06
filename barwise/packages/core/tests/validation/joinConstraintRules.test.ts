/**
 * Structural well-formedness tests for join constraints.
 *
 * The rule checks the declaration only: every step is a real contiguous hop,
 * each projection index is a valid path node, and all operands project
 * tuples of the same arity and matching column object types. Population
 * satisfaction is a separate rule.
 */
import { describe, expect, it } from "vitest";
import type { Constraint, JoinOperand } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { joinConstraintRules } from "../../src/validation/rules/joinConstraintRules.js";

const bornIn: JoinOperand = {
  path: { root: "ot-person", steps: [{ entry: "pb-person", exit: "pb-country" }] },
  projection: [0, 1],
};
const citizenOf: JoinOperand = {
  path: { root: "ot-person", steps: [{ entry: "pc-person", exit: "pc-country" }] },
  projection: [0, 1],
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

const idsOf = (model: OrmModel) => joinConstraintRules(model).map((d) => d.ruleId);

describe("joinConstraintRules", () => {
  it("accepts a well-formed join_equality", () => {
    const model = buildModel({ type: "join_equality", operands: [bornIn, citizenOf] });
    expect(joinConstraintRules(model)).toHaveLength(0);
  });

  it("accepts a well-formed join_subset", () => {
    const model = buildModel({ type: "join_subset", subset: bornIn, superset: citizenOf });
    expect(joinConstraintRules(model)).toHaveLength(0);
  });

  it("flags an unknown root object type", () => {
    const bad: JoinOperand = {
      path: { root: "ot-missing", steps: bornIn.path.steps },
      projection: [0, 1],
    };
    expect(idsOf(buildModel({ type: "join_equality", operands: [bad, citizenOf] })))
      .toContain("constraint/join-unknown-root");
  });

  it("flags a step whose entry/exit are not roles of one fact type", () => {
    const bad: JoinOperand = {
      path: { root: "ot-person", steps: [{ entry: "pb-person", exit: "pc-country" }] },
      projection: [0, 1],
    };
    expect(idsOf(buildModel({ type: "join_equality", operands: [bad, citizenOf] })))
      .toContain("constraint/join-bad-step");
  });

  it("flags a discontiguous path", () => {
    const bad: JoinOperand = {
      path: { root: "ot-person", steps: [{ entry: "pb-country", exit: "pb-person" }] },
      projection: [0, 1],
    };
    expect(idsOf(buildModel({ type: "join_equality", operands: [bad, citizenOf] })))
      .toContain("constraint/join-discontiguous");
  });

  it("flags a projection index outside the path", () => {
    const bad: JoinOperand = { path: bornIn.path, projection: [0, 5] };
    expect(idsOf(buildModel({ type: "join_equality", operands: [bad, citizenOf] })))
      .toContain("constraint/join-bad-projection");
  });

  it("flags operands that project tuples of different arity", () => {
    const oneCol: JoinOperand = { path: citizenOf.path, projection: [1] };
    expect(idsOf(buildModel({ type: "join_equality", operands: [bornIn, oneCol] })))
      .toContain("constraint/join-arity-mismatch");
  });

  it("flags operands that project mismatched column object types", () => {
    // bornIn projects (Person, Country); this projects (Country, Person).
    const swapped: JoinOperand = { path: citizenOf.path, projection: [1, 0] };
    expect(idsOf(buildModel({ type: "join_equality", operands: [bornIn, swapped] })))
      .toContain("constraint/join-column-type-mismatch");
  });

  it("flags fewer than two operands for join_equality", () => {
    expect(idsOf(buildModel({ type: "join_equality", operands: [bornIn] })))
      .toContain("constraint/join-too-few-operands");
  });

  it("flags fewer than two operands for join_exclusion, naming it in the message", () => {
    const model = buildModel({ type: "join_exclusion", operands: [bornIn] });
    const diags = joinConstraintRules(model);
    const tooFew = diags.find((d) => d.ruleId === "constraint/join-too-few-operands");
    expect(tooFew).toBeDefined();
    expect(tooFew!.message).toContain("Join exclusion");
  });

  it("flags an operand with an empty projection", () => {
    const empty: JoinOperand = { path: bornIn.path, projection: [] };
    expect(idsOf(buildModel({ type: "join_equality", operands: [empty, citizenOf] })))
      .toContain("constraint/join-empty-projection");
  });

  it("falls back to the fact type id when a malformed join constraint has no id of its own", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      id: "ot-person",
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addObjectType({ name: "Country", kind: "entity", referenceMode: "country_code" });
    const ft = model.addFactType({
      name: "Person is citizen of Country",
      roles: [
        { name: "is citizen of", playerId: person.id, id: "pc-person" },
        { name: "has citizen", playerId: person.id, id: "pc-country" },
      ],
      readings: ["{0} is citizen of {1}"],
    });
    // addConstraint (unlike the fact-type constructor) does not backfill
    // a missing id.
    const bad: JoinOperand = { path: { root: "ot-missing", steps: [] }, projection: [0] };
    ft.addConstraint({ type: "join_equality", operands: [bad, citizenOf] });

    const diags = joinConstraintRules(model);
    const unknownRoot = diags.find((d) => d.ruleId === "constraint/join-unknown-root");
    expect(unknownRoot).toBeDefined();
    expect(unknownRoot!.elementId).toBe(ft.id);
  });
});
