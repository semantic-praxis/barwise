/**
 * Tests for the OrmYamlSerializer (.orm.yaml file format).
 *
 * The serializer converts between OrmModel and YAML text. These tests
 * verify the three core operations:
 *   - Serialization: OrmModel -> YAML string (correct structure, quoting)
 *   - Deserialization: YAML string -> OrmModel (including error handling
 *     for malformed YAML, schema violations, and missing fields)
 *   - Round-trip: serialize then deserialize preserves all model elements
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import {
  DeserializationError,
  OrmYamlSerializer,
} from "../../src/serialization/OrmYamlSerializer.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("OrmYamlSerializer", () => {
  const serializer = new OrmYamlSerializer();

  // ---- Serialization ----

  describe("serialize", () => {
    it("serializes an empty model to valid YAML", () => {
      const model = new OrmModel({ name: "Empty Model" });
      const yaml = serializer.serialize(model);

      expect(yaml).toContain('orm_version: "1.1"');
      expect(yaml).toContain("name: Empty Model");
    });

    it("serializes a model with domain_context", () => {
      const model = new OrmModel({
        name: "Test",
        domainContext: "ecommerce",
      });
      const yaml = serializer.serialize(model);

      expect(yaml).toContain("domain_context: ecommerce");
    });

    it("serializes object types with all fields", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        definition: "A person who buys things.",
        sourceContext: "crm",
      });

      const yaml = serializer.serialize(model);

      expect(yaml).toContain("name: Customer");
      expect(yaml).toContain("kind: entity");
      expect(yaml).toContain("reference_mode: customer_id");
      expect(yaml).toContain("definition: A person who buys things.");
      expect(yaml).toContain("source_context: crm");
    });

    it("serializes value types with value constraints", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Rating",
        kind: "value",
        valueConstraint: { values: ["A", "B", "C"] },
      });

      const yaml = serializer.serialize(model);

      expect(yaml).toContain("kind: value");
      expect(yaml).toContain("value_constraint:");
      expect(yaml).toContain("- A");
      expect(yaml).toContain("- B");
      expect(yaml).toContain("- C");
    });

    it("round-trips value constraints with ranges and open/exclusive bounds", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Age",
        kind: "value",
        valueConstraint: {
          values: [],
          ranges: [{ min: "18" }, { min: "0", max: "120", maxInclusive: false }],
        },
      });

      const restored = serializer.deserialize(serializer.serialize(model));
      expect(restored.objectTypes[0]!.valueConstraint).toEqual(
        model.objectTypes[0]!.valueConstraint,
      );
    });

    it("round-trips a role-level value constraint with a range", () => {
      const model = new OrmModel({ name: "Test" });
      const person = model.addObjectType({
        name: "Person",
        kind: "entity",
        referenceMode: "person_id",
      });
      const age = model.addObjectType({ name: "Age", kind: "value" });
      model.addFactType({
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
            ranges: [{ min: "18", max: "65" }],
          },
        ],
      });

      const restored = serializer.deserialize(serializer.serialize(model));
      const c = restored.getFactTypeByName("Person has Age")!.constraints
        .find((x) => x.type === "value_constraint");
      expect(c).toMatchObject({
        type: "value_constraint",
        roleId: "r2",
        values: [],
        ranges: [{ min: "18", max: "65" }],
      });
    });

    it("round-trips a value-comparison constraint", () => {
      const model = new OrmModel({ name: "Test" });
      const trip = model.addObjectType({
        name: "Trip",
        kind: "entity",
        referenceMode: "trip_id",
      });
      const start = model.addObjectType({ name: "StartDay", kind: "value" });
      const end = model.addObjectType({ name: "EndDay", kind: "value" });
      model.addFactType({
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

      const restored = serializer.deserialize(serializer.serialize(model));
      const c = restored.getFactTypeByName("Trip runs")!.constraints
        .find((x) => x.type === "value_comparison");
      expect(c).toMatchObject({
        type: "value_comparison",
        roleId1: "r1",
        roleId2: "r2",
        operator: "<=",
      });
    });

    it("serializes value types with data type", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "FirstName",
        kind: "value",
        dataType: { name: "text", length: 50 },
      });

      const yaml = serializer.serialize(model);

      expect(yaml).toContain("data_type:");
      expect(yaml).toContain("name: text");
      expect(yaml).toContain("length: 50");
    });

    it("serializes data type with scale", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({
        name: "Price",
        kind: "value",
        dataType: { name: "decimal", length: 10, scale: 2 },
      });

      const yaml = serializer.serialize(model);

      expect(yaml).toContain("name: decimal");
      expect(yaml).toContain("scale: 2");
    });

    it("omits data_type when not set", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ name: "Name", kind: "value" });

      const yaml = serializer.serialize(model);
      expect(yaml).not.toContain("data_type");
    });

    it("serializes isPreferred on internal_uniqueness constraint", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      model.addFactType({
        name: "Customer has id",
        roles: [{ id: "r1", name: "has", playerId: customer.id }],
        readings: ["{0} has id"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"], isPreferred: true },
        ],
      });

      const yaml = serializer.serialize(model);
      expect(yaml).toContain("is_preferred: true");
    });

    it("omits is_preferred when false or undefined", () => {
      const model = new OrmModel({ name: "Test" });
      const customer = model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      model.addFactType({
        name: "Customer has id",
        roles: [{ id: "r1", name: "has", playerId: customer.id }],
        readings: ["{0} has id"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
        ],
      });

      const yaml = serializer.serialize(model);
      expect(yaml).not.toContain("is_preferred");
    });

    it("serializes fact types with roles, readings, and constraints", () => {
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

      const yaml = serializer.serialize(model);

      expect(yaml).toContain("name: Customer places Order");
      expect(yaml).toContain("role_name: places");
      expect(yaml).toContain("role_name: is placed by");
      expect(yaml).toContain('- "{0} places {1}"');
      expect(yaml).toContain("type: internal_uniqueness");
      expect(yaml).toContain("type: mandatory");
    });

    it("serializes definitions", () => {
      const model = new OrmModel({ name: "Test" });
      model.addDefinition({
        term: "Backorder",
        definition: "An order that cannot be fulfilled from current inventory.",
        context: "fulfillment",
      });

      const yaml = serializer.serialize(model);

      expect(yaml).toContain("term: Backorder");
      expect(yaml).toContain("context: fulfillment");
    });

    it("omits empty arrays from output", () => {
      const model = new OrmModel({ name: "Minimal" });
      const yaml = serializer.serialize(model);

      expect(yaml).not.toContain("object_types");
      expect(yaml).not.toContain("fact_types");
      expect(yaml).not.toContain("definitions");
    });
  });

  // ---- Deserialization ----

  describe("deserialize", () => {
    it("deserializes a minimal valid document", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test Model"
`;
      const model = serializer.deserialize(yaml);

      expect(model.name).toBe("Test Model");
      expect(model.objectTypes).toHaveLength(0);
      expect(model.factTypes).toHaveLength(0);
      expect(model.definitions).toHaveLength(0);
    });

    it("deserializes domain_context", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  domain_context: "ecommerce"
`;
      const model = serializer.deserialize(yaml);
      expect(model.domainContext).toBe("ecommerce");
    });

    it("deserializes entity types", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Customer"
      kind: "entity"
      reference_mode: "customer_id"
      definition: "A person who buys things."
      source_context: "crm"
`;
      const model = serializer.deserialize(yaml);

      expect(model.objectTypes).toHaveLength(1);
      const ot = model.objectTypes[0]!;
      expect(ot.id).toBe("ot-001");
      expect(ot.name).toBe("Customer");
      expect(ot.kind).toBe("entity");
      expect(ot.referenceMode).toBe("customer_id");
      expect(ot.definition).toBe("A person who buys things.");
      expect(ot.sourceContext).toBe("crm");
    });

    it("deserializes value types with value constraints", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Rating"
      kind: "value"
      value_constraint:
        values: ["A", "B", "C"]
`;
      const model = serializer.deserialize(yaml);

      const ot = model.objectTypes[0]!;
      expect(ot.kind).toBe("value");
      expect(ot.valueConstraint?.values).toEqual(["A", "B", "C"]);
    });

    it("deserializes value types with data type", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "FirstName"
      kind: "value"
      data_type:
        name: "text"
        length: 50
`;
      const model = serializer.deserialize(yaml);

      const ot = model.objectTypes[0]!;
      expect(ot.dataType).toBeDefined();
      expect(ot.dataType!.name).toBe("text");
      expect(ot.dataType!.length).toBe(50);
      expect(ot.dataType!.scale).toBeUndefined();
    });

    it("deserializes data type with scale", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Price"
      kind: "value"
      data_type:
        name: "decimal"
        length: 10
        scale: 2
`;
      const model = serializer.deserialize(yaml);

      const ot = model.objectTypes[0]!;
      expect(ot.dataType!.name).toBe("decimal");
      expect(ot.dataType!.length).toBe(10);
      expect(ot.dataType!.scale).toBe(2);
    });

    it("deserializes isPreferred on internal_uniqueness constraint", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Customer"
      kind: "entity"
      reference_mode: "customer_id"
  fact_types:
    - id: "ft-001"
      name: "Customer has id"
      roles:
        - id: "r-001"
          player: "ot-001"
          role_name: "has"
      readings:
        - "{0} has id"
      constraints:
        - type: "internal_uniqueness"
          roles: ["r-001"]
          is_preferred: true
`;
      const model = serializer.deserialize(yaml);

      const ft = model.factTypes[0]!;
      const uc = ft.constraints.find(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uc).toBeDefined();
      if (uc?.type === "internal_uniqueness") {
        expect(uc.isPreferred).toBe(true);
      }
    });

    it("deserializes internal_uniqueness without is_preferred", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Customer"
      kind: "entity"
      reference_mode: "customer_id"
  fact_types:
    - id: "ft-001"
      name: "Customer has id"
      roles:
        - id: "r-001"
          player: "ot-001"
          role_name: "has"
      readings:
        - "{0} has id"
      constraints:
        - type: "internal_uniqueness"
          roles: ["r-001"]
`;
      const model = serializer.deserialize(yaml);

      const ft = model.factTypes[0]!;
      const uc = ft.constraints.find(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uc).toBeDefined();
      if (uc?.type === "internal_uniqueness") {
        expect(uc.isPreferred).toBeUndefined();
      }
    });

    it("deserializes fact types with roles, readings, and constraints", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Customer"
      kind: "entity"
      reference_mode: "customer_id"
    - id: "ot-002"
      name: "Order"
      kind: "entity"
      reference_mode: "order_number"
  fact_types:
    - id: "ft-001"
      name: "Customer places Order"
      roles:
        - id: "r-001"
          player: "ot-001"
          role_name: "places"
        - id: "r-002"
          player: "ot-002"
          role_name: "is placed by"
      readings:
        - "{0} places {1}"
        - "{1} is placed by {0}"
      constraints:
        - type: "internal_uniqueness"
          roles: ["r-002"]
        - type: "mandatory"
          role: "r-002"
`;
      const model = serializer.deserialize(yaml);

      expect(model.factTypes).toHaveLength(1);
      const ft = model.factTypes[0]!;
      expect(ft.id).toBe("ft-001");
      expect(ft.name).toBe("Customer places Order");
      expect(ft.roles).toHaveLength(2);
      expect(ft.roles[0]!.name).toBe("places");
      expect(ft.roles[0]!.playerId).toBe("ot-001");
      expect(ft.roles[1]!.name).toBe("is placed by");
      expect(ft.roles[1]!.playerId).toBe("ot-002");
      expect(ft.readings).toHaveLength(2);
      expect(ft.readings[0]!.template).toBe("{0} places {1}");
      expect(ft.constraints).toHaveLength(2);
      expect(ft.constraints[0]!.type).toBe("internal_uniqueness");
      expect(ft.constraints[1]!.type).toBe("mandatory");
    });

    it("deserializes external_uniqueness constraints", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Thing"
      kind: "entity"
      reference_mode: "thing_id"
  fact_types:
    - id: "ft-001"
      name: "Test Fact"
      roles:
        - id: "r-001"
          player: "ot-001"
          role_name: "test"
      readings:
        - "{0} test"
      constraints:
        - type: "external_uniqueness"
          roles: ["r-001", "r-999"]
`;
      const model = serializer.deserialize(yaml);
      const c = model.factTypes[0]!.constraints[0]!;
      expect(c.type).toBe("external_uniqueness");
      if (c.type === "external_uniqueness") {
        expect(c.roleIds).toEqual(["r-001", "r-999"]);
      }
    });

    it("deserializes value_constraint constraints", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  object_types:
    - id: "ot-001"
      name: "Thing"
      kind: "entity"
      reference_mode: "thing_id"
  fact_types:
    - id: "ft-001"
      name: "Test Fact"
      roles:
        - id: "r-001"
          player: "ot-001"
          role_name: "test"
      readings:
        - "{0} test"
      constraints:
        - type: "value_constraint"
          role: "r-001"
          values: ["X", "Y"]
`;
      const model = serializer.deserialize(yaml);
      const c = model.factTypes[0]!.constraints[0]!;
      expect(c.type).toBe("value_constraint");
      if (c.type === "value_constraint") {
        expect(c.roleId).toBe("r-001");
        expect(c.values).toEqual(["X", "Y"]);
      }
    });

    it("deserializes definitions", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  definitions:
    - term: "Backorder"
      definition: "An order that cannot be fulfilled."
      context: "fulfillment"
    - term: "SKU"
      definition: "Stock Keeping Unit."
`;
      const model = serializer.deserialize(yaml);

      expect(model.definitions).toHaveLength(2);
      expect(model.definitions[0]!.term).toBe("Backorder");
      expect(model.definitions[0]!.context).toBe("fulfillment");
      expect(model.definitions[1]!.term).toBe("SKU");
      expect(model.definitions[1]!.context).toBeUndefined();
    });
  });

  // ---- Error handling ----

  describe("error handling", () => {
    it("throws DeserializationError for invalid YAML schema", () => {
      const yaml = `
orm_version: "2.0"
model:
  name: "Test"
`;
      expect(() => serializer.deserialize(yaml)).toThrow(
        DeserializationError,
      );
    });

    it("throws DeserializationError with validation errors", () => {
      const yaml = `
model:
  name: "Test"
`;
      try {
        serializer.deserialize(yaml);
        expect.fail("Should have thrown");
      } catch (e) {
        expect(e).toBeInstanceOf(DeserializationError);
        const err = e as DeserializationError;
        expect(err.validationResult).toBeDefined();
        expect(err.validationResult!.errors.length).toBeGreaterThan(0);
      }
    });

    it("throws when a role references a nonexistent object type", () => {
      const yaml = `
orm_version: "1.0"
model:
  name: "Test"
  fact_types:
    - id: "ft-001"
      name: "Bad Fact"
      roles:
        - id: "r-001"
          player: "nonexistent"
          role_name: "test"
      readings:
        - "{0} test"
`;
      expect(() => serializer.deserialize(yaml)).toThrow();
    });
  });

  // ---- Round-trip ----

  describe("round-trip", () => {
    it("round-trips an empty model", () => {
      const original = new OrmModel({ name: "Empty" });
      const yaml = serializer.serialize(original);
      const restored = serializer.deserialize(yaml);

      expect(restored.name).toBe(original.name);
      expect(restored.objectTypes).toHaveLength(0);
      expect(restored.factTypes).toHaveLength(0);
      expect(restored.definitions).toHaveLength(0);
    });

    it("round-trips a model with domain context", () => {
      const original = new OrmModel({
        name: "Contextual",
        domainContext: "ecommerce",
      });
      const yaml = serializer.serialize(original);
      const restored = serializer.deserialize(yaml);

      expect(restored.name).toBe("Contextual");
      expect(restored.domainContext).toBe("ecommerce");
    });

    it("round-trips a complex model built with ModelBuilder", () => {
      const original = new ModelBuilder("Order Management", "ecommerce")
        .withEntityType("Customer", {
          referenceMode: "customer_id",
          definition: "A person who buys things.",
          sourceContext: "crm",
        })
        .withEntityType("Order", {
          referenceMode: "order_number",
          definition: "A confirmed purchase request.",
        })
        .withValueType("Rating", {
          valueConstraint: { values: ["A", "B", "C", "D", "F"] },
        })
        .withValueType("CustomerName", {
          dataType: { name: "text", length: 50 },
        })
        .withBinaryFactType("Customer places Order", {
          role1: { player: "Customer", name: "places" },
          role2: { player: "Order", name: "is placed by" },
          uniqueness: "role2",
          mandatory: "role2",
        })
        .withDefinition(
          "Backorder",
          "An order that cannot be fulfilled from current inventory.",
          "fulfillment",
        )
        .build();

      const yaml = serializer.serialize(original);
      const restored = serializer.deserialize(yaml);

      // Model metadata
      expect(restored.name).toBe(original.name);
      expect(restored.domainContext).toBe(original.domainContext);

      // Object types
      expect(restored.objectTypes).toHaveLength(
        original.objectTypes.length,
      );
      for (let i = 0; i < original.objectTypes.length; i++) {
        const orig = original.objectTypes[i]!;
        const rest = restored.getObjectType(orig.id);
        expect(rest).toBeDefined();
        expect(rest!.name).toBe(orig.name);
        expect(rest!.kind).toBe(orig.kind);
        expect(rest!.referenceMode).toBe(orig.referenceMode);
        expect(rest!.definition).toBe(orig.definition);
        expect(rest!.sourceContext).toBe(orig.sourceContext);
        if (orig.valueConstraint) {
          expect(rest!.valueConstraint?.values).toEqual(
            orig.valueConstraint.values,
          );
        }
        if (orig.dataType) {
          expect(rest!.dataType).toBeDefined();
          expect(rest!.dataType!.name).toBe(orig.dataType.name);
          expect(rest!.dataType!.length).toBe(orig.dataType.length);
          expect(rest!.dataType!.scale).toBe(orig.dataType.scale);
        }
      }

      // Fact types
      expect(restored.factTypes).toHaveLength(original.factTypes.length);
      for (let i = 0; i < original.factTypes.length; i++) {
        const orig = original.factTypes[i]!;
        const rest = restored.getFactType(orig.id);
        expect(rest).toBeDefined();
        expect(rest!.name).toBe(orig.name);
        expect(rest!.roles.length).toBe(orig.roles.length);
        for (let j = 0; j < orig.roles.length; j++) {
          expect(rest!.roles[j]!.id).toBe(orig.roles[j]!.id);
          expect(rest!.roles[j]!.name).toBe(orig.roles[j]!.name);
          expect(rest!.roles[j]!.playerId).toBe(orig.roles[j]!.playerId);
        }
        expect(rest!.readings.length).toBe(orig.readings.length);
        for (let j = 0; j < orig.readings.length; j++) {
          expect(rest!.readings[j]!.template).toBe(
            orig.readings[j]!.template,
          );
        }
        expect(rest!.constraints.length).toBe(orig.constraints.length);
        for (let j = 0; j < orig.constraints.length; j++) {
          expect(rest!.constraints[j]).toEqual(orig.constraints[j]);
        }
      }

      // Definitions
      expect(restored.definitions).toHaveLength(
        original.definitions.length,
      );
      for (let i = 0; i < original.definitions.length; i++) {
        expect(restored.definitions[i]).toEqual(original.definitions[i]);
      }
    });

    it("round-trips a model with all constraint types", () => {
      const model = new OrmModel({ name: "Constraint Test" });
      const ot = model.addObjectType({
        name: "Widget",
        kind: "entity",
        referenceMode: "widget_id",
      });

      model.addFactType({
        name: "Widget has Color",
        roles: [
          { name: "has", playerId: ot.id, id: "r1" },
          { name: "of", playerId: ot.id, id: "r2" },
        ],
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", roleIds: ["r1"] },
          { type: "mandatory", roleId: "r2" },
          { type: "external_uniqueness", roleIds: ["r1", "r2"] },
          { type: "value_constraint", roleId: "r1", values: ["Red", "Blue"] },
        ],
      });

      const yaml = serializer.serialize(model);
      const restored = serializer.deserialize(yaml);

      const ft = restored.factTypes[0]!;
      expect(ft.constraints).toHaveLength(4);
      expect(ft.constraints[0]!.type).toBe("internal_uniqueness");
      expect(ft.constraints[1]!.type).toBe("mandatory");
      expect(ft.constraints[2]!.type).toBe("external_uniqueness");
      expect(ft.constraints[3]!.type).toBe("value_constraint");
    });

    it("produces YAML that matches the architecture doc format", () => {
      const model = new OrmModel({
        name: "Order Management",
        domainContext: "ecommerce",
      });
      model.addObjectType({
        id: "ot-001",
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
        definition: "A person or organization that has placed at least one order.",
        sourceContext: "crm",
      });

      const yaml = serializer.serialize(model);

      // The YAML should be readable and match the documented format.
      expect(yaml).toContain('orm_version: "1.1"');
      expect(yaml).toContain("name: Order Management");
      expect(yaml).toContain("domain_context: ecommerce");
      expect(yaml).toContain("id: ot-001");
      expect(yaml).toContain("name: Customer");
      expect(yaml).toContain("kind: entity");
      expect(yaml).toContain("reference_mode: customer_id");
    });
  });
});
