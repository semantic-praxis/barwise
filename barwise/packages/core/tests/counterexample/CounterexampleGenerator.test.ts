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
  const pop = model.addPopulation({ factTypeId: ce.factTypeId });
  for (const inst of ce.forbidden.instances) {
    pop.addInstance({ roleValues: { ...inst.roleValues } });
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
    expect(ce!.forbidden.instances).toHaveLength(2);
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
    expect(ce!.forbidden.instances).toHaveLength(4);
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
    expect(ce!.forbidden.instances).toHaveLength(1);
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
        mandatory: "role2", // no counterexample yet -> skipped
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
