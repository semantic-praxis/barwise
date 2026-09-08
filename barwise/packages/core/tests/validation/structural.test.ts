/**
 * Tests for the structural validation rules.
 *
 * Structural rules are a safety net for models that may have been loaded
 * from external sources (YAML files, LLM output) which can bypass the
 * OrmModel constructor's referential-integrity checks. They detect:
 *   - Dangling role references (a role whose playerId points to a
 *     nonexistent object type)
 *   - Duplicate object type or fact type names
 *   - Binary fact types missing an inverse reading
 *
 * To trigger error paths, several tests inject invalid state directly
 * into OrmModel's private maps, simulating a corrupted deserialization.
 */
import { describe, expect, it } from "vitest";
import { FactType } from "../../src/model/FactType.js";
import { createObjectType } from "../../src/model/ObjectType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { structuralRules } from "../../src/validation/rules/structural.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("structuralRules", () => {
  it("produces no diagnostics for a valid model", () => {
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

    const diagnostics = structuralRules(model);
    expect(diagnostics).toHaveLength(0);
  });

  it("produces no diagnostics for an empty model", () => {
    const model = new OrmModel({ name: "Empty" });
    const diagnostics = structuralRules(model);
    expect(diagnostics).toHaveLength(0);
  });

  describe("dangling role references", () => {
    it("reports no dangling references for a valid model", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Person", { referenceMode: "person_id" })
        .withBinaryFactType("Person mentors Person", {
          role1: { player: "Person", name: "mentors" },
          role2: { player: "Person", name: "is mentored by" },
        })
        .build();

      const diagnostics = structuralRules(model);
      const dangling = diagnostics.filter(
        (d) => d.ruleId === "structural/dangling-role-reference",
      );
      expect(dangling).toHaveLength(0);
    });

    it("detects a role referencing a nonexistent object type", () => {
      // FactType does not validate playerIds -- it just stores them.
      // We create a fact type with a bogus playerId and inject it
      // into the model to trigger the structural rule.
      const ot = createObjectType({ name: "Customer", kind: "entity", referenceMode: "cid" });
      const ft = new FactType({
        name: "Customer places Order",
        roles: [
          { name: "places", playerId: ot.id },
          { name: "is placed by", playerId: "nonexistent-ot-id" },
        ],
        readings: ["{0} places {1}"],
      });

      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ id: ot.id, name: "Customer", kind: "entity", referenceMode: "cid" });
      // Bypass addFactType validation by injecting directly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)._factTypes.set(ft.id, ft);

      const diagnostics = structuralRules(model);
      const dangling = diagnostics.filter(
        (d) => d.ruleId === "structural/dangling-role-reference",
      );
      expect(dangling).toHaveLength(1);
      expect(dangling[0]!.message).toContain("nonexistent-ot-id");
      expect(dangling[0]!.message).toContain("is placed by");
    });
  });

  describe("duplicate names", () => {
    it("reports no duplicates in a model with unique names", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("Customer", { referenceMode: "customer_id" })
        .withEntityType("Order", { referenceMode: "order_number" })
        .build();

      const diagnostics = structuralRules(model);
      const dupes = diagnostics.filter((d) => d.ruleId.includes("duplicate"));
      expect(dupes).toHaveLength(0);
    });

    it("detects duplicate object type names", () => {
      // OrmModel.addObjectType prevents duplicates, so we inject directly.
      const ot1 = createObjectType({ name: "Customer", kind: "entity", referenceMode: "cid1" });
      const ot2 = createObjectType({ name: "Customer", kind: "entity", referenceMode: "cid2" });

      const model = new OrmModel({ name: "Test" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)._objectTypes.set(ot1.id, ot1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)._objectTypes.set(ot2.id, ot2);

      const diagnostics = structuralRules(model);
      const dupes = diagnostics.filter(
        (d) => d.ruleId === "structural/duplicate-object-type-name",
      );
      expect(dupes).toHaveLength(1);
      expect(dupes[0]!.message).toContain("Customer");
    });

    it("detects duplicate fact type names", () => {
      const ot = createObjectType({ name: "Customer", kind: "entity", referenceMode: "cid" });
      const ft1 = new FactType({
        name: "Customer exists",
        roles: [{ name: "exists", playerId: ot.id }],
        readings: ["{0} exists"],
      });
      const ft2 = new FactType({
        name: "Customer exists",
        roles: [{ name: "exists", playerId: ot.id }],
        readings: ["{0} exists"],
      });

      const model = new OrmModel({ name: "Test" });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)._objectTypes.set(ot.id, ot);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)._factTypes.set(ft1.id, ft1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (model as any)._factTypes.set(ft2.id, ft2);

      const diagnostics = structuralRules(model);
      const dupes = diagnostics.filter(
        (d) => d.ruleId === "structural/duplicate-fact-type-name",
      );
      expect(dupes).toHaveLength(1);
      expect(dupes[0]!.message).toContain("Customer exists");
    });
  });

  describe("binary fact type readings", () => {
    it("warns when a binary fact type has only one reading", () => {
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

      model.addFactType({
        name: "Customer places Order",
        roles: [
          { name: "places", playerId: customer.id },
          { name: "is placed by", playerId: order.id },
        ],
        readings: ["{0} places {1}"], // only forward reading
      });

      const diagnostics = structuralRules(model);
      const readingWarnings = diagnostics.filter(
        (d) => d.ruleId === "structural/binary-missing-inverse-reading",
      );
      expect(readingWarnings).toHaveLength(1);
      expect(readingWarnings[0]!.severity).toBe("warning");
      expect(readingWarnings[0]!.message).toContain(
        "Customer places Order",
      );
    });

    it("does not warn for unary fact types with one reading", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });

      model.addFactType({
        name: "Person smokes",
        roles: [{ name: "smokes", playerId: person.id }],
        readings: ["{0} smokes"],
      });

      const diagnostics = structuralRules(model);
      const readingWarnings = diagnostics.filter(
        (d) => d.ruleId === "structural/binary-missing-inverse-reading",
      );
      expect(readingWarnings).toHaveLength(0);
    });

    it("does not warn for binary fact types with two readings", () => {
      const model = new ModelBuilder("Test")
        .withEntityType("A", { referenceMode: "a_id" })
        .withEntityType("B", { referenceMode: "b_id" })
        .withBinaryFactType("A relates to B", {
          role1: { player: "A", name: "relates to" },
          role2: { player: "B", name: "is related from" },
        })
        .build();

      const diagnostics = structuralRules(model);
      const readingWarnings = diagnostics.filter(
        (d) => d.ruleId === "structural/binary-missing-inverse-reading",
      );
      expect(readingWarnings).toHaveLength(0);
    });
  });
});

describe("identification cycles", () => {
  /**
   * Three shapes, all structurally accepted before this rule existed and
   * all unmappable in a database. The mapper carried a defensive skip for
   * the first (barwise-962) and could not see the other two, which is the
   * argument for stating the property once over the whole identification
   * graph rather than guarding shape by shape.
   * Spec: docs/specs/mapper-key-settlement.spec.md, WS1.
   */
  const cycleIds = (model: OrmModel): string[] =>
    structuralRules(model)
      .map((d) => d.ruleId)
      .filter((id) => id === "structural/identification-cycle");

  it("reports a type objectifying a fact type it plays a role in", () => {
    const model = new OrmModel({ name: "Self" });
    const e = model.addObjectType({ name: "E", kind: "entity", referenceMode: "e_id" });
    const ft = model.addFactType({
      name: "E is flagged",
      roles: [{ id: "r0", name: "is flagged", playerId: e.id }],
      readings: ["{0} is flagged"],
    });
    model.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: e.id });

    expect(cycleIds(model)).toHaveLength(1);
  });

  it("reports two types objectifying fact types the other plays in", () => {
    const model = new OrmModel({ name: "Mutual" });
    const e = model.addObjectType({ name: "E", kind: "entity", referenceMode: "e_id" });
    const f = model.addObjectType({ name: "F", kind: "entity", referenceMode: "f_id" });
    const flagged = model.addFactType({
      name: "F is flagged",
      roles: [{ id: "a0", name: "is flagged", playerId: f.id }],
      readings: ["{0} is flagged"],
    });
    const noted = model.addFactType({
      name: "E is noted",
      roles: [{ id: "b0", name: "is noted", playerId: e.id }],
      readings: ["{0} is noted"],
    });
    model.addObjectifiedFactType({ factTypeId: flagged.id, objectTypeId: e.id });
    model.addObjectifiedFactType({ factTypeId: noted.id, objectTypeId: f.id });

    expect(cycleIds(model)).toHaveLength(1);
  });

  it("reports a cycle that runs through both an objectification and a subtype", () => {
    const model = new OrmModel({ name: "Mixed" });
    const sup = model.addObjectType({ name: "Super", kind: "entity", referenceMode: "super_id" });
    const sub = model.addObjectType({ name: "Sub", kind: "entity", referenceMode: "sub_id" });
    const listed = model.addFactType({
      name: "Sub is listed",
      roles: [{ id: "r0", name: "is listed", playerId: sub.id }],
      readings: ["{0} is listed"],
    });
    model.addObjectifiedFactType({ factTypeId: listed.id, objectTypeId: sup.id });
    model.addSubtypeFact({
      subtypeId: sub.id,
      supertypeId: sup.id,
      providesIdentification: true,
    });

    expect(cycleIds(model)).toHaveLength(1);
  });

  /**
   * A subtype fact that does not provide identification is not an
   * identification edge: the subtype keeps its own key, so the same
   * shape as the mixed case above is well formed.
   */
  it("does not report when the subtype fact does not provide identification", () => {
    const model = new OrmModel({ name: "NonIdentifying" });
    const sup = model.addObjectType({ name: "Super", kind: "entity", referenceMode: "super_id" });
    const sub = model.addObjectType({ name: "Sub", kind: "entity", referenceMode: "sub_id" });
    const listed = model.addFactType({
      name: "Sub is listed",
      roles: [{ id: "r0", name: "is listed", playerId: sub.id }],
      readings: ["{0} is listed"],
    });
    model.addObjectifiedFactType({ factTypeId: listed.id, objectTypeId: sup.id });
    model.addSubtypeFact({
      subtypeId: sub.id,
      supertypeId: sup.id,
      providesIdentification: false,
    });

    expect(cycleIds(model)).toEqual([]);
  });

  it("names the types on the cycle in its message", () => {
    const model = new OrmModel({ name: "Named" });
    const e = model.addObjectType({ name: "Reservation", kind: "entity", referenceMode: "r_id" });
    const ft = model.addFactType({
      name: "Reservation is confirmed",
      roles: [{ id: "r0", name: "is confirmed", playerId: e.id }],
      readings: ["{0} is confirmed"],
    });
    model.addObjectifiedFactType({ factTypeId: ft.id, objectTypeId: e.id });

    const diagnostic = structuralRules(model).find(
      (d) => d.ruleId === "structural/identification-cycle",
    );
    expect(diagnostic?.message).toContain("Reservation -> Reservation");
  });
});
