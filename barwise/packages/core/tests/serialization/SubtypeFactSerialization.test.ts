/**
 * Tests for SubtypeFact YAML round-trip serialization.
 *
 * Verifies that subtype facts survive serialize -> deserialize:
 *   - Basic round-trip preserves subtype/supertype ids and identification flag
 *   - providesIdentification defaults to true when omitted
 *   - Multiple subtype facts round-trip correctly
 *   - Models without subtype facts still round-trip
 *
 * The 2.0 flags and the constraints that replace them are in
 * subtypeFlags.test.ts.
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const serializer = new OrmYamlSerializer();

describe("SubtypeFact serialization", () => {
  it("round-trips a subtype fact", () => {
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

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    expect(restored.subtypeFacts).toHaveLength(1);
    const sf = restored.subtypeFacts[0]!;
    expect(sf.subtypeId).toBe(employee.id);
    expect(sf.supertypeId).toBe(person.id);
    expect(sf.providesIdentification).toBe(true);
  });

  it("round-trips providesIdentification = false", () => {
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
      providesIdentification: false,
    });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    expect(restored.subtypeFacts[0]!.providesIdentification).toBe(false);
  });

  it("round-trips multiple subtype facts", () => {
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
    const manager = model.addObjectType({
      name: "Manager",
      kind: "entity",
      referenceMode: "manager_id",
    });

    model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });
    model.addSubtypeFact({ subtypeId: manager.id, supertypeId: employee.id });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    expect(restored.subtypeFacts).toHaveLength(2);
  });

  it("does not emit subtype_facts when there are none", () => {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });

    const yaml = serializer.serialize(model);
    expect(yaml).not.toContain("subtype_facts");
  });

  it("omits is_exclusive and is_exhaustive when false", () => {
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

    const yaml = serializer.serialize(model);
    expect(yaml).not.toContain("is_exclusive");
    expect(yaml).not.toContain("is_exhaustive");
  });

  it("preserves subtype fact ids through round-trip", () => {
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
    const sf = model.addSubtypeFact({
      subtypeId: employee.id,
      supertypeId: person.id,
    });

    const yaml = serializer.serialize(model);
    const restored = serializer.deserialize(yaml);

    expect(restored.subtypeFacts[0]!.id).toBe(sf.id);
  });
});
