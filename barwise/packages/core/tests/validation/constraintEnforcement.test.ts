/**
 * Tests for `evaluateConstraintEnforcement` (barwise-904).
 *
 * The point of the predicate is that it answers for ONE constraint, so the
 * tests that matter are the ones a model-wide `validate()` could not pass:
 * two constraints in one model, one violated and one not, told apart; and a
 * kind the predicate does not cover reported as unanswered rather than as
 * satisfied.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import type { FactType } from "../../src/model/FactType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { evaluateConstraintEnforcement } from "../../src/validation/constraintEnforcement.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

/** The rule ids the predicate's seven kinds can produce. */
const COVERED_RULE_IDS = new Set([
  "population/uniqueness-violation",
  "population/external-uniqueness-violation",
  "population/mandatory-violation",
  "population/disjunctive-mandatory-violation",
  "population/value-constraint-violation",
  "population/frequency-violation",
  "population/ring-violation",
]);

/**
 * "Customer places Order", with an internal uniqueness constraint on each
 * role. Only the r2 one is violated by the population below, so a caller
 * that asks about r1 must be told "satisfied" while the model as a whole is
 * invalid.
 */
function twoUniquenessModel(): OrmModel {
  const model = new OrmModel({ name: "Two" });
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
      { name: "places", playerId: customer.id, id: "r1" },
      { name: "is placed by", playerId: order.id, id: "r2" },
    ],
    readings: ["{0} places {1}"],
    constraints: [
      { type: "internal_uniqueness", roleIds: ["r1"], id: "uc-r1" },
      { type: "internal_uniqueness", roleIds: ["r2"], id: "uc-r2" },
    ],
  });
  const pop = model.addPopulation({ factTypeId: ft.id });
  // Distinct customers, duplicated order: r2 is violated, r1 is not.
  pop.addInstance({ id: "i1", roleValues: { r1: "C001", r2: "O1" } });
  pop.addInstance({ id: "i2", roleValues: { r1: "C002", r2: "O1" } });
  return model;
}

function constraintById(ft: FactType, id: string): Constraint {
  const c = ft.constraints.find((x) => x.id === id);
  if (!c) throw new Error(`no constraint ${id}`);
  return c;
}

describe("evaluateConstraintEnforcement", () => {
  it("distinguishes a violated constraint from a satisfied one in the same model", () => {
    const model = twoUniquenessModel();
    const ft = model.getFactTypeByName("Customer places Order")!;

    // The model-wide sweep reports one violation and cannot say which
    // constraint owns it -- both diagnostics would carry the population id.
    expect(populationValidationRules(model)).toHaveLength(1);

    const violated = evaluateConstraintEnforcement(model, ft, constraintById(ft, "uc-r2"));
    const satisfied = evaluateConstraintEnforcement(model, ft, constraintById(ft, "uc-r1"));

    expect(violated).toEqual({
      enforced: true,
      rejects: true,
      diagnostics: [expect.objectContaining({ ruleId: "population/uniqueness-violation" })],
    });
    expect(satisfied).toEqual({ enforced: true, rejects: false, diagnostics: [] });
  });

  it("reports `enforced: false` for a kind it has no per-constraint form for", () => {
    const model = twoUniquenessModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    ft.addConstraint({
      type: "subset",
      id: "sub-1",
      subsetRoleIds: ["r1"],
      supersetRoleIds: ["r2"],
    });
    const subset = constraintById(ft, "sub-1");

    const verdict = evaluateConstraintEnforcement(model, ft, subset);
    // Not `rejects: false`: nothing here asked the question, and a caller
    // that read a bare boolean would record a pass it never measured.
    expect(verdict).toEqual({ enforced: false });
    expect("rejects" in verdict).toBe(false);
  });

  it("does not report violations belonging to another constraint of the same kind", () => {
    const model = twoUniquenessModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const verdict = evaluateConstraintEnforcement(model, ft, constraintById(ft, "uc-r1"));
    if (!verdict.enforced) throw new Error("expected enforced");
    expect(verdict.diagnostics).toEqual([]);
  });

  it("answers per population, not per fact type, when a fact type has two", () => {
    const model = twoUniquenessModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    // A second, clean population of the same fact type must not mask the
    // first one's violation, nor add one of its own.
    const clean = model.addPopulation({ factTypeId: ft.id });
    clean.addInstance({ id: "j1", roleValues: { r1: "C003", r2: "O2" } });

    const violated = evaluateConstraintEnforcement(model, ft, constraintById(ft, "uc-r2"));
    if (!violated.enforced) throw new Error("expected enforced");
    expect(violated.diagnostics).toHaveLength(1);
  });
});

describe("evaluateConstraintEnforcement agrees with the model-wide sweep", () => {
  /**
   * The predicate and `populationValidationRules` share their inner helpers
   * precisely so they cannot answer differently. This asserts it rather than
   * trusting it: over every constraint in the model, the diagnostics the
   * predicate collects must be exactly the sweep's, for the rule ids it
   * covers. Only the order differs, which is why both sides are sorted.
   */
  function assertAgrees(model: OrmModel): void {
    const fromPredicate: string[] = [];
    for (const ft of model.factTypes) {
      for (const c of ft.constraints) {
        const verdict = evaluateConstraintEnforcement(model, ft, c);
        if (!verdict.enforced) continue;
        for (const d of verdict.diagnostics) {
          fromPredicate.push(`${d.severity}|${d.ruleId}|${d.elementId}|${d.message}`);
        }
      }
    }
    const fromSweep = populationValidationRules(model)
      .filter((d) => COVERED_RULE_IDS.has(d.ruleId))
      .map((d) => `${d.severity}|${d.ruleId}|${d.elementId}|${d.message}`);

    expect(fromPredicate.sort()).toEqual(fromSweep.sort());
  }

  it("agrees on a model with a uniqueness violation", () => {
    assertAgrees(twoUniquenessModel());
  });

  it("agrees on a model with violations of five kinds at once", () => {
    const model = new OrmModel({ name: "Many" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const personId = model.addObjectType({ name: "PersonId", kind: "value" });
    const status = model.addObjectType({ name: "Status", kind: "value" });

    const idFt = model.addFactType({
      name: "Person has PersonId",
      roles: [
        { name: "has", playerId: person.id, id: "id1" },
        { name: "identifies", playerId: personId.id, id: "id2" },
      ],
      readings: ["{0} has {1}"],
    });
    // Mandatory on a role nobody plays, plus a value constraint and a
    // frequency constraint the population breaks.
    const statusFt = model.addFactType({
      name: "Person has Status",
      roles: [
        { name: "has", playerId: person.id, id: "s1" },
        { name: "is of", playerId: status.id, id: "s2" },
      ],
      readings: ["{0} has {1}"],
      constraints: [
        { type: "mandatory", roleId: "s1" },
        { type: "value_constraint", roleId: "s2", values: ["active", "closed"] },
        { type: "frequency", roleIds: ["s1"], min: 2, max: "unbounded" },
      ],
    });
    // An irreflexive ring the population breaks with a self-loop.
    const reportsFt = model.addFactType({
      name: "Person reports to Person",
      roles: [
        { name: "reports to", playerId: person.id, id: "g1" },
        { name: "is manager of", playerId: person.id, id: "g2" },
      ],
      readings: ["{0} reports to {1}"],
      constraints: [
        { type: "ring", ringType: "irreflexive", roleId1: "g1", roleId2: "g2" },
        { type: "internal_uniqueness", roleIds: ["g1"] },
      ],
    });

    const ids = model.addPopulation({ factTypeId: idFt.id });
    ids.addInstance({ roleValues: { id1: "P1", id2: "PID1" } });
    ids.addInstance({ roleValues: { id1: "P2", id2: "PID2" } });

    // P1 has a status; P2 does not (mandatory). "pending" is outside the
    // value set, and each person appears once against a minimum of two.
    model.addPopulation({ factTypeId: statusFt.id })
      .addInstance({ roleValues: { s1: "P1", s2: "pending" } });

    model.addPopulation({ factTypeId: reportsFt.id })
      .addInstance({ roleValues: { g1: "P1", g2: "P1" } });

    // Guard the guard: if the model stopped producing violations this test
    // would agree vacuously.
    const sweep = populationValidationRules(model)
      .filter((d) => COVERED_RULE_IDS.has(d.ruleId));
    expect(new Set(sweep.map((d) => d.ruleId))).toEqual(
      new Set([
        "population/mandatory-violation",
        "population/value-constraint-violation",
        "population/frequency-violation",
        "population/ring-violation",
      ]),
    );

    assertAgrees(model);
  });
});
