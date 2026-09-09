/**
 * Tests for subtype-related structural validation rules.
 *
 * Validates that the structural rules catch:
 *   - Dangling subtype references (subtype or supertype id missing)
 *   - Non-entity types used in subtype relationships
 *   - Cycles in the subtype hierarchy (A -> B -> C -> A)
 *   - Valid models produce no subtype-related diagnostics
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { SubtypeFact } from "../../src/model/SubtypeFact.js";
import { structuralRules } from "../../src/validation/rules/structural.js";
import { graphFor, unresolvedDiagnostics } from "../helpers/graphFor.js";

describe("subtype structural rules", () => {
  it("produces no diagnostics for a valid subtype hierarchy", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const employee = model.addObjectType({
      name: "Employee",
      kind: "entity",
      referenceMode: "employee_id",
    });
    model.addSubtypeFact({
      subtypeId: employee.id,
      supertypeId: person.id,
    });

    const diags = structuralRules(model, graphFor(model));
    expect(diags).toHaveLength(0);
  });

  it("detects dangling supertype reference", () => {
    const model = new OrmModel({ name: "Test" });
    const employee = model.addObjectType({
      name: "Employee",
      kind: "entity",
      referenceMode: "employee_id",
    });

    // Inject a subtype fact with a nonexistent supertype.
    const badSf = new SubtypeFact({
      subtypeId: employee.id,
      supertypeId: "nonexistent-id",
    });
    (model as any)._subtypeFacts.set(badSf.id, badSf);

    // The check moved into `graphOf`; the diagnostic id did not move
    // with it, because that id is what a consumer reads.
    const diags = unresolvedDiagnostics(model);
    const subtypeDiags = diags.filter((d) => d.ruleId === "structural/subtype-dangling-supertype");
    expect(subtypeDiags).toHaveLength(1);
    expect(subtypeDiags[0]!.message).toContain("nonexistent-id");
  });

  it("detects dangling subtype reference", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });

    // Inject a subtype fact with a nonexistent subtype.
    const badSf = new SubtypeFact({
      subtypeId: "nonexistent-id",
      supertypeId: person.id,
    });
    (model as any)._subtypeFacts.set(badSf.id, badSf);

    const diags = unresolvedDiagnostics(model);
    const subtypeDiags = diags.filter((d) => d.ruleId === "structural/subtype-dangling-subtype");
    expect(subtypeDiags).toHaveLength(1);
    expect(subtypeDiags[0]!.message).toContain("nonexistent-id");
  });

  it("detects non-entity type used as subtype", () => {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    const name = model.addObjectType({ name: "Name", kind: "value" });

    // Inject a subtype fact with a value type as the subtype.
    const badSf = new SubtypeFact({
      subtypeId: name.id,
      supertypeId: person.id,
    });
    (model as any)._subtypeFacts.set(badSf.id, badSf);

    const diags = structuralRules(model, graphFor(model));
    const notEntityDiags = diags.filter(
      (d) => d.ruleId === "structural/subtype-not-entity",
    );
    expect(notEntityDiags).toHaveLength(1);
    expect(notEntityDiags[0]!.message).toContain("value type");
  });

  it("detects non-entity type used as supertype", () => {
    const model = new OrmModel({ name: "Test" });
    const employee = model.addObjectType({
      name: "Employee",
      kind: "entity",
      referenceMode: "employee_id",
    });
    const rating = model.addObjectType({ name: "Rating", kind: "value" });

    // Inject a subtype fact with a value type as the supertype.
    const badSf = new SubtypeFact({
      subtypeId: employee.id,
      supertypeId: rating.id,
    });
    (model as any)._subtypeFacts.set(badSf.id, badSf);

    const diags = structuralRules(model, graphFor(model));
    const notEntityDiags = diags.filter(
      (d) => d.ruleId === "structural/subtype-not-entity",
    );
    expect(notEntityDiags).toHaveLength(1);
    expect(notEntityDiags[0]!.message).toContain("value type");
  });

  it("detects cycle in subtype hierarchy", () => {
    const model = new OrmModel({ name: "Test" });
    const a = model.addObjectType({ name: "A", kind: "entity", referenceMode: "a_id" });
    const b = model.addObjectType({ name: "B", kind: "entity", referenceMode: "b_id" });
    const c = model.addObjectType({ name: "C", kind: "entity", referenceMode: "c_id" });

    model.addSubtypeFact({ subtypeId: a.id, supertypeId: b.id });
    model.addSubtypeFact({ subtypeId: b.id, supertypeId: c.id });

    // Inject cycle: C -> A (bypasses addSubtypeFact which doesn't detect cycles)
    const cycleSf = new SubtypeFact({
      subtypeId: c.id,
      supertypeId: a.id,
    });
    (model as any)._subtypeFacts.set(cycleSf.id, cycleSf);

    const diags = structuralRules(model, graphFor(model));
    const cycleDiags = diags.filter(
      (d) => d.ruleId === "structural/subtype-cycle",
    );
    expect(cycleDiags).toHaveLength(1);
    expect(cycleDiags[0]!.message).toContain("cycle");
  });

  it("does not report cycle for valid chain", () => {
    const model = new OrmModel({ name: "Test" });
    const a = model.addObjectType({ name: "A", kind: "entity", referenceMode: "a_id" });
    const b = model.addObjectType({ name: "B", kind: "entity", referenceMode: "b_id" });
    const c = model.addObjectType({ name: "C", kind: "entity", referenceMode: "c_id" });

    model.addSubtypeFact({ subtypeId: a.id, supertypeId: b.id });
    model.addSubtypeFact({ subtypeId: b.id, supertypeId: c.id });

    const diags = structuralRules(model, graphFor(model));
    const cycleDiags = diags.filter(
      (d) => d.ruleId === "structural/subtype-cycle",
    );
    expect(cycleDiags).toHaveLength(0);
  });

  it("does not report cycle for diamond hierarchy", () => {
    const model = new OrmModel({ name: "Test" });
    const a = model.addObjectType({ name: "A", kind: "entity", referenceMode: "a_id" });
    const b = model.addObjectType({ name: "B", kind: "entity", referenceMode: "b_id" });
    const c = model.addObjectType({ name: "C", kind: "entity", referenceMode: "c_id" });
    const d = model.addObjectType({ name: "D", kind: "entity", referenceMode: "d_id" });

    // Diamond: D -> B -> A and D -> C -> A
    model.addSubtypeFact({ subtypeId: d.id, supertypeId: b.id });
    model.addSubtypeFact({ subtypeId: d.id, supertypeId: c.id });
    model.addSubtypeFact({ subtypeId: b.id, supertypeId: a.id });
    model.addSubtypeFact({ subtypeId: c.id, supertypeId: a.id });

    const diags = structuralRules(model, graphFor(model));
    const cycleDiags = diags.filter(
      (d) => d.ruleId === "structural/subtype-cycle",
    );
    expect(cycleDiags).toHaveLength(0);
  });
});
