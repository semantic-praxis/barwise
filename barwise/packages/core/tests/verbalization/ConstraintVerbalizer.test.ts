/**
 * Tests for Phase 1 constraint verbalization.
 *
 * The ConstraintVerbalizer translates inline constraints (uniqueness,
 * mandatory, value constraint) into natural-language sentences like
 * "Each Order is placed by at most one Customer." These tests verify:
 *   - Uniqueness verbalization for binary and non-binary fact types
 *   - Mandatory constraint verbalization
 *   - Value constraint verbalization (enumerated allowed values)
 *   - Structured segments linking text spans to model elements
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("ConstraintVerbalizer", () => {
  const verbalizer = new ConstraintVerbalizer();

  describe("internal uniqueness", () => {
    it("verbalizes single-role uniqueness on a binary fact type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const ft = model.factTypes[0]!;
      const v = verbalizer.verbalizeAll(ft, model);

      // Uniqueness on role2 (Order): "Each Order is placed by at most one Customer."
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBe(
        "Each Order is placed by at most one Customer.",
      );
      expect(v[0]!.category).toBe("constraint");
    });

    it("verbalizes single-role uniqueness on role1", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role1",
        })
        .build();

      const ft = model.factTypes[0]!;
      const v = verbalizer.verbalizeAll(ft, model);

      // Uniqueness on role1 (Customer): "Each Customer places at most one Order."
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBe(
        "Each Customer places at most one Order.",
      );
    });

    it("produces segments with keyword and ref kinds", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
        })
        .build();

      const ft = model.factTypes[0]!;
      const v = verbalizer.verbalizeAll(ft, model)[0]!;

      const keywords = v.segments.filter((s) => s.kind === "keyword");
      expect(keywords.map((s) => s.text)).toContain("Each ");
      expect(keywords.map((s) => s.text)).toContain("at most one ");

      const refs = v.segments.filter((s) => s.kind === "object_type_ref");
      expect(refs.map((s) => s.text)).toContain("Order");
      expect(refs.map((s) => s.text)).toContain("Customer");
    });

    it("verbalizes multi-role uniqueness on a ternary fact type", () => {
      const model = new OrmModel({ name: "Test" });
      const emp = model.addObjectType({
        name: "Employee",
        kind: "entity",
        referenceMode: "emp_id",
      });
      const proj = model.addObjectType({
        name: "Project",
        kind: "entity",
        referenceMode: "proj_id",
      });
      const dept = model.addObjectType({
        name: "Department",
        kind: "entity",
        referenceMode: "dept_id",
      });

      const ft = model.addFactType({
        name: "Employee works on Project in Department",
        roles: [
          { name: "works on", playerId: emp.id, id: "r1" },
          { name: "has worker", playerId: proj.id, id: "r2" },
          { name: "in", playerId: dept.id, id: "r3" },
        ],
        readings: ["{0} works on {1} in {2}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1", "r2"] },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBe(
        "For each Employee and Project combination, at most one Department applies.",
      );
    });
  });

  describe("mandatory", () => {
    it("verbalizes a mandatory constraint on a binary fact type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          mandatory: "role1",
        })
        .build();

      const ft = model.factTypes[0]!;
      const v = verbalizer.verbalizeAll(ft, model);

      // Mandatory on role1 (Customer): "Each Customer places at least one Order."
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBe(
        "Each Customer places at least one Order.",
      );
    });

    it("verbalizes mandatory on the inverse role", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          mandatory: "role2",
        })
        .build();

      const ft = model.factTypes[0]!;
      const v = verbalizer.verbalizeAll(ft, model);

      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBe(
        "Each Order is placed by at least one Customer.",
      );
    });
  });

  describe("value constraint", () => {
    it("verbalizes a role-level value constraint", () => {
      const model = new OrmModel({ name: "Test" });
      const student = model.addObjectType({
        name: "Student",
        kind: "entity",
        referenceMode: "student_id",
      });
      const rating = model.addObjectType({
        name: "Rating",
        kind: "value",
      });

      const ft = model.addFactType({
        name: "Student has Rating",
        roles: [
          { name: "has", playerId: student.id, id: "r1" },
          { name: "of", playerId: rating.id, id: "r2" },
        ],
        readings: ["{0} has {1}", "{1} of {0}"],
        constraints: [
          {
            type: "value_constraint",
            roleId: "r2",
            values: ["A", "B", "C", "D", "F"],
          },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toBe(
        "The possible values of Rating are: {'A', 'B', 'C', 'D', 'F'}.",
      );
    });

    it("verbalizes value ranges and open-ended bounds", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const age = model.addObjectType({ name: "Age", kind: "value" });

      const ft = model.addFactType({
        name: "Person has Age",
        roles: [
          { name: "has", playerId: person.id, id: "r1" },
          { name: "of", playerId: age.id, id: "r2" },
        ],
        readings: ["{0} has {1}", "{1} of {0}"],
        constraints: [
          {
            type: "value_constraint",
            roleId: "r2",
            values: [],
            ranges: [{ min: "18" }, { min: "0", max: "120", maxInclusive: false }],
          },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v[0]!.text).toBe(
        "The possible values of Age are: {at least 18, at least 0 and less than 120}.",
      );
    });

    it("verbalizes enumerated values combined with a range", () => {
      const model = new OrmModel({ name: "Test" });
      const sale = model.addObjectType({
        name: "Sale",
        kind: "entity",
        referenceMode: "sale_id",
      });
      const discount = model.addObjectType({ name: "Discount", kind: "value" });

      const ft = model.addFactType({
        name: "Sale has Discount",
        roles: [
          { name: "has", playerId: sale.id, id: "r1" },
          { name: "of", playerId: discount.id, id: "r2" },
        ],
        readings: ["{0} has {1}", "{1} of {0}"],
        constraints: [
          {
            type: "value_constraint",
            roleId: "r2",
            values: ["N/A"],
            ranges: [{ min: "1", max: "10" }],
          },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v[0]!.text).toBe(
        "The possible values of Discount are: {'N/A', between 1 and 10}.",
      );
    });

    it("verbalizes a value constraint without role id", () => {
      const model = new OrmModel({ name: "Test" });
      const ot = model.addObjectType({
        name: "Widget",
        kind: "entity",
        referenceMode: "widget_id",
      });

      const ft = model.addFactType({
        name: "Widget exists",
        roles: [{ name: "exists", playerId: ot.id }],
        readings: ["{0} exists"],
        constraints: [
          { type: "value_constraint", values: ["X", "Y", "Z"] },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toContain("Widget exists");
      expect(v[0]!.text).toContain("'X', 'Y', 'Z'");
    });

    it("produces value_literal segments for the values", () => {
      const model = new OrmModel({ name: "Test" });
      const ot = model.addObjectType({
        name: "Rating",
        kind: "value",
      });
      const student = model.addObjectType({
        name: "Student",
        kind: "entity",
        referenceMode: "student_id",
      });

      const ft = model.addFactType({
        name: "Student has Rating",
        roles: [
          { name: "has", playerId: student.id, id: "r1" },
          { name: "of", playerId: ot.id, id: "r2" },
        ],
        readings: ["{0} has {1}", "{1} of {0}"],
        constraints: [
          {
            type: "value_constraint",
            roleId: "r2",
            values: ["A", "B"],
          },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model)[0]!;
      const valueLiterals = v.segments.filter(
        (s) => s.kind === "value_literal",
      );
      expect(valueLiterals).toHaveLength(1);
      expect(valueLiterals[0]!.text).toBe("'A', 'B'");
    });
  });

  describe("external uniqueness", () => {
    it("verbalizes an external uniqueness constraint", () => {
      const model = new OrmModel({ name: "Test" });
      const emp = model.addObjectType({
        name: "Employee",
        kind: "entity",
        referenceMode: "emp_id",
      });
      const fname = model.addObjectType({
        name: "FirstName",
        kind: "value",
      });

      const ft = model.addFactType({
        name: "Employee has FirstName",
        roles: [
          { name: "has", playerId: emp.id, id: "r1" },
          { name: "of", playerId: fname.id, id: "r2" },
        ],
        readings: ["{0} has {1}", "{1} of {0}"],
        constraints: [
          {
            type: "external_uniqueness",
            roleIds: ["r2", "r-other-ft"],
          },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v).toHaveLength(1);
      expect(v[0]!.text).toContain("combination of");
      expect(v[0]!.text).toContain("FirstName");
      expect(v[0]!.text).toContain("unique across fact types");
    });

    it("resolves roles that live in other fact types (cross-fact-type)", () => {
      // Room is identified by the combination of its Building and its
      // RoomNumber -- the two constrained roles live in different fact
      // types, so the verbalizer must resolve each one model-wide.
      const model = new OrmModel({ name: "Test" });
      const room = model.addObjectType({ name: "Room", kind: "entity", referenceMode: "room_id" });
      const building = model.addObjectType({
        name: "Building",
        kind: "entity",
        referenceMode: "building_code",
      });
      const roomNumber = model.addObjectType({ name: "RoomNumber", kind: "value" });

      const inBuilding = model.addFactType({
        name: "Room is in Building",
        roles: [
          { name: "is in", playerId: room.id, id: "rb1" },
          { name: "houses", playerId: building.id, id: "rb2" },
        ],
        readings: ["{0} is in {1}", "{1} houses {0}"],
        constraints: [
          { type: "external_uniqueness", roleIds: ["rb2", "rn2"] },
        ],
      });
      model.addFactType({
        name: "Room has RoomNumber",
        roles: [
          { name: "has", playerId: room.id, id: "rn1" },
          { name: "numbers", playerId: roomNumber.id, id: "rn2" },
        ],
        readings: ["{0} has {1}", "{1} numbers {0}"],
      });

      const v = verbalizer.verbalizeAll(inBuilding, model);
      const text = v.find((x) => x.text.includes("combination of"))!.text;
      expect(text).toContain("Building");
      expect(text).toContain("RoomNumber");
      // The RoomNumber role lives in the other fact type; its id must not
      // leak into the reading as a fallback.
      expect(text).not.toContain("rn2");
    });
  });

  describe("multiple constraints", () => {
    it("verbalizes all constraints on a fact type", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .build();

      const ft = model.factTypes[0]!;
      const vs = verbalizer.verbalizeAll(ft, model);

      expect(vs).toHaveLength(2);
      expect(vs[0]!.text).toContain("at most one");
      expect(vs[1]!.text).toContain("at least one");
    });
  });

  describe("value comparison", () => {
    it("verbalizes a value-comparison constraint with the operator phrase", () => {
      const model = new OrmModel({ name: "Test" });
      const trip = model.addObjectType({
        name: "Trip",
        kind: "entity",
        referenceMode: "trip_id",
      });
      const start = model.addObjectType({ name: "StartDay", kind: "value" });
      const end = model.addObjectType({ name: "EndDay", kind: "value" });

      const ft = model.addFactType({
        name: "Trip runs",
        roles: [
          { name: "for", playerId: trip.id, id: "r0" },
          { name: "from", playerId: start.id, id: "r1" },
          { name: "to", playerId: end.id, id: "r2" },
        ],
        readings: ["{0} runs from {1} to {2}"],
        constraints: [
          { type: "value_comparison", roleId1: "r1", roleId2: "r2", operator: "<=" },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      expect(v[0]!.text).toBe(
        "StartDay must be less than or equal to EndDay.",
      );
    });
  });

  describe("deontic modality", () => {
    it("verbalizes a deontic constraint as an obligation", () => {
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
      const ft = model.addFactType({
        name: "Customer places Order",
        roles: [
          { name: "places", playerId: customer.id, id: "r1" },
          { name: "is placed by", playerId: order.id, id: "r2" },
        ],
        readings: ["{0} places {1}", "{1} is placed by {0}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r2"], modality: "deontic" },
        ],
      });

      const v = verbalizer.verbalizeAll(ft, model);
      // The alethic sentence "Each Order ... " becomes an obligation with a
      // lower-cased leading keyword.
      expect(v[0]!.text).toBe(
        "It is obligatory that each Order is placed by at most one Customer.",
      );
    });
  });
});
