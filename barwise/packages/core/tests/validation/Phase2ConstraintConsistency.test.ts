/**
 * Tests for Phase 2 constraint consistency rules.
 *
 * Phase 2 constraints (disjunctive mandatory, exclusion, exclusive-or,
 * subset, equality, ring, frequency) have richer validation requirements
 * than Phase 1 constraints. These tests verify:
 *   - Role-id validity for multi-role constraints (ring, disjunctive mandatory)
 *   - Frequency bounds (min >= 1, max >= min)
 *   - Ring constraints requiring a self-referencing fact type
 *   - Subset/equality role-set matching
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { constraintConsistencyRules } from "../../src/validation/rules/constraintConsistency.js";

/**
 * Builds a binary "Person drives Car" model with one attached constraint.
 * Roles are "r1" (Person) and "r2" (Car), so constraints can reference
 * either by ID.
 */
function buildModelWithConstraint(constraint: Constraint): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const ot1 = model.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
  const ot2 = model.addObjectType({ name: "Car", kind: "entity", referenceMode: "car_id" });
  model.addFactType({
    name: "Person drives Car",
    roles: [
      { id: "r1", name: "drives", playerId: ot1.id },
      { id: "r2", name: "is driven by", playerId: ot2.id },
    ],
    readings: ["{0} drives {1}"],
    constraints: [constraint],
  });
  return model;
}

/**
 * Builds a self-referencing "Person is parent of Person" model with one
 * attached constraint. Both roles share the same player, which is required
 * for ring constraints.
 */
function buildSelfRefModel(constraint: Constraint): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const ot = model.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
  model.addFactType({
    name: "Person is parent of Person",
    roles: [
      { id: "r1", name: "is parent of", playerId: ot.id },
      { id: "r2", name: "is child of", playerId: ot.id },
    ],
    readings: ["{0} is parent of {1}"],
    constraints: [constraint],
  });
  return model;
}

describe("Phase 2 constraint consistency rules", () => {
  // -- Disjunctive mandatory --

  it("disjunctive mandatory with 2+ roles passes", () => {
    const model = buildModelWithConstraint({
      type: "disjunctive_mandatory",
      roleIds: ["r1", "r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("disjunctive mandatory with <2 roles fails", () => {
    const model = buildModelWithConstraint({
      type: "disjunctive_mandatory",
      roleIds: ["r1"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("constraint/disjunctive-mandatory-too-few-roles");
  });

  // -- Exclusion --

  it("exclusion with 2+ roles passes", () => {
    const model = buildModelWithConstraint({
      type: "exclusion",
      roleIds: ["r1", "r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("exclusion with <2 roles fails", () => {
    const model = buildModelWithConstraint({
      type: "exclusion",
      roleIds: ["r1"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("constraint/exclusion-too-few-roles");
  });

  // -- Exclusive or --

  it("exclusive-or with 2+ roles passes", () => {
    const model = buildModelWithConstraint({
      type: "exclusive_or",
      roleIds: ["r1", "r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("exclusive-or with <2 roles fails", () => {
    const model = buildModelWithConstraint({
      type: "exclusive_or",
      roleIds: ["r1"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("constraint/exclusive-or-too-few-roles");
  });

  // -- Subset --

  it("subset with matched arity passes", () => {
    const model = buildModelWithConstraint({
      type: "subset",
      subsetRoleIds: ["r1"],
      supersetRoleIds: ["r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("subset with mismatched arity fails", () => {
    const model = buildModelWithConstraint({
      type: "subset",
      subsetRoleIds: ["r1"],
      supersetRoleIds: ["r1", "r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("constraint/subset-arity-mismatch");
  });

  // -- Equality --

  it("equality with matched arity passes", () => {
    const model = buildModelWithConstraint({
      type: "equality",
      roleIds1: ["r1"],
      roleIds2: ["r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("equality with mismatched arity fails", () => {
    const model = buildModelWithConstraint({
      type: "equality",
      roleIds1: ["r1"],
      roleIds2: ["r1", "r2"],
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(1);
    expect(diags[0]!.ruleId).toBe("constraint/equality-arity-mismatch");
  });

  // -- Ring --

  it("ring with valid roles and same player passes", () => {
    const model = buildSelfRefModel({
      type: "ring",
      roleId1: "r1",
      roleId2: "r2",
      ringType: "irreflexive",
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("ring with invalid role id fails", () => {
    const model = buildSelfRefModel({
      type: "ring",
      roleId1: "r1",
      roleId2: "bogus",
      ringType: "asymmetric",
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/ring-invalid-role")).toBe(true);
  });

  it("ring with different players fails", () => {
    const model = buildModelWithConstraint({
      type: "ring",
      roleId1: "r1",
      roleId2: "r2",
      ringType: "irreflexive",
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/ring-different-players")).toBe(true);
  });

  // -- Frequency --

  it("frequency with valid role and min <= max passes", () => {
    const model = buildModelWithConstraint({
      type: "frequency",
      roleIds: ["r1"],
      min: 2,
      max: 5,
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("frequency with unbounded max passes", () => {
    const model = buildModelWithConstraint({
      type: "frequency",
      roleIds: ["r1"],
      min: 1,
      max: "unbounded",
    });
    const diags = constraintConsistencyRules(model);
    expect(diags).toHaveLength(0);
  });

  it("frequency with invalid role fails", () => {
    const model = buildModelWithConstraint({
      type: "frequency",
      roleIds: ["bogus"],
      min: 1,
      max: 3,
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/frequency-invalid-role")).toBe(true);
  });

  it("frequency with max < min fails", () => {
    const model = buildModelWithConstraint({
      type: "frequency",
      roleIds: ["r1"],
      min: 5,
      max: 2,
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/frequency-max-less-than-min")).toBe(true);
  });

  it("ring with invalid roleId1 fails", () => {
    const model = buildSelfRefModel({
      type: "ring",
      roleId1: "bogus",
      roleId2: "r2",
      ringType: "irreflexive",
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/ring-invalid-role")).toBe(true);
    expect(diags.some((d) => d.message.includes('"bogus"'))).toBe(true);
  });

  it("ring with both role ids invalid fails with two diagnostics", () => {
    const model = buildSelfRefModel({
      type: "ring",
      roleId1: "bogus1",
      roleId2: "bogus2",
      ringType: "asymmetric",
    });
    const diags = constraintConsistencyRules(model);
    const ringDiags = diags.filter((d) => d.ruleId === "constraint/ring-invalid-role");
    expect(ringDiags).toHaveLength(2);
  });

  it("frequency with min < 1 fails", () => {
    const model = buildModelWithConstraint({
      type: "frequency",
      roleIds: ["r1"],
      min: 0,
      max: 3,
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/frequency-invalid-min")).toBe(true);
    expect(diags.some((d) => d.message.includes("min 0"))).toBe(true);
  });

  it("frequency with negative min fails", () => {
    const model = buildModelWithConstraint({
      type: "frequency",
      roleIds: ["r1"],
      min: -1,
      max: 5,
    });
    const diags = constraintConsistencyRules(model);
    expect(diags.some((d) => d.ruleId === "constraint/frequency-invalid-min")).toBe(true);
  });
});
