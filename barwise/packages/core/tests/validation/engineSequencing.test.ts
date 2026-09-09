/**
 * What `validate` does when the graph cannot build.
 *
 * The engine resolves references once, up front, so a model with a
 * dangling id has no graph and the rules that need one do not run. That
 * is a deliberate trade and it costs something real: findings that were
 * reported before are not reported now (barwise-978). It is pinned here
 * by name so the next reader meets it as a decision rather than as a
 * surprise, and so a later change back is a failing test rather than a
 * silent improvement nobody notices.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { RULE_ID } from "../../src/validation/ruleId.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

/** A model whose one population repeats a tuple its uniqueness forbids. */
function withPopulationViolation(): OrmModel {
  const model = new ModelBuilder("Seq")
    .withEntityType("Customer")
    .withEntityType("Order")
    .withBinaryFactType("Customer places Order", {
      role1: { player: "Customer", name: "places" },
      role2: { player: "Order", name: "is placed by" },
      uniqueness: "role2",
    })
    .build();
  const pop = model.addPopulation({ factTypeId: model.factTypes[0]!.id });
  const [r1, r2] = [model.factTypes[0]!.roles[0]!.id, model.factTypes[0]!.roles[1]!.id];
  pop.addInstance({ roleValues: { [r1]: "C001", [r2]: "O123" } });
  pop.addInstance({ roleValues: { [r1]: "C002", [r2]: "O123" } });
  return model;
}

describe("ValidationEngine sequencing around graph construction", () => {
  it("reports population violations when every reference resolves", () => {
    const diagnostics = new ValidationEngine().validate(withPopulationViolation());
    expect(diagnostics.some((d) => d.ruleId.startsWith("population/"))).toBe(true);
  });

  it("suppresses graph-taking rules once one reference dangles", () => {
    const model = withPopulationViolation();
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: "r-bad", id: "c-bad" });

    const diagnostics = new ValidationEngine().validate(model);

    // The reference is reported, in the id the rule that used to check
    // it owned.
    expect(diagnostics.map((d) => d.ruleId)).toContain(RULE_ID.mandatoryInvalidRole);
    // The tuple violation the previous case found is not, because the
    // population rules need the graph.
    expect(diagnostics.some((d) => d.ruleId.startsWith("population/"))).toBe(false);
    // Reference-free rules still run, so the caller is not left with
    // only the one error.
    expect(diagnostics.some((d) => d.severity === "info" || d.severity === "warning")).toBe(true);
  });

  it("reports one diagnostic per dangling reference and no duplicates", () => {
    const model = withPopulationViolation();
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: "r-bad", id: "c-bad" });

    const invalid = new ValidationEngine().validate(model)
      .filter((d) => d.ruleId === RULE_ID.mandatoryInvalidRole);

    // Both `referenceDiagnostics` and `constraintConsistency` can emit
    // this id. Exactly one does, because the second only runs when the
    // graph built.
    expect(invalid).toHaveLength(1);
  });

  it("still reports the reference-free structural findings when the graph fails", () => {
    const model = withPopulationViolation();
    // A binary fact type with one reading, which nothing about the
    // dangling id below affects.
    model.addFactType({
      name: "Order has Code",
      roles: [
        { name: "has", playerId: model.objectTypes[1]!.id },
        { name: "is of", playerId: model.objectTypes[0]!.id },
      ],
      readings: ["{0} has {1}"],
    });
    model.factTypes[0]!.addConstraint({ type: "mandatory", roleId: "r-bad", id: "c-bad" });

    const ruleIds = new ValidationEngine().validate(model).map((d) => d.ruleId);

    expect(ruleIds).toContain(RULE_ID.mandatoryInvalidRole);
    // Reference-free: reported despite the graph failing. Before the
    // split this warning vanished from `barwise validate` output the
    // moment any id in the file dangled.
    expect(ruleIds).toContain(RULE_ID.binaryMissingInverseReading);
  });

  it("still reports a role of another fact type, which resolves but is not local", () => {
    const model = withPopulationViolation();
    const other = model.addFactType({
      name: "Order has Code",
      roles: [
        { name: "has", playerId: model.objectTypes[1]!.id },
        { name: "is of", playerId: model.objectTypes[0]!.id },
      ],
      readings: ["{0} has {1}", "{1} is of {0}"],
    });
    model.factTypes[0]!.addConstraint({
      type: "mandatory",
      roleId: other.roles[0]!.id,
      id: "c-foreign",
    });

    const diagnostics = new ValidationEngine().validate(model);

    // The graph resolves it, so this is a locality finding, not a
    // reference one -- and the population rules still run.
    expect(diagnostics.map((d) => d.ruleId)).toContain(RULE_ID.mandatoryInvalidRole);
    expect(diagnostics.some((d) => d.ruleId.startsWith("population/"))).toBe(true);
  });
});
