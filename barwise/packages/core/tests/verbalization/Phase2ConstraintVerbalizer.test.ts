/**
 * Tests for Phase 2 constraint verbalization.
 *
 * Phase 2 constraints produce more complex natural-language sentences:
 *   - Disjunctive mandatory: "Each X ... or ..."
 *   - Exclusion / exclusive-or: "... but not both"
 *   - Subset / equality: "If ... then ..."
 *   - Ring (irreflexive, asymmetric, etc.): "No X ... that same X"
 *   - Frequency: "at least N and at most M times"
 *
 * The "fallback paths" section tests defensive code that fires when
 * constraint role references cannot be resolved against the fact type --
 * important because LLM-generated constraints may have mismatched IDs.
 */
import { describe, expect, it } from "vitest";
import type { Constraint } from "../../src/model/Constraint.js";
import type { FactType } from "../../src/model/FactType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";

const verbalizer = new ConstraintVerbalizer();

function buildBinaryModel(): { model: OrmModel; ft: FactType; } {
  const model = new OrmModel({ name: "Test" });
  const customer = model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  const order = model.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_id" });
  const ft = model.addFactType({
    name: "Customer places Order",
    roles: [
      { id: "r1", name: "places", playerId: customer.id },
      { id: "r2", name: "is placed by", playerId: order.id },
    ],
    readings: ["{0} places {1}", "{1} is placed by {0}"],
    constraints: [],
  });
  return { model, ft };
}

function buildSelfRefModel(): { model: OrmModel; ft: FactType; } {
  const model = new OrmModel({ name: "Test" });
  const person = model.addObjectType({
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });
  const ft = model.addFactType({
    name: "Person is parent of Person",
    roles: [
      { id: "r1", name: "is parent of", playerId: person.id },
      { id: "r2", name: "is child of", playerId: person.id },
    ],
    readings: ["{0} is parent of {1}"],
    constraints: [],
  });
  return { model, ft };
}

describe("Phase 2 constraint verbalization", () => {
  it("verbalizes disjunctive mandatory", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "disjunctive_mandatory", roleIds: ["r1", "r2"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("Each");
    expect(v.text).toContain("or");
    expect(v.category).toBe("constraint");
  });

  it("verbalizes exclusion", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "exclusion", roleIds: ["r1", "r2"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("No");
    expect(v.text).toContain("both");
    expect(v.text).toContain("and");
  });

  it("verbalizes exclusive-or", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "exclusive_or", roleIds: ["r1", "r2"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("Each");
    expect(v.text).toContain("either");
    expect(v.text).toContain("but not both");
  });

  it("verbalizes subset", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "subset", subsetRoleIds: ["r1"], supersetRoleIds: ["r2"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("If");
    expect(v.text).toContain("then");
  });

  it("verbalizes equality", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "equality", roleIds1: ["r1"], roleIds2: ["r2"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("if and only if");
  });

  it("verbalizes ring (irreflexive)", () => {
    const { model, ft } = buildSelfRefModel();
    const c: Constraint = { type: "ring", roleId1: "r1", roleId2: "r2", ringType: "irreflexive" };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("No");
    expect(v.text).toContain("Person");
    expect(v.text).toContain("that same");
  });

  it("verbalizes ring (asymmetric)", () => {
    const { model, ft } = buildSelfRefModel();
    const c: Constraint = { type: "ring", roleId1: "r1", roleId2: "r2", ringType: "asymmetric" };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("If");
    expect(v.text).toContain("does not");
  });

  it("verbalizes ring (other types)", () => {
    const { model, ft } = buildSelfRefModel();
    const c: Constraint = { type: "ring", roleId1: "r1", roleId2: "r2", ringType: "acyclic" };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("Acyclic:");
  });

  it("verbalizes frequency with range", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 2, max: 5 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("at least 2 and at most 5");
    expect(v.text).toContain("Customer");
  });

  it("verbalizes frequency unbounded", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 3, max: "unbounded" };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("at least 3");
    expect(v.text).not.toContain("at most");
  });

  it("verbalizes frequency with exact count", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 3, max: 3 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("exactly 3");
  });

  it("verbalizes frequency on a non-binary fact type", () => {
    const model = new OrmModel({ name: "Test" });
    const emp = model.addObjectType({ name: "Employee", kind: "entity", referenceMode: "emp_id" });
    const proj = model.addObjectType({ name: "Project", kind: "entity", referenceMode: "proj_id" });
    const dept = model.addObjectType({
      name: "Department",
      kind: "entity",
      referenceMode: "dept_id",
    });
    const ft = model.addFactType({
      name: "Employee works on Project in Department",
      roles: [
        { id: "r1", name: "works on", playerId: emp.id },
        { id: "r2", name: "has worker", playerId: proj.id },
        { id: "r3", name: "in", playerId: dept.id },
      ],
      readings: ["{0} works on {1} in {2}"],
    });

    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 2, max: 5 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("at least 2 and at most 5 times");
    expect(v.text).toContain("Employee");
  });

  it("verbalizes a multi-role (role-sequence) frequency as a combination", () => {
    const model = new OrmModel({ name: "Test" });
    const room = model.addObjectType({ name: "Room", kind: "entity", referenceMode: "room_id" });
    const slot = model.addObjectType({
      name: "TimeSlot",
      kind: "entity",
      referenceMode: "slot_id",
    });
    const ft = model.addFactType({
      name: "Room is booked for TimeSlot",
      roles: [
        { id: "r1", name: "is booked for", playerId: room.id },
        { id: "r2", name: "books", playerId: slot.id },
      ],
      readings: ["{0} is booked for {1}"],
    });

    const c: Constraint = { type: "frequency", roleIds: ["r1", "r2"], min: 1, max: 1 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe("Each combination of Room, TimeSlot occurs exactly 1 time.");
  });

  it("verbalizes frequency unbounded on a non-binary fact type", () => {
    const model = new OrmModel({ name: "Test" });
    const a = model.addObjectType({ name: "A", kind: "entity", referenceMode: "a_id" });
    const b = model.addObjectType({ name: "B", kind: "entity", referenceMode: "b_id" });
    const c_ot = model.addObjectType({ name: "C", kind: "entity", referenceMode: "c_id" });
    const ft = model.addFactType({
      name: "A relates B and C",
      roles: [
        { id: "r1", name: "relates", playerId: a.id },
        { id: "r2", name: "is related", playerId: b.id },
        { id: "r3", name: "with", playerId: c_ot.id },
      ],
      readings: ["{0} relates {1} with {2}"],
    });

    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 1, max: "unbounded" };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("at least 1 times");
  });

  it("verbalizes frequency exact on a non-binary fact type", () => {
    const model = new OrmModel({ name: "Test" });
    const a = model.addObjectType({ name: "A", kind: "entity", referenceMode: "a_id" });
    const b = model.addObjectType({ name: "B", kind: "entity", referenceMode: "b_id" });
    const c_ot = model.addObjectType({ name: "C", kind: "entity", referenceMode: "c_id" });
    const ft = model.addFactType({
      name: "A relates B and C",
      roles: [
        { id: "r1", name: "relates", playerId: a.id },
        { id: "r2", name: "is related", playerId: b.id },
        { id: "r3", name: "with", playerId: c_ot.id },
      ],
      readings: ["{0} relates {1} with {2}"],
    });

    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 2, max: 2 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("exactly 2 times");
  });

  describe("fallback paths", () => {
    it("resolveCommonPlayer returns fallback for invalid role ids", () => {
      const { model, ft } = buildBinaryModel();
      // Disjunctive mandatory referencing nonexistent role ids.
      const c: Constraint = { type: "disjunctive_mandatory", roleIds: ["bogus1", "bogus2"] };
      const v = verbalizer.verbalize(c, ft, model);
      // Should fall through to the default "Object" name.
      expect(v.text).toContain("Object");
    });

    it("extractPredicate uses fallback when reading order does not match subject/object", () => {
      // Build a fact type where the reading template has {1} before {0}.
      const model = new OrmModel({ name: "Test" });
      const a = model.addObjectType({ name: "Alpha", kind: "entity", referenceMode: "a_id" });
      const b = model.addObjectType({ name: "Beta", kind: "entity", referenceMode: "b_id" });
      const ft = model.addFactType({
        name: "Alpha and Beta",
        roles: [
          { id: "r1", name: "role1", playerId: a.id },
          { id: "r2", name: "role2", playerId: b.id },
        ],
        // Only an inverse reading (object before subject).
        readings: ["{1} is linked from {0}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
        ],
      });

      // This triggers extractPredicate with subjectIdx=0 and objectIdx=1,
      // but the reading has {1} before {0}, so the primary path fails.
      // The fallback extracts the predicate between the two placeholders.
      const v = verbalizer.verbalizeAll(ft, model);
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBeDefined();
    });
  });
});
