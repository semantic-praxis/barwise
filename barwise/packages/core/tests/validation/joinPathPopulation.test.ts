/**
 * Population-satisfaction tests for join constraints (role-path operands).
 *
 * Builds the personCountryDemo model (Person born in / citizen of Country)
 * and checks that the endpoint sets reached along each path, correlated by
 * the Person root, satisfy the constraint's relation over a sample
 * population.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

interface BornCitizen {
  person: string;
  born?: string;
  citizen?: string;
}

/**
 * Build the two-fact-type Person/Country model with the given join
 * constraint, and populate born-in / citizen-of facts from `rows`.
 */
function buildModel(constraint: Constraint, rows: BornCitizen[]): OrmModel {
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
  const bornFt = model.addFactType({
    name: "Person was born in Country",
    roles: [
      { name: "was born in", playerId: person.id, id: "pb-person" },
      { name: "is birthplace of", playerId: country.id, id: "pb-country" },
    ],
    readings: ["{0} was born in {1}"],
  });
  const citFt = model.addFactType({
    name: "Person is citizen of Country",
    roles: [
      { name: "is citizen of", playerId: person.id, id: "pc-person" },
      { name: "has citizen", playerId: country.id, id: "pc-country" },
    ],
    readings: ["{0} is citizen of {1}"],
    constraints: [constraint],
  });

  const bornPop = model.addPopulation({ factTypeId: bornFt.id });
  const citPop = model.addPopulation({ factTypeId: citFt.id });
  for (const row of rows) {
    if (row.born !== undefined) {
      bornPop.addInstance({ roleValues: { "pb-person": row.person, "pb-country": row.born } });
    }
    if (row.citizen !== undefined) {
      citPop.addInstance({ roleValues: { "pc-person": row.person, "pc-country": row.citizen } });
    }
  }
  return model;
}

const bornIn = { root: "ot-person", steps: [{ entry: "pb-person", exit: "pb-country" }] };
const citizenOf = { root: "ot-person", steps: [{ entry: "pc-person", exit: "pc-country" }] };

function joinDiags(model: OrmModel) {
  return populationValidationRules(model).filter((d) => d.ruleId.startsWith("population/join-"));
}

describe("join constraint population satisfaction", () => {
  it("accepts a join_equality where each Person's countries coincide", () => {
    const model = buildModel(
      { type: "join_equality", paths: [bornIn, citizenOf] },
      [{ person: "P1", born: "C1", citizen: "C1" }, { person: "P2", born: "C2", citizen: "C2" }],
    );
    expect(joinDiags(model)).toHaveLength(0);
  });

  it("flags a join_equality where a Person's countries differ", () => {
    const model = buildModel(
      { type: "join_equality", paths: [bornIn, citizenOf] },
      [{ person: "P1", born: "C1", citizen: "C1" }, { person: "P2", born: "C2", citizen: "C3" }],
    );
    const diags = joinDiags(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("population/join-equality-violation");
    expect(diags[0]!.message).toContain("P2");
  });

  it("flags a join_equality where one path reaches nothing (closed world)", () => {
    const model = buildModel(
      { type: "join_equality", paths: [bornIn, citizenOf] },
      [{ person: "P1", born: "C1" }], // no citizenship fact for P1
    );
    expect(joinDiags(model)).toHaveLength(1);
  });

  it("accepts a join_subset where born-in is among citizen-of", () => {
    const model = buildModel(
      { type: "join_subset", subset: bornIn, superset: citizenOf },
      [{ person: "P1", born: "C1", citizen: "C1" }],
    );
    expect(joinDiags(model)).toHaveLength(0);
  });

  it("flags a join_subset where born-in is not among citizen-of", () => {
    const model = buildModel(
      { type: "join_subset", subset: bornIn, superset: citizenOf },
      [{ person: "P1", born: "C1", citizen: "C2" }],
    );
    const diags = joinDiags(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("population/join-subset-violation");
  });

  it("flags a join_exclusion where a Person shares a country across paths", () => {
    const model = buildModel(
      { type: "join_exclusion", paths: [bornIn, citizenOf] },
      [{ person: "P1", born: "C1", citizen: "C1" }],
    );
    const diags = joinDiags(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("population/join-exclusion-violation");
  });

  it("accepts a join_exclusion where the countries are disjoint", () => {
    const model = buildModel(
      { type: "join_exclusion", paths: [bornIn, citizenOf] },
      [{ person: "P1", born: "C1", citizen: "C2" }],
    );
    expect(joinDiags(model)).toHaveLength(0);
  });

  it("emits nothing when there is no population (gated)", () => {
    const model = buildModel({ type: "join_equality", paths: [bornIn, citizenOf] }, []);
    expect(joinDiags(model)).toHaveLength(0);
  });
});
