/**
 * Tests for population validation rules.
 *
 * Covers:
 *   - Dangling fact type references
 *   - Internal uniqueness constraint violations
 *   - Value constraint violations
 *   - Frequency constraint violations
 *   - Exclusion constraint violations
 *   - Exclusive-or constraint violations
 *   - Subset constraint violations
 *   - Equality constraint violations
 *   - Ring constraint violations (all 8 ring types)
 *   - Valid populations produce no diagnostics
 */
import { describe, expect, it } from "vitest";
import type { ValueRange } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { populationValidationRules } from "../../src/validation/rules/populationValidation.js";

/**
 * Build a model with "Customer places Order" fact type and configurable
 * constraints for testing.
 */
function makeOrderModel(options?: {
  uniqueness?: "role1" | "role2" | "spanning";
  valueConstraint?: { roleId: string; values: string[]; ranges?: ValueRange[]; };
  frequency?: { roleId: string; min: number; max: number | "unbounded"; };
}): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const customer = model.addObjectType({
    name: "Customer",
    kind: "entity",
    referenceMode: "customer_id",
  });
  const order = model.addObjectType({
    name: "Order",
    kind: "entity",
    referenceMode: "order_number",
  });

  const constraints: Parameters<typeof model.addFactType>[0]["constraints"] = [];

  if (options?.uniqueness === "role1") {
    constraints.push({ type: "internal_uniqueness", roleIds: ["r1"] });
  } else if (options?.uniqueness === "role2") {
    constraints.push({ type: "internal_uniqueness", roleIds: ["r2"] });
  } else if (options?.uniqueness === "spanning") {
    constraints.push({
      type: "internal_uniqueness",
      roleIds: ["r1", "r2"],
    });
  }

  if (options?.valueConstraint) {
    constraints.push({
      type: "value_constraint",
      roleId: options.valueConstraint.roleId,
      values: options.valueConstraint.values,
      ...(options.valueConstraint.ranges
        ? { ranges: options.valueConstraint.ranges }
        : {}),
    });
  }

  if (options?.frequency) {
    constraints.push({
      type: "frequency",
      roleId: options.frequency.roleId,
      min: options.frequency.min,
      max: options.frequency.max,
    });
  }

  model.addFactType({
    name: "Customer places Order",
    roles: [
      { name: "places", playerId: customer.id, id: "r1" },
      { name: "is placed by", playerId: order.id, id: "r2" },
    ],
    readings: ["{0} places {1}"],
    constraints,
  });

  return model;
}

describe("populationValidationRules", () => {
  describe("valid populations", () => {
    it("produces no diagnostics for a valid population", () => {
      const model = makeOrderModel({ uniqueness: "role2" });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O124" } });
      pop.addInstance({ roleValues: { r1: "C002", r2: "O125" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });

    it("produces no diagnostics when no populations exist", () => {
      const model = makeOrderModel();
      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });

    it("produces no diagnostics for empty population", () => {
      const model = makeOrderModel({ uniqueness: "role2" });
      const ft = model.getFactTypeByName("Customer places Order")!;
      model.addPopulation({ factTypeId: ft.id });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });
  });

  describe("dangling fact type reference", () => {
    it("reports error for population referencing nonexistent fact type", () => {
      const model = makeOrderModel();
      const ft = model.getFactTypeByName("Customer places Order")!;
      // Add a valid population first, then remove the fact type.
      // Since OrmModel.addPopulation validates, we need to add before removing.
      const pop = model.addPopulation({ factTypeId: ft.id });
      model.removeFactType(ft.id);

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1);
      expect(diags[0]!.ruleId).toBe("population/dangling-fact-type");
      expect(diags[0]!.elementId).toBe(pop.id);
    });
  });

  describe("uniqueness violations", () => {
    it("reports single-role uniqueness violation", () => {
      const model = makeOrderModel({ uniqueness: "role2" });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({
        id: "inst-1",
        roleValues: { r1: "C001", r2: "O123" },
      });
      pop.addInstance({
        id: "inst-2",
        roleValues: { r1: "C002", r2: "O123" },
      }); // Duplicate on r2

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1);
      expect(diags[0]!.ruleId).toBe("population/uniqueness-violation");
      expect(diags[0]!.message).toContain("inst-2");
      expect(diags[0]!.message).toContain("inst-1");
    });

    it("reports spanning uniqueness violation", () => {
      const model = makeOrderModel({ uniqueness: "spanning" });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({
        id: "inst-1",
        roleValues: { r1: "C001", r2: "O123" },
      });
      pop.addInstance({
        id: "inst-2",
        roleValues: { r1: "C001", r2: "O123" },
      }); // Exact duplicate

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1);
      expect(diags[0]!.ruleId).toBe("population/uniqueness-violation");
    });

    it("does not report spanning uniqueness for distinct combinations", () => {
      const model = makeOrderModel({ uniqueness: "spanning" });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O124" } });
      pop.addInstance({ roleValues: { r1: "C002", r2: "O123" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });

    it("reports multiple uniqueness violations", () => {
      const model = makeOrderModel({ uniqueness: "role1" });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "C001", r2: "O123" } });
      pop.addInstance({ id: "inst-2", roleValues: { r1: "C001", r2: "O124" } });
      pop.addInstance({ id: "inst-3", roleValues: { r1: "C001", r2: "O125" } });

      const diags = populationValidationRules(model);
      // inst-2 and inst-3 both duplicate inst-1's r1 value
      expect(diags).toHaveLength(2);
      expect(diags.every((d) => d.ruleId === "population/uniqueness-violation")).toBe(true);
    });
  });

  describe("value constraint violations", () => {
    it("reports value not in allowed set", () => {
      const model = makeOrderModel({
        valueConstraint: { roleId: "r1", values: ["C001", "C002", "C003"] },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({
        id: "inst-1",
        roleValues: { r1: "C999", r2: "O123" },
      });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1);
      expect(diags[0]!.ruleId).toBe("population/value-constraint-violation");
      expect(diags[0]!.message).toContain("C999");
      expect(diags[0]!.message).toContain("C001");
    });

    it("accepts values within a range and rejects values outside it", () => {
      const model = makeOrderModel({
        valueConstraint: { roleId: "r1", values: [], ranges: [{ min: "1", max: "10" }] },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "in", roleValues: { r1: "5", r2: "O1" } });
      pop.addInstance({ id: "lo", roleValues: { r1: "0", r2: "O2" } });
      pop.addInstance({ id: "hi", roleValues: { r1: "11", r2: "O3" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(2);
      expect(diags.map((d) => d.message).join(" ")).toContain('"0"');
      expect(diags.map((d) => d.message).join(" ")).toContain('"11"');
    });

    it("respects exclusive range bounds", () => {
      const model = makeOrderModel({
        valueConstraint: {
          roleId: "r1",
          values: [],
          ranges: [{ min: "0", max: "100", maxInclusive: false }],
        },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "edge", roleValues: { r1: "100", r2: "O1" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1); // 100 excluded by exclusive upper bound
    });

    it("passes when value is in allowed set", () => {
      const model = makeOrderModel({
        valueConstraint: { roleId: "r1", values: ["C001", "C002"] },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
      pop.addInstance({ roleValues: { r1: "C002", r2: "O124" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });

    it("reports multiple value violations", () => {
      const model = makeOrderModel({
        valueConstraint: { roleId: "r1", values: ["C001"] },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C002", r2: "O123" } });
      pop.addInstance({ roleValues: { r1: "C003", r2: "O124" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(2);
    });
  });

  describe("frequency violations", () => {
    it("reports when value appears fewer times than minimum", () => {
      const model = makeOrderModel({
        frequency: { roleId: "r1", min: 2, max: 5 },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } }); // C001 appears once

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1);
      expect(diags[0]!.ruleId).toBe("population/frequency-violation");
      expect(diags[0]!.message).toContain("1 time(s)");
      expect(diags[0]!.message).toContain("minimum is 2");
    });

    it("reports when value appears more times than maximum", () => {
      const model = makeOrderModel({
        frequency: { roleId: "r1", min: 1, max: 2 },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O124" } });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O125" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(1);
      expect(diags[0]!.ruleId).toBe("population/frequency-violation");
      expect(diags[0]!.message).toContain("3 time(s)");
      expect(diags[0]!.message).toContain("maximum is 2");
    });

    it("passes when frequency is within bounds", () => {
      const model = makeOrderModel({
        frequency: { roleId: "r1", min: 2, max: 3 },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O123" } });
      pop.addInstance({ roleValues: { r1: "C001", r2: "O124" } });

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });

    it("allows unbounded max", () => {
      const model = makeOrderModel({
        frequency: { roleId: "r1", min: 1, max: "unbounded" },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      for (let i = 0; i < 100; i++) {
        pop.addInstance({ roleValues: { r1: "C001", r2: `O${i}` } });
      }

      const diags = populationValidationRules(model);
      expect(diags).toHaveLength(0);
    });
  });

  describe("combined constraints", () => {
    it("reports violations from multiple constraint types simultaneously", () => {
      const model = makeOrderModel({
        uniqueness: "role2",
        valueConstraint: { roleId: "r1", values: ["C001", "C002"] },
      });
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // Violates value constraint (C999) AND uniqueness (duplicate O123)
      pop.addInstance({
        id: "inst-1",
        roleValues: { r1: "C001", r2: "O123" },
      });
      pop.addInstance({
        id: "inst-2",
        roleValues: { r1: "C999", r2: "O123" },
      });

      const diags = populationValidationRules(model);
      // One uniqueness + one value constraint violation
      expect(diags).toHaveLength(2);
      const ruleIds = new Set(diags.map((d) => d.ruleId));
      expect(ruleIds).toContain("population/uniqueness-violation");
      expect(ruleIds).toContain("population/value-constraint-violation");
    });
  });

  // -----------------------------------------------------------------------
  // Phase 2 constraint population validation
  // -----------------------------------------------------------------------

  describe("exclusion violations", () => {
    it("reports when same value appears in multiple excluded roles", () => {
      const model = makeSelfRefModel({
        exclusion: { roleIds: ["r1", "r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // P001 appears in both r1 and r2 -- violates exclusion.
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P001" } });

      const diags = populationValidationRules(model);
      const excl = diags.filter(
        (d) => d.ruleId === "population/exclusion-violation",
      );
      expect(excl).toHaveLength(1);
      expect(excl[0]!.message).toContain("P001");
    });

    it("passes when values in excluded roles are distinct", () => {
      const model = makeSelfRefModel({
        exclusion: { roleIds: ["r1", "r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001", r2: "P002" } });
      pop.addInstance({ roleValues: { r1: "P003", r2: "P004" } });

      const diags = populationValidationRules(model);
      const excl = diags.filter(
        (d) => d.ruleId === "population/exclusion-violation",
      );
      expect(excl).toHaveLength(0);
    });
  });

  describe("exclusive-or violations", () => {
    it("reports when no excluded role is played", () => {
      const model = makeSelfRefModel({
        exclusiveOr: { roleIds: ["r1", "r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // Instance with no values for either role.
      pop.addInstance({ id: "inst-1", roleValues: {} });

      const diags = populationValidationRules(model);
      const xor = diags.filter(
        (d) => d.ruleId === "population/exclusive-or-violation",
      );
      expect(xor).toHaveLength(1);
      expect(xor[0]!.message).toContain("does not play any");
    });

    it("reports when more than one exclusive-or role is played", () => {
      const model = makeSelfRefModel({
        exclusiveOr: { roleIds: ["r1", "r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });

      const diags = populationValidationRules(model);
      const xor = diags.filter(
        (d) => d.ruleId === "population/exclusive-or-violation",
      );
      expect(xor).toHaveLength(1);
      expect(xor[0]!.message).toContain("plays 2");
    });

    it("passes when exactly one exclusive-or role is played", () => {
      const model = makeSelfRefModel({
        exclusiveOr: { roleIds: ["r1", "r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001" } });
      pop.addInstance({ roleValues: { r2: "P002" } });

      const diags = populationValidationRules(model);
      const xor = diags.filter(
        (d) => d.ruleId === "population/exclusive-or-violation",
      );
      expect(xor).toHaveLength(0);
    });
  });

  describe("subset violations", () => {
    it("reports when subset tuple has no match in superset", () => {
      const model = makeSelfRefModel({
        subset: { subsetRoleIds: ["r1"], supersetRoleIds: ["r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // r1 has "P001" but r2 has "P002" -- P001 not in superset.
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });

      const diags = populationValidationRules(model);
      const sub = diags.filter(
        (d) => d.ruleId === "population/subset-violation",
      );
      expect(sub).toHaveLength(1);
      expect(sub[0]!.message).toContain("subset tuple");
    });

    it("passes when all subset tuples exist in superset", () => {
      const model = makeSelfRefModel({
        subset: { subsetRoleIds: ["r1"], supersetRoleIds: ["r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // r1="P001", r2="P001" -- subset value P001 exists in superset.
      pop.addInstance({ roleValues: { r1: "P001", r2: "P001" } });
      pop.addInstance({ roleValues: { r1: "P002", r2: "P002" } });

      const diags = populationValidationRules(model);
      const sub = diags.filter(
        (d) => d.ruleId === "population/subset-violation",
      );
      expect(sub).toHaveLength(0);
    });

    it("validates multi-role subset tuples", () => {
      // Both roles form subset and superset sequences.
      const model = makeSelfRefModel({
        subset: { subsetRoleIds: ["r1", "r2"], supersetRoleIds: ["r2", "r1"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // (r1=A, r2=B): subset tuple = (A, B), superset tuple = (B, A).
      // Does (A, B) appear in superset set? Superset has (B, A). No match.
      pop.addInstance({ id: "inst-1", roleValues: { r1: "A", r2: "B" } });

      const diags = populationValidationRules(model);
      const sub = diags.filter(
        (d) => d.ruleId === "population/subset-violation",
      );
      expect(sub).toHaveLength(1);
    });
  });

  describe("equality violations", () => {
    it("reports when tuple sets differ", () => {
      const model = makeSelfRefModel({
        equality: { roleIds1: ["r1"], roleIds2: ["r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      // r1 has {P001}, r2 has {P002} -- not equal.
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });

      const diags = populationValidationRules(model);
      const eq = diags.filter(
        (d) => d.ruleId === "population/equality-violation",
      );
      // P001 not in r2 set AND P002 not in r1 set.
      expect(eq).toHaveLength(2);
    });

    it("passes when tuple sets are identical", () => {
      const model = makeSelfRefModel({
        equality: { roleIds1: ["r1"], roleIds2: ["r2"] },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001", r2: "P001" } });
      pop.addInstance({ roleValues: { r1: "P002", r2: "P002" } });

      const diags = populationValidationRules(model);
      const eq = diags.filter(
        (d) => d.ruleId === "population/equality-violation",
      );
      expect(eq).toHaveLength(0);
    });
  });

  describe("ring constraint violations", () => {
    it("irreflexive: reports self-loop", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "irreflexive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(1);
      expect(ring[0]!.message).toContain("irreflexive");
    });

    it("irreflexive: passes for distinct values", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "irreflexive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001", r2: "P002" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });

    it("asymmetric: reports reverse pair", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "asymmetric" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });
      pop.addInstance({ id: "inst-2", roleValues: { r1: "P002", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring.length).toBeGreaterThan(0);
      expect(ring[0]!.message).toContain("asymmetric");
    });

    it("asymmetric: reports self-loop (implies irreflexive)", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "asymmetric" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(1);
      expect(ring[0]!.message).toContain("asymmetric");
    });

    it("antisymmetric: reports mutual pair with distinct values", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "antisymmetric" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });
      pop.addInstance({ id: "inst-2", roleValues: { r1: "P002", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring.length).toBeGreaterThan(0);
      expect(ring[0]!.message).toContain("antisymmetric");
    });

    it("antisymmetric: allows self-loop (a, a)", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "antisymmetric" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });

    it("symmetric: reports missing reverse pair", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "symmetric" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(1);
      expect(ring[0]!.message).toContain("symmetric");
    });

    it("symmetric: passes when reverse pair exists", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "symmetric" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001", r2: "P002" } });
      pop.addInstance({ roleValues: { r1: "P002", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });

    it("intransitive: reports when transitive closure exists", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "intransitive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "A", r2: "B" } });
      pop.addInstance({ roleValues: { r1: "B", r2: "C" } });
      pop.addInstance({ roleValues: { r1: "A", r2: "C" } }); // violates intransitive

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring.length).toBeGreaterThan(0);
      expect(ring[0]!.message).toContain("intransitive");
    });

    it("intransitive: passes when no transitive closure", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "intransitive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "A", r2: "B" } });
      pop.addInstance({ roleValues: { r1: "B", r2: "C" } });
      // No (A, C) -- intransitive is satisfied.

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });

    it("transitive: reports missing transitive closure", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "transitive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "A", r2: "B" } });
      pop.addInstance({ roleValues: { r1: "B", r2: "C" } });
      // Missing (A, C) violates transitivity.

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring.length).toBeGreaterThan(0);
      expect(ring[0]!.message).toContain("transitive");
    });

    it("transitive: passes when closure is complete", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "transitive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "A", r2: "B" } });
      pop.addInstance({ roleValues: { r1: "B", r2: "C" } });
      pop.addInstance({ roleValues: { r1: "A", r2: "C" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });

    it("acyclic: reports cycle", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "acyclic" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "A", r2: "B" } });
      pop.addInstance({ roleValues: { r1: "B", r2: "C" } });
      pop.addInstance({ roleValues: { r1: "C", r2: "A" } }); // cycle A->B->C->A

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(1);
      expect(ring[0]!.message).toContain("acyclic");
      expect(ring[0]!.message).toContain("cycle");
    });

    it("acyclic: passes for DAG", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "acyclic" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "A", r2: "B" } });
      pop.addInstance({ roleValues: { r1: "B", r2: "C" } });
      pop.addInstance({ roleValues: { r1: "A", r2: "C" } }); // DAG, no cycle

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });

    it("purely_reflexive: reports non-self-loop", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "purely_reflexive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ id: "inst-1", roleValues: { r1: "P001", r2: "P002" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(1);
      expect(ring[0]!.message).toContain("purely reflexive");
    });

    it("purely_reflexive: passes for self-loop", () => {
      const model = makeSelfRefModel({
        ring: { roleId1: "r1", roleId2: "r2", ringType: "purely_reflexive" },
      });
      const ft = model.getFactTypeByName("Person is parent of Person")!;
      const pop = model.addPopulation({ factTypeId: ft.id });
      pop.addInstance({ roleValues: { r1: "P001", r2: "P001" } });

      const diags = populationValidationRules(model);
      const ring = diags.filter((d) => d.ruleId === "population/ring-violation");
      expect(ring).toHaveLength(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers for Phase 2 constraint tests
// ---------------------------------------------------------------------------

import type { Constraint, RingType } from "../../src/model/Constraint.js";

/**
 * Build a model with a self-referencing "Person is parent of Person" fact type.
 * Both roles are played by the same object type, making it suitable for
 * ring, exclusion, exclusive-or, subset, and equality constraint testing.
 */
function makeSelfRefModel(options?: {
  exclusion?: { roleIds: string[]; };
  exclusiveOr?: { roleIds: string[]; };
  subset?: { subsetRoleIds: string[]; supersetRoleIds: string[]; };
  equality?: { roleIds1: string[]; roleIds2: string[]; };
  ring?: { roleId1: string; roleId2: string; ringType: RingType; };
}): OrmModel {
  const model = new OrmModel({ name: "Test" });
  const person = model.addObjectType({
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });

  const constraints: Constraint[] = [];

  if (options?.exclusion) {
    constraints.push({
      type: "exclusion",
      roleIds: options.exclusion.roleIds,
    });
  }

  if (options?.exclusiveOr) {
    constraints.push({
      type: "exclusive_or",
      roleIds: options.exclusiveOr.roleIds,
    });
  }

  if (options?.subset) {
    constraints.push({
      type: "subset",
      subsetRoleIds: options.subset.subsetRoleIds,
      supersetRoleIds: options.subset.supersetRoleIds,
    });
  }

  if (options?.equality) {
    constraints.push({
      type: "equality",
      roleIds1: options.equality.roleIds1,
      roleIds2: options.equality.roleIds2,
    });
  }

  if (options?.ring) {
    constraints.push({
      type: "ring",
      roleId1: options.ring.roleId1,
      roleId2: options.ring.roleId2,
      ringType: options.ring.ringType,
    });
  }

  model.addFactType({
    name: "Person is parent of Person",
    roles: [
      { name: "is parent of", playerId: person.id, id: "r1" },
      { name: "is child of", playerId: person.id, id: "r2" },
    ],
    readings: ["{0} is parent of {1}"],
    constraints,
  });

  return model;
}
