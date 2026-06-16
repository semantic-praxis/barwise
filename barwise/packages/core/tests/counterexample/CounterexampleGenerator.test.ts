import { describe, expect, it } from "vitest";
import type { Counterexample } from "../../src/counterexample/Counterexample.js";
import {
  generateCounterexampleForConstraint,
  generateCounterexamples,
} from "../../src/counterexample/CounterexampleGenerator.js";
import type { RingType } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/**
 * The core correctness guarantee: a generated counterexample is the
 * inverse of population validation. Attaching its forbidden population to
 * the model must make populationValidationRules report a violation of the
 * matching rule.
 */
function forbids(model: OrmModel, ce: Counterexample, ruleId: string): boolean {
  for (const forbidden of ce.forbidden) {
    const pop = model.addPopulation({ factTypeId: forbidden.factTypeId });
    for (const inst of forbidden.instances) {
      pop.addInstance({ roleValues: { ...inst.roleValues } });
    }
  }
  return populationValidationRules(model).some((d) => d.ruleId === ruleId);
}

function placesModel(): OrmModel {
  return new ModelBuilder()
    .withEntityType("Customer")
    .withEntityType("Order")
    .withBinaryFactType("Customer places Order", {
      role1: { player: "Customer", name: "places" },
      role2: { player: "Order", name: "is placed by" },
    })
    .build();
}

describe("counterexample generation", () => {
  it("forbids a duplicate for single-role internal uniqueness", () => {
    const model = new ModelBuilder()
      .withEntityType("Customer")
      .withEntityType("Order")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
      })
      .build();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const uc = ft.constraints.find((c) => c.type === "internal_uniqueness")!;

    const ce = generateCounterexampleForConstraint(uc, ft, model);
    expect(ce).toBeDefined();
    expect(ce!.constraintType).toBe("internal_uniqueness");
    expect(ce!.forbidden[0]!.instances).toHaveLength(2);
    expect(forbids(model, ce!, "population/uniqueness-violation")).toBe(true);
  });

  it("forbids a duplicate tuple for spanning internal uniqueness", () => {
    const model = new ModelBuilder()
      .withEntityType("Customer")
      .withEntityType("Order")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "spanning",
      })
      .build();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const uc = ft.constraints.find((c) => c.type === "internal_uniqueness")!;

    const ce = generateCounterexampleForConstraint(uc, ft, model);
    expect(forbids(model, ce!, "population/uniqueness-violation")).toBe(true);
  });

  it("forbids an out-of-set value for a role-level value constraint", () => {
    const model = new ModelBuilder()
      .withEntityType("Order")
      .withValueType("Rating")
      .withBinaryFactType("Order has Rating", {
        role1: { player: "Order", name: "has" },
        role2: { player: "Rating", name: "of" },
      })
      .build();
    const ft = model.getFactTypeByName("Order has Rating")!;
    ft.addConstraint({
      type: "value_constraint",
      roleId: "Order has Rating::role2",
      values: ["A", "B", "C"],
    });
    const vc = ft.constraints.find((c) => c.type === "value_constraint")!;

    const ce = generateCounterexampleForConstraint(vc, ft, model);
    expect(ce).toBeDefined();
    expect(forbids(model, ce!, "population/value-constraint-violation")).toBe(true);
  });

  it("returns nothing for a type-level value constraint (no role)", () => {
    const model = placesModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    ft.addConstraint({ type: "value_constraint", values: ["A", "B"] });
    const vc = ft.constraints.find((c) => c.type === "value_constraint")!;

    expect(generateCounterexampleForConstraint(vc, ft, model)).toBeUndefined();
  });

  it("forbids exceeding the upper bound of a frequency constraint", () => {
    const model = placesModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    ft.addConstraint({
      type: "frequency",
      roleId: "Customer places Order::role1",
      min: 1,
      max: 3,
    });
    const fc = ft.constraints.find((c) => c.type === "frequency")!;

    const ce = generateCounterexampleForConstraint(fc, ft, model);
    expect(ce!.forbidden[0]!.instances).toHaveLength(4);
    expect(forbids(model, ce!, "population/frequency-violation")).toBe(true);
  });

  it("forbids falling short of the lower bound of an unbounded frequency", () => {
    const model = placesModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    ft.addConstraint({
      type: "frequency",
      roleId: "Customer places Order::role1",
      min: 2,
      max: "unbounded",
    });
    const fc = ft.constraints.find((c) => c.type === "frequency")!;

    const ce = generateCounterexampleForConstraint(fc, ft, model);
    expect(ce!.forbidden[0]!.instances).toHaveLength(1);
    expect(forbids(model, ce!, "population/frequency-violation")).toBe(true);
  });

  it("returns nothing for an unconstraining frequency (min<=1, unbounded)", () => {
    const model = placesModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    ft.addConstraint({
      type: "frequency",
      roleId: "Customer places Order::role1",
      min: 1,
      max: "unbounded",
    });
    const fc = ft.constraints.find((c) => c.type === "frequency")!;

    expect(generateCounterexampleForConstraint(fc, ft, model)).toBeUndefined();
  });

  const ringTypes: RingType[] = [
    "irreflexive",
    "asymmetric",
    "antisymmetric",
    "symmetric",
    "intransitive",
    "transitive",
    "acyclic",
    "purely_reflexive",
  ];
  for (const ringType of ringTypes) {
    it(`forbids a ${ringType} ring violation`, () => {
      const model = new ModelBuilder()
        .withEntityType("Person")
        .withBinaryFactType("Person reports to Person", {
          role1: { player: "Person", name: "reports to" },
          role2: { player: "Person", name: "is reported to by" },
        })
        .build();
      const ft = model.getFactTypeByName("Person reports to Person")!;
      ft.addConstraint({
        type: "ring",
        roleId1: "Person reports to Person::role1",
        roleId2: "Person reports to Person::role2",
        ringType,
      });
      const rc = ft.constraints.find((c) => c.type === "ring")!;

      const ce = generateCounterexampleForConstraint(rc, ft, model);
      expect(ce).toBeDefined();
      expect(forbids(model, ce!, "population/ring-violation")).toBe(true);
    });
  }
});

describe("generateCounterexamples (model-wide)", () => {
  it("emits one per applicable constraint and skips those without a generator", () => {
    const model = new ModelBuilder()
      .withEntityType("Customer")
      .withEntityType("Order")
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        uniqueness: "role2",
        mandatory: "role2", // Order has no other fact type to anchor -> skipped
      })
      .build();

    const ces = generateCounterexamples(model);
    expect(ces).toHaveLength(1);
    expect(ces[0]!.constraintType).toBe("internal_uniqueness");
    expect(ces[0]!.text).toContain("Rules out:");
  });

  it("is deterministic (same model in, identical readings out)", () => {
    const readings = (): string[] => {
      const model = new ModelBuilder()
        .withEntityType("Customer")
        .withEntityType("Order")
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();
      return generateCounterexamples(model).map((c) => c.text);
    };
    expect(readings()).toEqual(readings());
  });
});

describe("cross-fact-type counterexamples", () => {
  it("forbids a mandatory role the player never plays", () => {
    const model = new ModelBuilder()
      .withEntityType("Customer")
      .withValueType("CustomerId")
      .withEntityType("Order")
      .withBinaryFactType("Customer has CustomerId", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "CustomerId", name: "identifies" },
      })
      .withBinaryFactType("Customer places Order", {
        role1: { player: "Customer", name: "places" },
        role2: { player: "Order", name: "is placed by" },
        mandatory: "role1",
      })
      .build();
    const ft = model.getFactTypeByName("Customer places Order")!;
    const mc = ft.constraints.find((c) => c.type === "mandatory")!;

    const ce = generateCounterexampleForConstraint(mc, ft, model);
    expect(ce).toBeDefined();
    expect(ce!.constraintType).toBe("mandatory");
    expect(forbids(model, ce!, "population/mandatory-violation")).toBe(true);
  });

  it("returns nothing for a mandatory role with no anchor fact type", () => {
    const model = placesModel();
    const ft = model.getFactTypeByName("Customer places Order")!;
    ft.addConstraint({ type: "mandatory", roleId: "Customer places Order::role1" });
    const mc = ft.constraints.find((c) => c.type === "mandatory")!;

    expect(generateCounterexampleForConstraint(mc, ft, model)).toBeUndefined();
  });

  it("forbids a disjunctive mandatory the player satisfies for none", () => {
    const model = new ModelBuilder()
      .withEntityType("Person")
      .withValueType("PersonId")
      .withValueType("Phone")
      .withBinaryFactType("Person has PersonId", {
        role1: { player: "Person", name: "has" },
        role2: { player: "PersonId", name: "identifies" },
      })
      .withBinaryFactType("Person has HomePhone", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Phone", name: "is home of" },
      })
      .withBinaryFactType("Person has MobilePhone", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Phone", name: "is mobile of" },
      })
      .build();
    const home = model.getFactTypeByName("Person has HomePhone")!;
    home.addConstraint({
      type: "disjunctive_mandatory",
      roleIds: ["Person has HomePhone::role1", "Person has MobilePhone::role1"],
    });
    const dc = home.constraints.find((c) => c.type === "disjunctive_mandatory")!;

    const ce = generateCounterexampleForConstraint(dc, home, model);
    expect(ce).toBeDefined();
    expect(forbids(model, ce!, "population/disjunctive-mandatory-violation")).toBe(true);
  });

  function drivesRidesModel(): OrmModel {
    return new ModelBuilder()
      .withEntityType("Person")
      .withEntityType("Car")
      .withEntityType("Bus")
      .withBinaryFactType("Person drives Car", {
        role1: { player: "Person", name: "drives" },
        role2: { player: "Car", name: "is driven by" },
      })
      .withBinaryFactType("Person rides Bus", {
        role1: { player: "Person", name: "rides" },
        role2: { player: "Bus", name: "is ridden by" },
      })
      .build();
  }

  it("forbids a spanning exclusion (a value in two excluded roles)", () => {
    const model = drivesRidesModel();
    const drives = model.getFactTypeByName("Person drives Car")!;
    drives.addConstraint({
      type: "exclusion",
      roleIds: ["Person drives Car::role1", "Person rides Bus::role1"],
    });
    const ec = drives.constraints.find((c) => c.type === "exclusion")!;

    const ce = generateCounterexampleForConstraint(ec, drives, model);
    expect(ce).toBeDefined();
    expect(forbids(model, ce!, "population/exclusion-violation")).toBe(true);
  });

  it("forbids a spanning exclusive-or (a value in both roles)", () => {
    const model = drivesRidesModel();
    const drives = model.getFactTypeByName("Person drives Car")!;
    drives.addConstraint({
      type: "exclusive_or",
      roleIds: ["Person drives Car::role1", "Person rides Bus::role1"],
    });
    const xor = drives.constraints.find((c) => c.type === "exclusive_or")!;

    const ce = generateCounterexampleForConstraint(xor, drives, model);
    expect(ce).toBeDefined();
    expect(forbids(model, ce!, "population/exclusive-or-violation")).toBe(true);
  });

  it("forbids a spanning subset (a tuple with no superset match)", () => {
    const model = new ModelBuilder()
      .withEntityType("Person")
      .withEntityType("Course")
      .withBinaryFactType("Person teaches Course", {
        role1: { player: "Person", name: "teaches" },
        role2: { player: "Course", name: "is taught by" },
      })
      .withBinaryFactType("Person enrolled in Course", {
        role1: { player: "Person", name: "is enrolled in" },
        role2: { player: "Course", name: "enrolls" },
      })
      .build();
    const teaches = model.getFactTypeByName("Person teaches Course")!;
    teaches.addConstraint({
      type: "subset",
      subsetRoleIds: ["Person teaches Course::role1", "Person teaches Course::role2"],
      supersetRoleIds: [
        "Person enrolled in Course::role1",
        "Person enrolled in Course::role2",
      ],
    });
    const sc = teaches.constraints.find((c) => c.type === "subset")!;

    const ce = generateCounterexampleForConstraint(sc, teaches, model);
    expect(ce).toBeDefined();
    expect(forbids(model, ce!, "population/subset-violation")).toBe(true);
  });

  function roomModel(): OrmModel {
    return new ModelBuilder()
      .withEntityType("Room")
      .withEntityType("Building")
      .withValueType("RoomNumber")
      .withBinaryFactType("Room is in Building", {
        role1: { player: "Room", name: "is in" },
        role2: { player: "Building", name: "houses" },
      })
      .withBinaryFactType("Room has RoomNumber", {
        role1: { player: "Room", name: "has" },
        role2: { player: "RoomNumber", name: "numbers" },
      })
      .build();
  }

  it("forbids a shared combination for an external uniqueness", () => {
    const model = roomModel();
    const inBuilding = model.getFactTypeByName("Room is in Building")!;
    inBuilding.addConstraint({
      type: "external_uniqueness",
      roleIds: ["Room is in Building::role2", "Room has RoomNumber::role2"],
    });
    const euc = inBuilding.constraints.find((c) => c.type === "external_uniqueness")!;

    const ce = generateCounterexampleForConstraint(euc, inBuilding, model);
    expect(ce).toBeDefined();
    expect(ce!.constraintType).toBe("external_uniqueness");
    expect(ce!.forbidden).toHaveLength(2);
    expect(forbids(model, ce!, "population/external-uniqueness-violation")).toBe(true);
  });

  it("returns nothing for an external uniqueness with an un-inferable join", () => {
    const model = roomModel();
    const inBuilding = model.getFactTypeByName("Room is in Building")!;
    // Both constrained roles share a fact type -> no single common object.
    inBuilding.addConstraint({
      type: "external_uniqueness",
      roleIds: ["Room is in Building::role1", "Room is in Building::role2"],
    });
    const euc = inBuilding.constraints.find((c) => c.type === "external_uniqueness")!;

    expect(generateCounterexampleForConstraint(euc, inBuilding, model)).toBeUndefined();
  });

  it("forbids a spanning equality (a tuple present on one side only)", () => {
    const model = new ModelBuilder()
      .withEntityType("Person")
      .withEntityType("Dept")
      .withBinaryFactType("Person manages Dept", {
        role1: { player: "Person", name: "manages" },
        role2: { player: "Dept", name: "is managed by" },
      })
      .withBinaryFactType("Person works in Dept", {
        role1: { player: "Person", name: "works in" },
        role2: { player: "Dept", name: "employs" },
      })
      .build();
    const manages = model.getFactTypeByName("Person manages Dept")!;
    manages.addConstraint({
      type: "equality",
      roleIds1: ["Person manages Dept::role1", "Person manages Dept::role2"],
      roleIds2: ["Person works in Dept::role1", "Person works in Dept::role2"],
    });
    const eq = manages.constraints.find((c) => c.type === "equality")!;

    const ce = generateCounterexampleForConstraint(eq, manages, model);
    expect(ce).toBeDefined();
    expect(forbids(model, ce!, "population/equality-violation")).toBe(true);
  });
});

const RULE_BY_TYPE: Record<string, string> = {
  internal_uniqueness: "population/uniqueness-violation",
  value_constraint: "population/value-constraint-violation",
  frequency: "population/frequency-violation",
  ring: "population/ring-violation",
  mandatory: "population/mandatory-violation",
  disjunctive_mandatory: "population/disjunctive-mandatory-violation",
  exclusion: "population/exclusion-violation",
  exclusive_or: "population/exclusive-or-violation",
  subset: "population/subset-violation",
  equality: "population/equality-violation",
  external_uniqueness: "population/external-uniqueness-violation",
};

interface RoleInit {
  readonly player: string;
  readonly role: string;
  readonly id: string;
}

/**
 * A model carrying many constraint types across several fact types, so a
 * single generateCounterexamples call exercises the full dispatch.
 */
function buildConstraintRichModel(): OrmModel {
  const m = new OrmModel({ name: "Constraint-rich" });
  const ent = (name: string, ref: string) =>
    m.addObjectType({ name, kind: "entity", referenceMode: ref });
  const val = (name: string) => m.addObjectType({ name, kind: "value" });
  const bf = (name: string, a: RoleInit, b: RoleInit) =>
    m.addFactType({
      name,
      roles: [
        { name: a.role, playerId: a.player, id: a.id },
        { name: b.role, playerId: b.player, id: b.id },
      ],
      readings: ["{0} verb {1}"],
    });

  const person = ent("Person", "person_id");
  const car = ent("Car", "vin");
  const bus = ent("Bus", "bus_id");
  const course = ent("Course", "course_code");
  const dept = ent("Dept", "dept_code");
  const room = ent("Room", "room_id");
  const building = ent("Building", "building_code");
  const personId = val("PersonId");
  const phone = val("Phone");
  const ticket = val("Ticket");
  const rating = val("Rating");
  const roomNumber = val("RoomNumber");

  // internal uniqueness + spanning exclusion (drives / rides)
  const drives = bf(
    "Person drives Car",
    { player: person.id, role: "drives", id: "d1" },
    { player: car.id, role: "is driven by", id: "d2" },
  );
  bf(
    "Person rides Bus",
    { player: person.id, role: "rides", id: "r1" },
    { player: bus.id, role: "is ridden by", id: "r2" },
  );
  drives.addConstraint({ type: "internal_uniqueness", roleIds: ["d1"] });
  drives.addConstraint({ type: "exclusion", roleIds: ["d1", "r1"] });

  // value constraint (role-level)
  const carRating = bf(
    "Car has Rating",
    { player: car.id, role: "has", id: "cr1" },
    { player: rating.id, role: "of", id: "cr2" },
  );
  carRating.addConstraint({ type: "value_constraint", roleId: "cr2", values: ["A", "B", "C"] });

  // frequency
  const hasTicket = bf(
    "Person has Ticket",
    { player: person.id, role: "has", id: "t1" },
    { player: ticket.id, role: "of", id: "t2" },
  );
  hasTicket.addConstraint({ type: "frequency", roleId: "t1", min: 1, max: 3 });

  // ring
  const reports = bf(
    "Person reports to Person",
    { player: person.id, role: "reports to", id: "rp1" },
    { player: person.id, role: "is reported to by", id: "rp2" },
  );
  reports.addConstraint({ type: "ring", roleId1: "rp1", roleId2: "rp2", ringType: "irreflexive" });

  // mandatory (Person is anchored by its many other roles)
  const hasPersonId = bf(
    "Person has PersonId",
    { player: person.id, role: "has", id: "pid1" },
    { player: personId.id, role: "identifies", id: "pid2" },
  );
  hasPersonId.addConstraint({ type: "mandatory", roleId: "pid1" });

  // disjunctive mandatory across two fact types
  const home = bf(
    "Person has HomePhone",
    { player: person.id, role: "has", id: "hp1" },
    { player: phone.id, role: "is home of", id: "hp2" },
  );
  bf(
    "Person has MobilePhone",
    { player: person.id, role: "has", id: "mp1" },
    { player: phone.id, role: "is mobile of", id: "mp2" },
  );
  home.addConstraint({ type: "disjunctive_mandatory", roleIds: ["hp1", "mp1"] });

  // subset (spanning)
  const teaches = bf(
    "Person teaches Course",
    { player: person.id, role: "teaches", id: "te1" },
    { player: course.id, role: "is taught by", id: "te2" },
  );
  bf(
    "Person enrolled in Course",
    { player: person.id, role: "enrolled in", id: "en1" },
    { player: course.id, role: "enrolls", id: "en2" },
  );
  teaches.addConstraint({
    type: "subset",
    subsetRoleIds: ["te1", "te2"],
    supersetRoleIds: ["en1", "en2"],
  });

  // equality (spanning)
  const manages = bf(
    "Person manages Dept",
    { player: person.id, role: "manages", id: "mg1" },
    { player: dept.id, role: "is managed by", id: "mg2" },
  );
  bf(
    "Person works in Dept",
    { player: person.id, role: "works in", id: "wk1" },
    { player: dept.id, role: "employs", id: "wk2" },
  );
  manages.addConstraint({ type: "equality", roleIds1: ["mg1", "mg2"], roleIds2: ["wk1", "wk2"] });

  // external uniqueness (Room by Building + RoomNumber)
  const inBuilding = bf(
    "Room is in Building",
    { player: room.id, role: "is in", id: "rb1" },
    { player: building.id, role: "houses", id: "rb2" },
  );
  bf(
    "Room has RoomNumber",
    { player: room.id, role: "has", id: "rn1" },
    { player: roomNumber.id, role: "numbers", id: "rn2" },
  );
  inBuilding.addConstraint({ type: "external_uniqueness", roleIds: ["rb2", "rn2"] });

  return m;
}

describe("model-wide round-trip completeness", () => {
  it("every generated counterexample trips its own rule", () => {
    const model = buildConstraintRichModel();
    const ces = generateCounterexamples(model);

    // A real spread of constraint types, so the guard fails loudly if a
    // generator stops emitting.
    const types = new Set(ces.map((c) => c.constraintType));
    expect(types.size).toBeGreaterThanOrEqual(8);

    for (const ce of ces) {
      const expected = RULE_BY_TYPE[ce.constraintType];
      expect(expected, `no rule mapped for ${ce.constraintType}`).toBeTruthy();

      // Add this counterexample's forbidden populations, validate, then
      // remove them, so each counterexample is checked in isolation.
      const added: string[] = [];
      for (const forbidden of ce.forbidden) {
        const pop = model.addPopulation({ factTypeId: forbidden.factTypeId });
        for (const inst of forbidden.instances) {
          pop.addInstance({ roleValues: { ...inst.roleValues } });
        }
        added.push(pop.id);
      }
      const ruleIds = populationValidationRules(model).map((d) => d.ruleId);
      for (const id of added) model.removePopulation(id);

      expect(
        ruleIds,
        `${ce.constraintType} counterexample did not trip ${expected}`,
      ).toContain(expected);
    }
  });
});
