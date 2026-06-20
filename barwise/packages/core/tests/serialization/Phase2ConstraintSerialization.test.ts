/**
 * Tests for Phase 2 constraint serialization round-trips.
 *
 * Each Phase 2 constraint type (disjunctive mandatory, exclusion,
 * exclusive-or, subset, equality, ring, frequency) is built into a
 * model, serialized to YAML, deserialized, and checked for structural
 * equivalence. This ensures the YAML format faithfully preserves the
 * richer constraint semantics added in Phase 2.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const serializer = new OrmYamlSerializer();

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

function roundTrip(constraint: Constraint): Constraint {
  const model = buildModelWithConstraint(constraint);
  const yaml = serializer.serialize(model);
  const deserialized = serializer.deserialize(yaml);
  const ft = deserialized.factTypes[0]!;
  return ft.constraints[0]!;
}

describe("Phase 2 constraint serialization round-trip", () => {
  it("round-trips disjunctive mandatory", () => {
    const c = roundTrip({ type: "disjunctive_mandatory", roleIds: ["r1", "r2"] });
    expect(c.type).toBe("disjunctive_mandatory");
    expect((c as { roleIds: string[]; }).roleIds).toEqual(["r1", "r2"]);
  });

  it("round-trips exclusion", () => {
    const c = roundTrip({ type: "exclusion", roleIds: ["r1", "r2"] });
    expect(c.type).toBe("exclusion");
    expect((c as { roleIds: string[]; }).roleIds).toEqual(["r1", "r2"]);
  });

  it("round-trips exclusive-or", () => {
    const c = roundTrip({ type: "exclusive_or", roleIds: ["r1", "r2"] });
    expect(c.type).toBe("exclusive_or");
    expect((c as { roleIds: string[]; }).roleIds).toEqual(["r1", "r2"]);
  });

  it("round-trips subset", () => {
    const c = roundTrip({ type: "subset", subsetRoleIds: ["r1"], supersetRoleIds: ["r2"] });
    expect(c.type).toBe("subset");
    expect((c as { subsetRoleIds: string[]; }).subsetRoleIds).toEqual(["r1"]);
    expect((c as { supersetRoleIds: string[]; }).supersetRoleIds).toEqual(["r2"]);
  });

  it("round-trips equality", () => {
    const c = roundTrip({ type: "equality", roleIds1: ["r1"], roleIds2: ["r2"] });
    expect(c.type).toBe("equality");
    expect((c as { roleIds1: string[]; }).roleIds1).toEqual(["r1"]);
    expect((c as { roleIds2: string[]; }).roleIds2).toEqual(["r2"]);
  });

  it("round-trips ring", () => {
    const c = roundTrip({ type: "ring", roleId1: "r1", roleId2: "r2", ringType: "irreflexive" });
    expect(c.type).toBe("ring");
    expect((c as { roleId1: string; }).roleId1).toBe("r1");
    expect((c as { roleId2: string; }).roleId2).toBe("r2");
    expect((c as { ringType: string; }).ringType).toBe("irreflexive");
  });

  it("round-trips frequency with numeric max", () => {
    const c = roundTrip({ type: "frequency", roleIds: ["r1"], min: 2, max: 5 });
    expect(c.type).toBe("frequency");
    expect((c as { min: number; }).min).toBe(2);
    expect((c as { max: number; }).max).toBe(5);
  });

  it("round-trips frequency with unbounded max", () => {
    const c = roundTrip({ type: "frequency", roleIds: ["r1"], min: 1, max: "unbounded" });
    expect(c.type).toBe("frequency");
    expect((c as { min: number; }).min).toBe(1);
    expect((c as { max: string; }).max).toBe("unbounded");
  });

  it("emits the legacy `role:` key for a single-role frequency", () => {
    const yaml = serializer.serialize(
      buildModelWithConstraint({ type: "frequency", roleIds: ["r1"], min: 2, max: 5 }),
    );
    // Only a single-role frequency constraint emits the `role:` key.
    expect(yaml).toContain("role: r1");
  });

  it("round-trips a multi-role frequency (no single-role `role:` key)", () => {
    const yaml = serializer.serialize(
      buildModelWithConstraint({ type: "frequency", roleIds: ["r1", "r2"], min: 1, max: 1 }),
    );
    // The multi-role form uses a `roles:` list, not the legacy `role:` key.
    expect(yaml).not.toContain("role: r1");

    const c = serializer.deserialize(yaml).factTypes[0]!.constraints[0]!;
    expect(c.type).toBe("frequency");
    expect((c as { roleIds: string[]; }).roleIds).toEqual(["r1", "r2"]);
  });
});
