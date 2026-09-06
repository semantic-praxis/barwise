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
import type { Constraint, ValueComparisonOperator } from "../../src/model/Constraint.js";
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

/** A ternary fact type, for constraints spanning three roles. */
function buildTernaryModel(): { model: OrmModel; ft: FactType; } {
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

  it("verbalizes disjunctive mandatory across three roles with a comma-separated middle item", () => {
    const { model, ft } = buildTernaryModel();
    const c: Constraint = { type: "disjunctive_mandatory", roleIds: ["r1", "r2", "r3"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe(
      "Each Employee works on some Employee, has worker some Project or in some Department.",
    );
  });

  it("verbalizes exclusion across three roles with a comma-separated middle item", () => {
    const { model, ft } = buildTernaryModel();
    const c: Constraint = { type: "exclusion", roleIds: ["r1", "r2", "r3"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe(
      "No Employee both works on some Employee, has worker some Project and in some Department.",
    );
  });

  it("verbalizes exclusive-or across three roles with a comma-separated middle item", () => {
    const { model, ft } = buildTernaryModel();
    const c: Constraint = { type: "exclusive_or", roleIds: ["r1", "r2", "r3"] };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe(
      "Each Employee either works on some Employee, has worker some Project or in some Department"
        + " but not both.",
    );
  });

  it("verbalizes subset over multi-role sides, spacing roles after the first", () => {
    const { model, ft } = buildTernaryModel();
    const c: Constraint = {
      type: "subset",
      subsetRoleIds: ["r1", "r2"],
      supersetRoleIds: ["r2", "r3"],
    };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe("If Employee Project then Project Department.");
  });

  it("verbalizes equality over multi-role sides, spacing roles after the first", () => {
    const { model, ft } = buildTernaryModel();
    const c: Constraint = {
      type: "equality",
      roleIds1: ["r1", "r2"],
      roleIds2: ["r2", "r3"],
    };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe("Employee Project if and only if Project Department.");
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

  it("verbalizes ring with an unresolved role id, falling back to the raw id", () => {
    const { model, ft } = buildSelfRefModel();
    const c: Constraint = {
      type: "ring",
      roleId1: "bogus",
      roleId2: "r2",
      ringType: "irreflexive",
    };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe("No bogus is parent of that same bogus.");
  });

  it("verbalizes a ring constraint on a non-binary fact type with a generic '...' predicate", () => {
    const { model, ft } = buildTernaryModel();
    const c: Constraint = { type: "ring", roleId1: "r1", roleId2: "r2", ringType: "irreflexive" };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toBe("No Employee ... that same Employee.");
  });

  it("verbalizes frequency with range", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "frequency", roleIds: ["r1"], min: 2, max: 5 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("at least 2 and at most 5");
    expect(v.text).toContain("Customer");
  });

  it("verbalizes frequency naming the role at index 1 as the subject", () => {
    const { model, ft } = buildBinaryModel();
    const c: Constraint = { type: "frequency", roleIds: ["r2"], min: 1, max: 1 };
    const v = verbalizer.verbalize(c, ft, model);
    expect(v.text).toContain("Each Order");
    expect(v.text).toContain("Customer");
  });

  it("verbalizes frequency falling back to the role name when the player type is not in the model", () => {
    const model = new OrmModel({ name: "Test" });
    const customer = model.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
    });
    const ft = model.addFactType(
      {
        name: "Customer places Order",
        roles: [
          { id: "r1", name: "places", playerId: customer.id },
          { id: "r2", name: "is placed by", playerId: "missing-order-type" },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
        constraints: [
          { type: "frequency", roleIds: ["r1"], min: 1, max: 2 },
        ],
      },
      { skipPlayerValidation: true },
    );

    const v = verbalizer.verbalizeAll(ft, model);
    expect(v[0]!.text).toContain("is placed by");
    expect(v[0]!.text).toContain("at least 1 and at most 2");
  });

  it("verbalizes frequency falling back to the subject role's name when its player type is missing", () => {
    const model = new OrmModel({ name: "Test" });
    const order = model.addObjectType({ name: "Order", kind: "entity", referenceMode: "order_id" });
    const ft = model.addFactType(
      {
        name: "Customer places Order",
        roles: [
          { id: "r1", name: "places", playerId: "missing-customer-type" },
          { id: "r2", name: "is placed by", playerId: order.id },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
        constraints: [
          { type: "frequency", roleIds: ["r1"], min: 1, max: 2 },
        ],
      },
      { skipPlayerValidation: true },
    );

    const v = verbalizer.verbalizeAll(ft, model);
    expect(v[0]!.text).toContain("places");
    expect(v[0]!.text).toContain("Order");
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

    it("exclusion falls back to the raw role id when a role does not resolve", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = { type: "exclusion", roleIds: ["bogus", "r1"] };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("No Customer both bogus some bogus and places some Customer.");
    });

    it("subset falls back to the role name, then the raw id, for an unresolved role", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = {
        type: "subset",
        subsetRoleIds: ["r1"],
        supersetRoleIds: ["bogus"],
      };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("If Customer then bogus.");
    });

    it("subset falls back for an unresolved role on the subset (antecedent) side", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = {
        type: "subset",
        subsetRoleIds: ["bogus"],
        supersetRoleIds: ["r1"],
      };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("If bogus then Customer.");
    });

    it("equality falls back to the role name, then the raw id, for an unresolved role", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = {
        type: "equality",
        roleIds1: ["bogus"],
        roleIds2: ["r2"],
      };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("bogus if and only if Order.");
    });

    it("equality falls back for an unresolved role on the second side", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = {
        type: "equality",
        roleIds1: ["r1"],
        roleIds2: ["bogus"],
      };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("Customer if and only if bogus.");
    });

    it("verbalizeGenericFrequency falls back to the raw role id when unresolved", () => {
      const { model, ft } = buildTernaryModel();
      const c: Constraint = { type: "frequency", roleIds: ["bogus"], min: 1, max: 3 };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toContain("bogus");
      expect(v.text).toContain("at least 1 and at most 3 times");
    });

    it("multi-role frequency renders an unbounded quantifier", () => {
      const { model, ft } = buildTernaryModel();
      const c: Constraint = { type: "frequency", roleIds: ["r1", "r2"], min: 2, max: "unbounded" };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("Each combination of Employee, Project occurs at least 2 times.");
    });

    it("multi-role frequency renders a min/max range quantifier", () => {
      const { model, ft } = buildTernaryModel();
      const c: Constraint = { type: "frequency", roleIds: ["r1", "r2"], min: 1, max: 3 };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe(
        "Each combination of Employee, Project occurs at least 1 and at most 3 times.",
      );
    });

    it("multi-role frequency falls back to the raw role id for an unresolved role", () => {
      const { model, ft } = buildTernaryModel();
      const c: Constraint = { type: "frequency", roleIds: ["bogus", "r2"], min: 1, max: 1 };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("Each combination of bogus, Project occurs exactly 1 time.");
    });

    it("cardinality falls back to the raw role id for an unresolved role", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = { type: "cardinality", roleId: "bogus", min: 1, max: 5 };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toContain("bogus instances");
    });

    it("value comparison falls back to the raw role ids and the literal operator when unresolved", () => {
      const { model, ft } = buildBinaryModel();
      const c: Constraint = {
        type: "value_comparison",
        roleId1: "bogus1",
        roleId2: "bogus2",
        operator: "!=" as ValueComparisonOperator,
      };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe("bogus1 must be != bogus2.");
    });

    it("cardinalityQuantifier: unbounded, exact, and non-zero-min range", () => {
      const { model, ft } = buildBinaryModel();
      const unbounded = verbalizer.verbalize(
        { type: "cardinality", roleId: "r1", min: 5, max: "unbounded" },
        ft,
        model,
      );
      expect(unbounded.text).toContain("at least 5");

      const exact = verbalizer.verbalize(
        { type: "cardinality", roleId: "r1", min: 3, max: 3 },
        ft,
        model,
      );
      expect(exact.text).toContain("exactly 3");

      const range = verbalizer.verbalize(
        { type: "cardinality", roleId: "r1", min: 2, max: 8 },
        ft,
        model,
      );
      expect(range.text).toContain("at least 2 and at most 8");
    });

    it("unaryPredicate falls back to the reading text with placeholders stripped", () => {
      const model = new OrmModel({ name: "Test" });
      const promo = model.addObjectType({
        name: "Promotion",
        kind: "entity",
        referenceMode: "promo_id",
      });
      const ft = model.addFactType({
        name: "Promotion is active",
        // No text follows the {0} placeholder, so unaryPredicate falls
        // through to stripping placeholders from the whole template.
        roles: [{ name: "is active", playerId: promo.id, id: "p1" }],
        readings: ["Currently active: {0}"],
        constraints: [{ type: "cardinality", roleId: "p1", min: 1, max: 1 }],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v[0]!.text).toContain("'Currently active:' role");
    });

    it("unaryPredicate falls back to the fact type name when the reading is only a placeholder", () => {
      const model = new OrmModel({ name: "Test" });
      const promo = model.addObjectType({
        name: "Promotion",
        kind: "entity",
        referenceMode: "promo_id",
      });
      const ft = model.addFactType({
        name: "Promotion is active",
        roles: [{ name: "is active", playerId: promo.id, id: "p1" }],
        readings: ["{0}"],
        constraints: [{ type: "cardinality", roleId: "p1", min: 1, max: 1 }],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v[0]!.text).toContain("'Promotion is active' role");
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

  describe("join constraints", () => {
    function buildPersonCountry(): { model: OrmModel; ft: FactType; } {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        id: "ot-person",
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const country = model.addObjectType({
        name: "Country",
        kind: "entity",
        referenceMode: "country_code",
      });
      model.addFactType({
        name: "Person was born in Country",
        roles: [
          { name: "was born in", playerId: person.id, id: "pb-person" },
          { name: "is birthplace of", playerId: country.id, id: "pb-country" },
        ],
        readings: ["{0} was born in {1}"],
      });
      const ft = model.addFactType({
        name: "Person is citizen of Country",
        roles: [
          { name: "is citizen of", playerId: person.id, id: "pc-person" },
          { name: "has citizen", playerId: country.id, id: "pc-country" },
        ],
        readings: ["{0} is citizen of {1}"],
      });
      return { model, ft };
    }

    const bornIn = {
      path: { root: "ot-person", steps: [{ entry: "pb-person", exit: "pb-country" }] },
      projection: [0, 1],
    };
    const citizenOf = {
      path: { root: "ot-person", steps: [{ entry: "pc-person", exit: "pc-country" }] },
      projection: [0, 1],
    };

    it("verbalizes join_equality as a same-tuple statement", () => {
      const { model, ft } = buildPersonCountry();
      const c: Constraint = { type: "join_equality", operands: [bornIn, citizenOf] };
      const v = verbalizer.verbalize(c, ft, model);
      expect(v.text).toBe(
        'For each Person, "Person was born in Country" and '
          + '"Person is citizen of Country" project the same [Person, Country].',
      );
    });

    it("verbalizes join_subset and join_exclusion recognizably", () => {
      const { model, ft } = buildPersonCountry();
      const sub = verbalizer.verbalize(
        { type: "join_subset", subset: bornIn, superset: citizenOf },
        ft,
        model,
      );
      expect(sub.text).toContain("For each Person");
      expect(sub.text).toContain("[Person, Country]");
      expect(sub.text).toContain("is among those from");

      const exc = verbalizer.verbalize(
        { type: "join_exclusion", operands: [bornIn, citizenOf] },
        ft,
        model,
      );
      expect(exc.text).toContain("share no [Person, Country]");
    });

    it("falls back to '...' in the path chain when a hop's role does not resolve to a fact type", () => {
      const { model, ft } = buildPersonCountry();
      const danglingHop = {
        path: { root: "ot-person", steps: [{ entry: "bogus-entry", exit: "bogus-exit" }] },
        projection: [0, 1],
      };
      const v = verbalizer.verbalize(
        { type: "join_subset", subset: danglingHop, superset: citizenOf },
        ft,
        model,
      );
      // The dangling hop's chain renders as "...", and its projected tuple
      // falls back to the root type at every unresolved node.
      expect(v.text).toContain('from "..."');
      expect(v.text).toContain("[Person, Person]");
    });

    it("falls back to the raw type id when a path's root does not resolve, for a root-only path", () => {
      const { model, ft } = buildPersonCountry();
      const rootOnly = {
        path: { root: "bogus-root", steps: [] },
        projection: [0],
      };
      const v = verbalizer.verbalize(
        { type: "join_equality", operands: [rootOnly, citizenOf] },
        ft,
        model,
      );
      // No hops: the chain is just the (unresolved) root type id, and the
      // tuple projects that same fallback id.
      expect(v.text).toContain('"bogus-root"');
      expect(v.text).toContain("[bogus-root]");
    });

    it("falls back to the path root when a projection index has no corresponding step", () => {
      const { model, ft } = buildPersonCountry();
      const outOfRange = {
        path: bornIn.path,
        // Index 5 has no step 4 -- pathNodeTypeId should fall back to root.
        projection: [0, 5],
      };
      const v = verbalizer.verbalize(
        { type: "join_equality", operands: [outOfRange, citizenOf] },
        ft,
        model,
      );
      expect(v.text).toContain("[Person, Person]");
    });

    it("falls back to a generic 'object' subject for join_equality/join_exclusion with no operands", () => {
      const { model, ft } = buildPersonCountry();
      const equality = verbalizer.verbalize(
        { type: "join_equality", operands: [] },
        ft,
        model,
      );
      expect(equality.text).toContain("For each object");
      expect(equality.text).toContain("project the same [tuple]");

      const exclusion = verbalizer.verbalize(
        { type: "join_exclusion", operands: [] },
        ft,
        model,
      );
      expect(exclusion.text).toContain("For each object");
      expect(exclusion.text).toContain("share no [tuple]");
    });
  });
});
