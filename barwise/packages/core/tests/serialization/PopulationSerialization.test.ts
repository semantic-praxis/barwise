/**
 * Tests for population serialization and deserialization.
 *
 * Verifies:
 *   - Serialization produces correct YAML structure
 *   - Deserialization reconstructs populations with instances
 *   - Round-trip preserves all fields (id, fact_type, description, instances)
 *   - Schema validation accepts valid populations
 *   - Schema validation rejects invalid populations
 *   - Models without populations omit the key
 */
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

function makeModelWithPopulation(): OrmModel {
  const model = new OrmModel({ name: "Order Management" });
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
    readings: ["{0} places {1}"],
  });

  const pop = model.addPopulation({
    id: "pop-1",
    factTypeId: ft.id,
    description: "Sample orders",
  });
  pop.addInstance({ id: "inst-1", roleValues: { r1: "C001", r2: "O123" } });
  pop.addInstance({ id: "inst-2", roleValues: { r1: "C001", r2: "O124" } });
  pop.addInstance({ id: "inst-3", roleValues: { r1: "C002", r2: "O125" } });

  return model;
}

describe("Population serialization", () => {
  const serializer = new OrmYamlSerializer();

  describe("serialize", () => {
    it("includes populations in YAML output", () => {
      const model = makeModelWithPopulation();
      const yaml = serializer.serialize(model);
      const doc = parse(yaml);

      expect(doc.model.populations).toBeDefined();
      expect(doc.model.populations).toHaveLength(1);
    });

    it("serializes population fields correctly", () => {
      const model = makeModelWithPopulation();
      const yaml = serializer.serialize(model);
      const doc = parse(yaml);

      const pop = doc.model.populations[0];
      expect(pop.id).toBe("pop-1");
      expect(pop.fact_type).toBe(
        model.getFactTypeByName("Customer places Order")!.id,
      );
      expect(pop.description).toBe("Sample orders");
      expect(pop.instances).toHaveLength(3);
    });

    it("serializes fact instances with role values", () => {
      const model = makeModelWithPopulation();
      const yaml = serializer.serialize(model);
      const doc = parse(yaml);

      const instances = doc.model.populations[0].instances;
      expect(instances[0].id).toBe("inst-1");
      expect(instances[0].role_values).toEqual({ r1: "C001", r2: "O123" });
      expect(instances[1].id).toBe("inst-2");
      expect(instances[2].id).toBe("inst-3");
    });

    it("omits populations when none exist", () => {
      const model = new OrmModel({ name: "Empty" });
      model.addObjectType({
        name: "Thing",
        kind: "entity",
        referenceMode: "thing_id",
      });
      const yaml = serializer.serialize(model);
      const doc = parse(yaml);

      expect(doc.model.populations).toBeUndefined();
    });

    it("omits description when not set", () => {
      const model = new OrmModel({ name: "Test" });
      const ot = model.addObjectType({
        name: "X",
        kind: "entity",
        referenceMode: "x_id",
      });
      const ft = model.addFactType({
        name: "X exists",
        roles: [{ name: "exists", playerId: ot.id, id: "r1" }],
        readings: ["{0} exists"],
      });
      model.addPopulation({ id: "pop-1", factTypeId: ft.id });
      const yaml = serializer.serialize(model);
      const doc = parse(yaml);

      expect(doc.model.populations[0].description).toBeUndefined();
    });

    it("serializes empty instances array", () => {
      const model = new OrmModel({ name: "Test" });
      const ot = model.addObjectType({
        name: "X",
        kind: "entity",
        referenceMode: "x_id",
      });
      const ft = model.addFactType({
        name: "X exists",
        roles: [{ name: "exists", playerId: ot.id, id: "r1" }],
        readings: ["{0} exists"],
      });
      model.addPopulation({ id: "pop-1", factTypeId: ft.id });
      const yaml = serializer.serialize(model);
      const doc = parse(yaml);

      expect(doc.model.populations[0].instances).toEqual([]);
    });
  });

  describe("deserialize", () => {
    it("reconstructs populations from YAML", () => {
      const model = makeModelWithPopulation();
      const yaml = serializer.serialize(model);

      const restored = serializer.deserialize(yaml);
      expect(restored.populations).toHaveLength(1);

      const pop = restored.populations[0]!;
      expect(pop.id).toBe("pop-1");
      expect(pop.factTypeId).toBe(
        restored.getFactTypeByName("Customer places Order")!.id,
      );
      expect(pop.description).toBe("Sample orders");
      expect(pop.instances).toHaveLength(3);
    });

    it("reconstructs fact instances with role values", () => {
      const model = makeModelWithPopulation();
      const yaml = serializer.serialize(model);

      const restored = serializer.deserialize(yaml);
      const pop = restored.populations[0]!;
      const inst = pop.getInstance("inst-1")!;
      expect(inst).toBeDefined();
      expect(inst.roleValues).toEqual({ r1: "C001", r2: "O123" });
    });

    it("handles YAML with no populations", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: Simple
  object_types:
    - id: ot1
      name: Customer
      kind: entity
      reference_mode: customer_id
`;
      const model = serializer.deserialize(yaml);
      expect(model.populations).toHaveLength(0);
    });

    it("rejects population with missing fact_type", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: Bad
  populations:
    - id: pop1
      instances: []
`;
      expect(() => serializer.deserialize(yaml)).toThrow();
    });

    it("rejects population with missing instances", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: Bad
  populations:
    - id: pop1
      fact_type: ft1
`;
      expect(() => serializer.deserialize(yaml)).toThrow();
    });

    it("rejects instance with missing role_values", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: Bad
  populations:
    - id: pop1
      fact_type: ft1
      instances:
        - id: inst1
`;
      expect(() => serializer.deserialize(yaml)).toThrow();
    });
  });

  describe("round-trip", () => {
    it("preserves all population data through round-trip", () => {
      const original = makeModelWithPopulation();
      const yaml = serializer.serialize(original);
      const restored = serializer.deserialize(yaml);

      expect(restored.populations).toHaveLength(
        original.populations.length,
      );

      const origPop = original.populations[0]!;
      const restoredPop = restored.populations[0]!;

      expect(restoredPop.id).toBe(origPop.id);
      expect(restoredPop.factTypeId).toBe(origPop.factTypeId);
      expect(restoredPop.description).toBe(origPop.description);
      expect(restoredPop.instances).toHaveLength(origPop.instances.length);

      for (let i = 0; i < origPop.instances.length; i++) {
        const origInst = origPop.instances[i]!;
        const restoredInst = restoredPop.instances[i]!;
        expect(restoredInst.id).toBe(origInst.id);
        expect(restoredInst.roleValues).toEqual(origInst.roleValues);
      }
    });

    it("preserves populations alongside other model elements", () => {
      const original = makeModelWithPopulation();
      const yaml = serializer.serialize(original);
      const restored = serializer.deserialize(yaml);

      expect(restored.objectTypes).toHaveLength(original.objectTypes.length);
      expect(restored.factTypes).toHaveLength(original.factTypes.length);
      expect(restored.populations).toHaveLength(original.populations.length);

      // Verify the population references a valid fact type.
      const pop = restored.populations[0]!;
      const ft = restored.getFactType(pop.factTypeId);
      expect(ft).toBeDefined();
      expect(ft!.name).toBe("Customer places Order");
    });

    it("preserves multiple populations for same fact type", () => {
      const model = makeModelWithPopulation();
      const ft = model.getFactTypeByName("Customer places Order")!;
      const pop2 = model.addPopulation({
        id: "pop-2",
        factTypeId: ft.id,
        description: "More orders",
      });
      pop2.addInstance({ id: "inst-4", roleValues: { r1: "C003", r2: "O126" } });

      const yaml = serializer.serialize(model);
      const restored = serializer.deserialize(yaml);

      expect(restored.populations).toHaveLength(2);
      expect(restored.populationsForFactType(ft.id)).toHaveLength(2);
    });
  });
});

describe("the sample flag", () => {
  it("round-trips, so a draft stays a draft after a save and reload", () => {
    // The flag decides whether mandatory checks treat these instances
    // as a closed world. Losing it on save would turn every reopened
    // extraction back into a wall of false violations.
    const model = new OrmModel({ name: "Sample" });
    const incident = model.addObjectType({
      name: "Incident",
      kind: "entity",
      referenceMode: "incident_id",
    });
    const severity = model.addObjectType({
      name: "Severity",
      kind: "entity",
      referenceMode: "severity_code",
    });
    const ft = model.addFactType({
      name: "Incident has Severity",
      readings: ["{0} has {1}"],
      roles: [
        { name: "incident", playerId: incident.id },
        { name: "severity", playerId: severity.id },
      ],
    });
    const pop = model.addPopulation({ factTypeId: ft.id, sample: true });
    pop.addInstance({
      roleValues: { [ft.roles[0]!.id]: "INC-001", [ft.roles[1]!.id]: "P1" },
    });

    const yaml = new OrmYamlSerializer().serialize(model);
    const reloaded = new OrmYamlSerializer().deserialize(yaml);

    expect(reloaded.populations[0]!.sample).toBe(true);
  });

  it("is absent from the yaml when the population is significant", () => {
    // Every model authored before the field must serialize
    // byte-identically rather than gaining `sample: false`, or the
    // first save after upgrading shows a diff on every population.
    const model = new OrmModel({ name: "Significant" });
    const incident = model.addObjectType({
      name: "Incident",
      kind: "entity",
      referenceMode: "incident_id",
    });
    const severity = model.addObjectType({
      name: "Severity",
      kind: "entity",
      referenceMode: "severity_code",
    });
    const ft = model.addFactType({
      name: "Incident has Severity",
      readings: ["{0} has {1}"],
      roles: [
        { name: "incident", playerId: incident.id },
        { name: "severity", playerId: severity.id },
      ],
    });
    model.addPopulation({ factTypeId: ft.id }).addInstance({
      roleValues: { [ft.roles[0]!.id]: "INC-001", [ft.roles[1]!.id]: "P1" },
    });

    const yaml = new OrmYamlSerializer().serialize(model);

    expect(yaml).not.toContain("sample:");
    expect(new OrmYamlSerializer().deserialize(yaml).populations[0]!.sample).toBe(false);
  });
});
