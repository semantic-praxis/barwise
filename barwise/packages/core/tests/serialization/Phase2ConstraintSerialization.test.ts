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
import { type Constraint, isInternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const serializer = new OrmYamlSerializer();
/** The two roles, by format 4.0 role ids. */
const R1 = "Person_drives_Car.drives";
const R2 = "Person_drives_Car.is_driven_by";

function buildModelWithConstraint(constraint: Constraint): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const ot1 = model.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
  const ot2 = model.addObjectType({ name: "Car", kind: "entity", referenceMode: "car_id" });
  model.addFactType({
    name: "Person drives Car",
    roles: [
      { id: R1, name: "drives", playerId: ot1.id },
      { id: R2, name: "is driven by", playerId: ot2.id },
    ],
    readings: ["{0} drives {1}"],
    constraints: isInternalConstraint(constraint) ? [constraint] : [],
  });
  if (!isInternalConstraint(constraint)) model.addConstraint(constraint);
  return model;
}

function roundTrip(constraint: Constraint): Constraint {
  const model = buildModelWithConstraint(constraint);
  const yaml = serializer.serialize(model);
  const deserialized = serializer.deserialize(yaml);
  const ft = deserialized.factTypes[0]!;
  return deserialized.constraintsTouching(ft.id)[0]!;
}

describe("Phase 2 constraint serialization round-trip", () => {
  it("round-trips disjunctive mandatory", () => {
    const c = roundTrip({ type: "disjunctive_mandatory", roleIds: [R1, R2] });
    expect(c.type).toBe("disjunctive_mandatory");
    expect((c as { roleIds: string[]; }).roleIds).toEqual([R1, R2]);
  });

  it("round-trips exclusion", () => {
    const c = roundTrip({ type: "exclusion", roleIds: [R1, R2] });
    expect(c.type).toBe("exclusion");
    expect((c as { roleIds: string[]; }).roleIds).toEqual([R1, R2]);
  });

  it("round-trips exclusive-or", () => {
    const c = roundTrip({ type: "exclusive_or", roleIds: [R1, R2] });
    expect(c.type).toBe("exclusive_or");
    expect((c as { roleIds: string[]; }).roleIds).toEqual([R1, R2]);
  });

  it("round-trips subset", () => {
    const c = roundTrip({ type: "subset", subsetRoleIds: [R1], supersetRoleIds: [R2] });
    expect(c.type).toBe("subset");
    expect((c as { subsetRoleIds: string[]; }).subsetRoleIds).toEqual([R1]);
    expect((c as { supersetRoleIds: string[]; }).supersetRoleIds).toEqual([R2]);
  });

  it("round-trips equality", () => {
    const c = roundTrip({ type: "equality", roleIds1: [R1], roleIds2: [R2] });
    expect(c.type).toBe("equality");
    expect((c as { roleIds1: string[]; }).roleIds1).toEqual([R1]);
    expect((c as { roleIds2: string[]; }).roleIds2).toEqual([R2]);
  });

  it("round-trips ring", () => {
    const c = roundTrip({ type: "ring", roleId1: R1, roleId2: R2, ringType: "irreflexive" });
    expect(c.type).toBe("ring");
    expect((c as { roleId1: string; }).roleId1).toBe(R1);
    expect((c as { roleId2: string; }).roleId2).toBe(R2);
    expect((c as { ringType: string; }).ringType).toBe("irreflexive");
  });

  it("round-trips frequency with numeric max", () => {
    const c = roundTrip({ type: "frequency", roleIds: [R1], min: 2, max: 5 });
    expect(c.type).toBe("frequency");
    expect((c as { min: number; }).min).toBe(2);
    expect((c as { max: number; }).max).toBe(5);
  });

  it("round-trips frequency with unbounded max", () => {
    const c = roundTrip({ type: "frequency", roleIds: [R1], min: 1, max: "unbounded" });
    expect(c.type).toBe("frequency");
    expect((c as { min: number; }).min).toBe(1);
    expect((c as { max: string; }).max).toBe("unbounded");
  });

  it("emits the legacy `role:` key for a single-role frequency", () => {
    const yaml = serializer.serialize(
      buildModelWithConstraint({ type: "frequency", roleIds: [R1], min: 2, max: 5 }),
    );
    // Only a single-role frequency constraint emits the `role:` key.
    expect(yaml).toContain(`role: ${R1}`);
  });

  it("round-trips a multi-role frequency (no single-role `role:` key)", () => {
    const yaml = serializer.serialize(
      buildModelWithConstraint({ type: "frequency", roleIds: [R1, R2], min: 1, max: 1 }),
    );
    // The multi-role form uses a `roles:` list, not the legacy `role:` key.
    expect(yaml).not.toContain(`role: ${R1}`);

    const c = serializer.deserialize(yaml).factTypes[0]!.internalConstraints[0]!;
    expect(c.type).toBe("frequency");
    expect((c as { roleIds: string[]; }).roleIds).toEqual([R1, R2]);
  });
});
