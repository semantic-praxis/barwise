import { describe, expect, it } from "vitest";
import type { Counterexample } from "../../src/counterexample/Counterexample.js";
import {
  generateCounterexampleForConstraint,
  generateCounterexamples,
} from "../../src/counterexample/CounterexampleGenerator.js";
import type { RingType } from "../../src/model/Constraint.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
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
