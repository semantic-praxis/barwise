/**
 * Tests for Phase 1 constraint consistency rules.
 *
 * These rules verify that constraint role references actually exist in
 * the fact type they are attached to. A dangling constraint reference
 * (e.g. uniqueness referencing role "r999" when only "r1" and "r2" exist)
 * is an error, while spanning uniqueness across all roles of a multi-role
 * fact type is a warning (it is typically unintended).
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { constraintConsistencyRules } from "../../src/validation/rules/constraintConsistency.js";

/** Builds a binary fact type ("Widget has Color") with the given constraints. */
function buildModelWithConstraints(
  constraints: Array<Record<string, unknown>>,
): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const ot = model.addObjectType({
    name: "Widget",
    kind: "entity",
    referenceMode: "widget_id",
  });
  model.addFactType({
    name: "Widget has Color",
    roles: [
      { name: "has", playerId: ot.id, id: "r1" },
      { name: "of", playerId: ot.id, id: "r2" },
    ],
    readings: ["{0} has {1}", "{1} of {0}"],
    constraints: constraints as never,
  });
  return model;
}

describe("constraintConsistencyRules", () => {
  it("produces no diagnostics for valid constraints", () => {
    const model = buildModelWithConstraints([
      { type: "internal_uniqueness", roleIds: ["r1"] },
      { type: "mandatory", roleId: "r2" },
    ]);

    const diagnostics = constraintConsistencyRules(model);
    expect(diagnostics).toHaveLength(0);
  });

  it("produces no diagnostics for a model with no fact types", () => {
    const model = new OrmModel({ name: "Empty" });
    const diagnostics = constraintConsistencyRules(model);
    expect(diagnostics).toHaveLength(0);
  });

  describe("internal uniqueness", () => {
    it("detects a role id not in the fact type", () => {
      const model = buildModelWithConstraints([
        { type: "internal_uniqueness", roleIds: ["r999"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/internal-uniqueness-invalid-role",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe("error");
      expect(errors[0]!.message).toContain("r999");
    });

    it("detects multiple invalid role ids", () => {
      const model = buildModelWithConstraints([
        { type: "internal_uniqueness", roleIds: ["r999", "r888"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/internal-uniqueness-invalid-role",
      );
      expect(errors).toHaveLength(2);
    });

    it("warns when uniqueness spans all roles of a multi-role fact type", () => {
      const model = buildModelWithConstraints([
        { type: "internal_uniqueness", roleIds: ["r1", "r2"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const warnings = diagnostics.filter(
        (d) => d.ruleId === "constraint/spanning-all-roles",
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe("warning");
    });

    it("does not warn when uniqueness spans a subset of roles", () => {
      const model = buildModelWithConstraints([
        { type: "internal_uniqueness", roleIds: ["r1"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const warnings = diagnostics.filter(
        (d) => d.ruleId === "constraint/spanning-all-roles",
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("mandatory", () => {
    it("detects a role id not in the fact type", () => {
      const model = buildModelWithConstraints([
        { type: "mandatory", roleId: "r999" },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/mandatory-invalid-role",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe("error");
      expect(errors[0]!.message).toContain("r999");
    });

    it("passes for a valid mandatory constraint", () => {
      const model = buildModelWithConstraints([
        { type: "mandatory", roleId: "r1" },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/mandatory-invalid-role",
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe("value constraint", () => {
    it("detects a role id not in the fact type", () => {
      const model = buildModelWithConstraints([
        { type: "value_constraint", roleId: "r999", values: ["X"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/value-constraint-invalid-role",
      );
      expect(errors).toHaveLength(1);
      expect(errors[0]!.severity).toBe("error");
    });

    it("passes for a value constraint without role id", () => {
      const model = buildModelWithConstraints([
        { type: "value_constraint", values: ["X", "Y"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/value-constraint-invalid-role",
      );
      expect(errors).toHaveLength(0);
    });

    it("passes for a value constraint with a valid role id", () => {
      const model = buildModelWithConstraints([
        { type: "value_constraint", roleId: "r1", values: ["X"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const errors = diagnostics.filter(
        (d) => d.ruleId === "constraint/value-constraint-invalid-role",
      );
      expect(errors).toHaveLength(0);
    });
  });

  describe("external uniqueness", () => {
    it("warns when all roles are local to the fact type", () => {
      const model = buildModelWithConstraints([
        { type: "external_uniqueness", roleIds: ["r1", "r2"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const warnings = diagnostics.filter(
        (d) => d.ruleId === "constraint/external-uniqueness-all-local",
      );
      expect(warnings).toHaveLength(1);
      expect(warnings[0]!.severity).toBe("warning");
    });

    it("does not warn when some roles are from other fact types", () => {
      const model = buildModelWithConstraints([
        { type: "external_uniqueness", roleIds: ["r1", "r-other"] },
      ]);

      const diagnostics = constraintConsistencyRules(model);
      const warnings = diagnostics.filter(
        (d) => d.ruleId === "constraint/external-uniqueness-all-local",
      );
      expect(warnings).toHaveLength(0);
    });
  });

  describe("cardinality constraints", () => {
    it("flags a cardinality constraint on a non-unary fact type", () => {
      const model = buildModelWithConstraints([
        { type: "cardinality", roleId: "r1", min: 0, max: 5 },
      ]);

      const diags = constraintConsistencyRules(model);
      expect(diags.some((d) => d.ruleId === "constraint/cardinality-non-unary")).toBe(true);
    });

    it("accepts a cardinality constraint on a unary fact type", () => {
      const model = new OrmModel({ name: "Test" });
      const promo = model.addObjectType({
        name: "Promotion",
        kind: "entity",
        referenceMode: "promo_id",
      });
      model.addFactType({
        name: "Promotion is active",
        roles: [{ name: "is active", playerId: promo.id, id: "p1" }],
        readings: ["{0} is active"],
        constraints: [{ type: "cardinality", roleId: "p1", min: 0, max: 10 }],
      });

      const diags = constraintConsistencyRules(model);
      expect(diags.filter((d) => d.ruleId.startsWith("constraint/cardinality"))).toHaveLength(0);
    });
  });
});
