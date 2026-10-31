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
import { DuplicateIdError, OrmModel } from "../../src/model/OrmModel.js";
import { subtypeFactRef } from "../../src/model/SubtypeFact.js";

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
    // Past every number the config states, wherever it is listed, so a
    // stated `.1` after an unnamed instance could not be taken by it.
    expect(pop.instances.map((i) => i.id)).toEqual([
      "Person_drives_Car.population.8",
      "Person_drives_Car.population.7",
    ]);
    // Past the highest number used, stated or given; and a removed
    // instance's number is not given again.
    pop.removeInstance("Person_drives_Car.population.8");
    expect(pop.addInstance({ roleValues: {} }).id).toBe("Person_drives_Car.population.9");
    expect(m.addPopulation({ factTypeId: "Person_drives_Car" }).id).toBe(
      "Person_drives_Car.population_2",
    );
  });

  it("moves the instance count only past a plain decimal number", () => {
    const m = people();
    const pop = m.addPopulation({
      factTypeId: "Person_drives_Car",
      instances: [
        { id: "Person_drives_Car.population.1e21", roleValues: {} },
        { id: "Person_drives_Car.population.0x10", roleValues: {} },
        { id: "Person_drives_Car.population.9007199254740993", roleValues: {} },
      ],
    });
    // None of those moved it, so two unnamed instances get two ids.
    expect([pop.addInstance({ roleValues: {} }).id, pop.addInstance({ roleValues: {} }).id])
      .toEqual(["Person_drives_Car.population.1", "Person_drives_Car.population.2"]);
  });

  it("moves the instance count past the highest stated number, in any order", () => {
    const m = people();
    const pop = m.addPopulation({
      factTypeId: "Person_drives_Car",
      instances: [
        { id: "Person_drives_Car.population.7", roleValues: {} },
        { id: "Person_drives_Car.population.3", roleValues: {} },
      ],
    });
    expect(pop.addInstance({ roleValues: {} }).id).toBe("Person_drives_Car.population.8");
  });

  it("refuses an instance number past the safe range rather than give one twice", () => {
    const m = people();
    const top = Number.MAX_SAFE_INTEGER - 2;
    const pop = m.addPopulation({
      factTypeId: "Person_drives_Car",
      instances: [{ id: `Person_drives_Car.population.${top}`, roleValues: {} }],
    });
    expect(pop.addInstance({ roleValues: {} }).id).toBe(
      `Person_drives_Car.population.${top + 1}`,
    );
    expect(() => pop.addInstance({ roleValues: {} })).toThrow(/no instance number left/);
  });

  it("lets every id one add states win over a name it mints (decision 17)", () => {
    const m = people();
    // A role stated with the id the fact type would be given.
    const ft = m.addFactType({
      name: "Person walks",
      roles: [{ id: "Person_walks", name: "walks", playerId: "Person" }],
      readings: ["{0} walks"],
      constraints: [
        { type: "mandatory", roleId: "Person_walks" },
        // Stated with the name the first would be minted.
        { id: "Each_Person_walks", type: "mandatory", roleId: "Person_walks" },
      ],
    });
    expect(ft.id).toBe("Person_walks_2");
    expect(ft.internalConstraints.map((c) => c.id)).toEqual([
      "Each_Person_walks_2",
      "Each_Person_walks",
    ]);
    // A stated role id taken by the name another role would mint.
    const ft2 = m.addFactType({
      name: "Person greets Car",
      roles: [
        { name: "a", playerId: "Person" },
        { id: "Person_greets_Car.a", name: "b", playerId: "Car" },
      ],
      readings: ["{0} greets {1}"],
    });
    expect(ft2.roles.map((r) => r.id)).toEqual(["Person_greets_Car.a_2", "Person_greets_Car.a"]);
    // The stated ids were held only while naming: once the fact type goes,
    // nothing holds them.
    expect(m.idKindsHolding("Each_Person_walks")).toEqual(["constraint"]);
    m.removeFactType(ft.id);
    expect(m.idKindsHolding("Each_Person_walks")).toEqual([]);
  });

  it("takes a fact type back out when one of its constraints throws", () => {
    const m = people();
    expect(() =>
      m.addFactType({
        name: "Person rides Car",
        roles: [
          { name: "rides", playerId: "Person" },
          { name: "is ridden by", playerId: "Car" },
        ],
        readings: ["{0} rides {1}"],
        // Asserted, as a parsed file is, and missing the roles its sentence reads.
        constraints: [{ type: "internal_uniqueness" } as never],
      })
    ).toThrow();
    expect(m.getFactTypeByName("Person rides Car")).toBeUndefined();
    expect(m.idKindsHolding("Person_rides_Car")).toEqual([]);
    expect(m.idKindsHolding("Person_rides_Car.rides")).toEqual([]);
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

  it("skips the ids a load reserves, and forgets them when the load ends", () => {
    const m = new OrmModel({ name: "M" });
    const ids = m.withReserved(["Person", "Person_2"], () => {
      // A minted name meets a reserved id before the element stating it.
      const first = m.addObjectType({ name: "Person", kind: "entity", referenceMode: "nr" }).id;
      const stated =
        m.addObjectType({ id: "Person", name: "Human", kind: "entity", referenceMode: "x" }).id;
      return [first, stated];
    });
    expect(ids).toEqual(["Person_3", "Person"]);
    // Ended: "Person_2" is free again.
    expect(m.addObjectType({ name: "Person ", kind: "entity", referenceMode: "y" }).id).toBe(
      "Person_2",
    );
    // A load that throws ends its reservation too.
    expect(() =>
      m.withReserved(["Car"], () => {
        throw new Error("bad file");
      })
    ).toThrow("bad file");
    expect(m.addObjectType({ name: "Car", kind: "entity", referenceMode: "vin" }).id).toBe("Car");
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
    // By local name: two spellings of one name would mint one id.
    expect(() =>
      m.addFactType({
        name: "Person reports to Person",
        roles: [
          { name: "reports to", playerId: "Person" },
          { name: "reports_to", playerId: "Person" },
        ],
        readings: ["{0} reports to {1}"],
      })
    ).toThrow(/has 2 roles named "reports to"/);
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

  it("suffixes roles given one name when asked, as a migration or an import does", () => {
    const m = people();
    const ft = m.addFactType(
      {
        name: "Person and Car are in Trip",
        roles: [
          { name: "is in", playerId: "Person" },
          { name: "is in", playerId: "Car" },
          { name: "is in", playerId: "Name" },
        ],
        readings: ["{0} and {1} are in {2}"],
      },
      { suffixRepeatedRoleNames: true },
    );
    expect(ft.roles.map((r) => [r.name, r.id])).toEqual([
      ["is in", "Person_and_Car_are_in_Trip.is_in"],
      ["is in", "Person_and_Car_are_in_Trip.is_in_2"],
      ["is in", "Person_and_Car_are_in_Trip.is_in_3"],
    ]);
  });

  it("states constraints over the role ids it gives, inside the add's rollback", () => {
    const m = people();
    const ft = m.addFactType(
      {
        name: "Person owns Car",
        roles: [{ name: "owns", playerId: "Person" }, { name: "is owned by", playerId: "Car" }],
        readings: ["{0} owns {1}"],
      },
      {
        constraintsOver: ([owner, car]) => [
          { type: "internal_uniqueness", roleIds: [car!] },
          { type: "mandatory", roleId: owner! },
        ],
      },
    );
    expect(ft.internalConstraints.map((c) => c.type)).toEqual(["internal_uniqueness", "mandatory"]);
    expect(ft.uniquenessOver(["Person_owns_Car.is_owned_by"])?.id).toBe(
      "For_each_Car,_at_most_one_Person_owns_that_Car",
    );
    expect(ft.uniquenessOver(["Person_owns_Car.owns"])).toBeUndefined();
    // A constraint the callback states badly takes the fact type back out.
    expect(() =>
      m.addFactType(
        {
          name: "Person sells Car",
          roles: [{ name: "sells", playerId: "Person" }, { name: "is sold by", playerId: "Car" }],
          readings: ["{0} sells {1}"],
        },
        { constraintsOver: () => [{ type: "internal_uniqueness" } as never] },
      )
    ).toThrow();
    expect(m.getFactTypeByName("Person sells Car")).toBeUndefined();
    expect(m.idKindsHolding("Person_sells_Car.sells")).toEqual([]);
  });

  it("takes an objectified fact type's id from its first reading when asked (decision 20)", () => {
    const m = new OrmModel({ name: "School" });
    m.addObjectType({ name: "Student", kind: "entity", referenceMode: "nr" });
    m.addObjectType({ name: "Course", kind: "entity", referenceMode: "code" });
    m.addObjectType({ name: "Enrollment", kind: "entity", referenceMode: "nr" });
    const ft = m.addFactType(
      {
        name: "Enrollment",
        roles: [
          { name: "enrolls in", playerId: "Student" },
          { name: "has enrolled", playerId: "Course" },
        ],
        readings: ["{0} enrolls in {1}"],
      },
      { idFromFirstReading: true },
    );
    // The name stays as written; only the id comes from the reading.
    expect([ft.name, ft.id]).toEqual(["Enrollment", "Student_enrolls_in_Course"]);
    expect(ft.roles[0]!.id).toBe("Student_enrolls_in_Course.enrolls_in");
  });

  it("refuses an id any element holds, of any kind, in a model that asks for it", () => {
    const m = new OrmModel({ name: "M", idsAcrossKinds: true });
    m.addObjectType({ id: "Person", name: "Person", kind: "entity", referenceMode: "nr" });
    // A fact type, a role and a constraint each stating the object type's id.
    expect(() =>
      m.addFactType({
        id: "Person",
        name: "Person smokes",
        roles: [{ name: "smokes", playerId: "Person" }],
        readings: ["{0} smokes"],
      })
    ).toThrow(
      /Id "Person" is held by an object type, so fact type "Person smokes" cannot be added/,
    );
    expect(() =>
      m.addFactType({
        name: "Person smokes",
        roles: [{ id: "Person", name: "smokes", playerId: "Person" }],
        readings: ["{0} smokes"],
      })
    ).toThrow(DuplicateIdError);
    const ft = m.addFactType({
      name: "Person smokes",
      roles: [{ name: "smokes", playerId: "Person" }],
      readings: ["{0} smokes"],
      // Its own stated constraint id is not refused by its own hold.
      constraints: [{ id: "Smokers", type: "mandatory", roleId: "Person_smokes.smokes" }],
    });
    expect(() => ft.addConstraint({ id: "Person", type: "mandatory", roleId: ft.roles[0]!.id }))
      .toThrow(DuplicateIdError);
    expect(() =>
      m.addConstraint(
        { id: "Person_smokes", type: "exclusion", roleIds: ["Person_smokes.smokes"] } as never,
      )
    ).toThrow(DuplicateIdError);
    // Off by default: a 3.x model may give two kinds one id.
    const loose = new OrmModel({ name: "M" });
    loose.addObjectType({ id: "x", name: "Person", kind: "entity", referenceMode: "nr" });
    expect(() =>
      loose.addFactType({
        id: "x",
        name: "Person smokes",
        roles: [{ name: "smokes", playerId: "x" }],
        readings: ["{0} smokes"],
      })
    ).not.toThrow();
  });

  it("refuses one fact type's config stating an id twice, in a model that refuses across kinds", () => {
    const m = new OrmModel({ name: "M", idsAcrossKinds: true });
    m.addObjectType({ name: "Person", kind: "entity", referenceMode: "nr" });
    expect(() =>
      m.addFactType({
        id: "F",
        name: "Person smokes",
        roles: [{ id: "F", name: "smokes", playerId: "Person" }],
        readings: ["{0} smokes"],
      })
    ).toThrow(/Id "F" is held by its own fact type/);
    expect(m.factTypes).toEqual([]);
  });

  it("removes an unnamed subtype fact or objectification by the element", () => {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({ name: "Person", kind: "entity", referenceMode: "nr" });
    const sf = m.addSubtypeFact({ subtypeId: "Person", supertypeId: "gone" }, {
      skipPlayerValidation: true,
    });
    const oft = m.addObjectifiedFactType({ factTypeId: "no-ft", objectTypeId: "Person" }, {
      skipPlayerValidation: true,
    });
    expect(() => m.removeObjectType("Person")).toThrow();
    m.removeSubtypeFact(sf);
    m.removeObjectifiedFactType(oft);
    expect(m.subtypeFacts).toEqual([]);
    expect(m.objectifiedFactTypes).toEqual([]);
    m.removeObjectType("Person");
    expect(m.objectTypes).toEqual([]);
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

  it("leaves unnamed what its sentence cannot name, and keeps it (decision 19)", () => {
    // A subtype fact or objectification whose ends dangle cannot be
    // verbalized, so it takes no id rather than a generated one: the same
    // input gives the same model. It is still in the model, in order, for
    // validation to report its dangling reference.
    setIdGenerator(() => "generated");
    try {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ name: "Person", kind: "entity", referenceMode: "nr" });
      m.addObjectType({ name: "Driver", kind: "entity", referenceMode: "nr" });
      const sf = m.addSubtypeFact({ subtypeId: "gone", supertypeId: "also-gone" }, {
        skipPlayerValidation: true,
      });
      m.addSubtypeFact({ subtypeId: "Driver", supertypeId: "Person" });
      const oft = m.addObjectifiedFactType({ factTypeId: "no-ft", objectTypeId: "no-ot" }, {
        skipPlayerValidation: true,
      });
      expect(sf.id).toBeUndefined();
      expect(oft.id).toBeUndefined();
      expect(m.subtypeFacts.map(subtypeFactRef)).toEqual([
        "unnamed:gone<also-gone",
        "Driver_is_a_subtype_of_Person",
      ]);
      expect(m.objectifiedFactTypes).toEqual([oft]);
      expect(m.idKindsHolding("generated")).toEqual([]);
    } finally {
      setIdGenerator(undefined);
    }
  });
});
