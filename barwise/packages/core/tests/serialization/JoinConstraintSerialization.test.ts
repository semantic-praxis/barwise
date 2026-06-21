/**
 * Round-trip tests for the join constraint variants (role-path operands).
 *
 * The canonical personCountryDemo -- "Each Person was born in the same
 * Country of which that Person is a citizen" -- is a join_equality over two
 * single-hop paths sharing the Person root. Each variant must serialize its
 * inline paths and deserialize back to an equal structure.
 */
import { describe, expect, it } from "vitest";
import type { Constraint, RolePath } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const serializer = new OrmYamlSerializer();

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

function roundTrip(constraint: Constraint): Constraint {
  const yaml = serializer.serialize(buildModel(constraint));
  const restored = serializer.deserialize(yaml);
  return restored.getFactTypeByName("Person is citizen of Country")!.constraints
    .find((c) => c.type === constraint.type)!;
}

describe("join constraint serialization round-trip", () => {
  it("round-trips join_equality (personCountryDemo)", () => {
    const c = roundTrip({ type: "join_equality", paths: [bornIn, citizenOf] });
    expect(c.type).toBe("join_equality");
    if (c.type === "join_equality") {
      expect(c.paths).toHaveLength(2);
      expect(c.paths[0]).toEqual(bornIn);
      expect(c.paths[1]).toEqual(citizenOf);
    }
  });

  it("round-trips join_subset", () => {
    const c = roundTrip({ type: "join_subset", subset: bornIn, superset: citizenOf });
    expect(c.type).toBe("join_subset");
    if (c.type === "join_subset") {
      expect(c.subset).toEqual(bornIn);
      expect(c.superset).toEqual(citizenOf);
    }
  });

  it("round-trips join_exclusion", () => {
    const c = roundTrip({ type: "join_exclusion", paths: [bornIn, citizenOf] });
    expect(c.type).toBe("join_exclusion");
    if (c.type === "join_exclusion") {
      expect(c.paths).toEqual([bornIn, citizenOf]);
    }
  });
});
