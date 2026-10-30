/**
 * The model names what it is given without an id (iri-identity WS6, 6b-2a;
 * decision 17): an object type and a fact type by their local names, a
 * role as `<fact type>.<role>`, a constraint, subtype fact and
 * objectification by their minted sentences, a population as
 * `<fact type>.population` and its instances `<population>.N`, each under
 * the suffix rule across every kind. A stated id is kept as written.
 *
 * Spec: docs/specs/iri-identity.spec.md, WS6, "6b ships in four parts".
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { setIdGenerator } from "../../src/model/id.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** Person drives Car, Person has Name, all without ids. */
function people(): OrmModel {
  const m = new OrmModel({ name: "People" });
  m.addObjectType({ name: "Person", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ name: "Car", kind: "entity", referenceMode: "vin" });
  m.addObjectType({ name: "Name", kind: "value" });
  m.addFactType({
    name: "Person drives Car",
    roles: [
      { name: "drives", playerId: "Person" },
      { name: "is driven by", playerId: "Car" },
    ],
    readings: ["{0} drives {1}"],
    constraints: [{ type: "internal_uniqueness", roleIds: ["Person_drives_Car.is_driven_by"] }],
  });
  m.addFactType({
    name: "Person has Name",
    roles: [
      { name: "has", playerId: "Person" },
      { name: "is of", playerId: "Name" },
    ],
    readings: ["{0} has {1}"],
  });
  return m;
}

describe("a model naming what it is given", () => {
  it("names object types and fact types by their local names, and roles by fact type and role", () => {
    const m = people();
    expect(m.objectTypes.map((o) => o.id)).toEqual(["Person", "Car", "Name"]);
    expect(m.factTypes.map((f) => f.id)).toEqual(["Person_drives_Car", "Person_has_Name"]);
    expect(m.getFactType("Person_drives_Car")!.roles.map((r) => r.id)).toEqual([
      "Person_drives_Car.drives",
      "Person_drives_Car.is_driven_by",
    ]);
  });

  it("names a constraint by its sentence, given in the config, later, or across fact types", () => {
    const m = people();
    expect(m.getFactType("Person_drives_Car")!.internalConstraints[0]!.id).toBe(
      "For_each_Car,_at_most_one_Person_drives_that_Car",
    );
    const later = m.getFactType("Person_has_Name")!.addConstraint({
      type: "mandatory",
      roleId: "Person_has_Name.has",
    });
    expect(later.id).toBe("Each_Person_has_at_least_one_Name");
    const across = m.addConstraint({
      type: "disjunctive_mandatory",
      roleIds: ["Person_drives_Car.drives", "Person_has_Name.has"],
    } as Constraint as never);
    expect(across.id).toMatch(/^Each_Person_/);
    expect(m.idKindsHolding(across.id!)).toEqual(["constraint"]);
  });

  it("names subtype facts and objectifications by their sentences", () => {
    const m = people();
    m.addObjectType({ name: "Driver", kind: "entity", referenceMode: "nr" });
    m.addObjectType({ name: "Driving", kind: "entity", referenceMode: "nr" });
    expect(m.addSubtypeFact({ subtypeId: "Driver", supertypeId: "Person" }).id).toBe(
      "Driver_is_a_subtype_of_Person",
    );
    expect(
      m.addObjectifiedFactType({ factTypeId: "Person_drives_Car", objectTypeId: "Driving" }).id,
    ).toBe("Driving_is_where_Person_drives_Car");
  });

  it("names a population after its fact type and numbers its instances, never reusing one", () => {
    const m = people();
    const pop = m.addPopulation({
      factTypeId: "Person_drives_Car",
      instances: [{ roleValues: {} }, { id: "Person_drives_Car.population.7", roleValues: {} }],
    });
    expect(pop.id).toBe("Person_drives_Car.population");
    expect(pop.instances.map((i) => i.id)).toEqual([
      "Person_drives_Car.population.1",
      "Person_drives_Car.population.7",
    ]);
    // Past the highest number used, stated or given; and a removed
    // instance's number is not given again.
    pop.removeInstance("Person_drives_Car.population.7");
    expect(pop.addInstance({ roleValues: {} }).id).toBe("Person_drives_Car.population.8");
    expect(m.addPopulation({ factTypeId: "Person_drives_Car" }).id).toBe(
      "Person_drives_Car.population_2",
    );
  });

  it("gives the next free _N when the name is held, by any kind", () => {
    const m = new OrmModel({ name: "M" });
    // A fact type's stated id equal to the object type's would-be name.
    m.addObjectType({ id: "P", name: "P0", kind: "entity", referenceMode: "nr" });
    m.addFactType({
      id: "Person",
      name: "P0 exists",
      roles: [{ id: "r", name: "exists", playerId: "P" }],
      readings: ["{0} exists"],
    });
    expect(m.addObjectType({ name: "Person", kind: "entity", referenceMode: "nr" }).id).toBe(
      "Person_2",
    );
    m.addObjectType({ id: "Person_3", name: "P3", kind: "entity", referenceMode: "nr" });
    expect(m.addObjectType({ name: "Person ", kind: "entity", referenceMode: "x" }).id).toBe(
      "Person_4",
    );
  });

  it("keeps an id it is given, as written", () => {
    const m = new OrmModel({ name: "M" });
    expect(m.addObjectType({ id: "ot-1", name: "Person", kind: "entity", referenceMode: "nr" }).id)
      .toBe("ot-1");
  });

  it("refuses two roles of one fact type given one name and no ids (decision 5)", () => {
    const m = people();
    expect(() =>
      m.addFactType({
        name: "Person knows Person",
        roles: [
          { name: "knows", playerId: "Person" },
          { name: "knows", playerId: "Person" },
        ],
        readings: ["{0} knows {1}"],
      })
    ).toThrow(/has 2 roles named "knows".*give each role a name of its own, or state the role ids/);
    // Stated ids keep a file that repeats a name readable.
    const ft = m.addFactType({
      name: "Person knows Person",
      roles: [
        { id: "k0", name: "knows", playerId: "Person" },
        { id: "k1", name: "knows", playerId: "Person" },
      ],
      readings: ["{0} knows {1}"],
    });
    expect(ft.roles.map((r) => r.id)).toEqual(["k0", "k1"]);
  });

  it("refuses a fact type's bad constraint before storing anything", () => {
    const m = people();
    const before = m.factTypes.length;
    expect(() =>
      m.addFactType({
        name: "Person rides Car",
        roles: [
          { name: "rides", playerId: "Person" },
          { name: "is ridden by", playerId: "Car" },
        ],
        readings: ["{0} rides {1}"],
        constraints: [{ type: "exclusion", roleIds: ["x"] } as never],
      })
    ).toThrow(/lives in the model/);
    expect(m.factTypes.length).toBe(before);
    expect(m.idKindsHolding("Person_rides_Car")).toEqual([]);
  });

  it("gives a generated id, until 6b-2b, to what its sentence cannot name", () => {
    // A subtype fact whose ends dangle cannot be verbalized; format 3.0
    // requires an id, so it gets the generator's (decision 19 lands with
    // the 4.0 schema).
    setIdGenerator(() => "generated");
    try {
      const m = new OrmModel({ name: "M" });
      const sf = m.addSubtypeFact({ subtypeId: "gone", supertypeId: "also-gone" }, {
        skipPlayerValidation: true,
      });
      expect(sf.id).toBe("generated");
    } finally {
      setIdGenerator(undefined);
    }
  });
});
