/**
 * Round-trip serialization integration tests.
 *
 * These tests load realistic .orm.yaml fixture files (Order Management,
 * Phase 2 Constraints, Objectified Fact Types), deserialize them into OrmModels, re-serialize
 * to YAML, and deserialize again. Every model element (object types,
 * fact types, roles, constraints, definitions, value constraints) is
 * checked for structural equivalence after the round trip, ensuring the
 * serializer is lossless.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serializer = new OrmYamlSerializer();

function loadFixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "fixtures", name),
    "utf-8",
  );
}

describe("Round-trip serialization integration", () => {
  it("round-trips the Order Management model", () => {
    const yaml = loadFixture("orderManagement.orm.yaml");
    const model = serializer.deserialize(yaml);

    // Verify the model was loaded correctly.
    expect(model.name).toBe("Order Management");
    expect(model.domainContext).toBe("ecommerce");
    expect(model.objectTypes).toHaveLength(7);
    expect(model.factTypes).toHaveLength(5);
    expect(model.definitions).toHaveLength(2);

    // Serialize back to YAML and deserialize again.
    const reserialized = serializer.serialize(model);
    const roundTripped = serializer.deserialize(reserialized);

    // Verify structural equivalence.
    expect(roundTripped.name).toBe(model.name);
    expect(roundTripped.domainContext).toBe(model.domainContext);
    expect(roundTripped.objectTypes).toHaveLength(model.objectTypes.length);
    expect(roundTripped.factTypes).toHaveLength(model.factTypes.length);
    expect(roundTripped.definitions).toHaveLength(model.definitions.length);
  });

  it("preserves object type details through round-trip", () => {
    const yaml = loadFixture("orderManagement.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    for (const origOt of original.objectTypes) {
      const rtOt = roundTripped.getObjectType(origOt.id);
      expect(rtOt).toBeDefined();
      expect(rtOt!.name).toBe(origOt.name);
      expect(rtOt!.kind).toBe(origOt.kind);
      expect(rtOt!.referenceMode).toBe(origOt.referenceMode);
      expect(rtOt!.definition).toBe(origOt.definition);
      expect(rtOt!.sourceContext).toBe(origOt.sourceContext);
    }
  });

  it("preserves fact type details through round-trip", () => {
    const yaml = loadFixture("orderManagement.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    for (const origFt of original.factTypes) {
      const rtFt = roundTripped.getFactType(origFt.id);
      expect(rtFt).toBeDefined();
      expect(rtFt!.name).toBe(origFt.name);
      expect(rtFt!.definition).toBe(origFt.definition);
      expect(rtFt!.arity).toBe(origFt.arity);
      expect(rtFt!.readings).toHaveLength(origFt.readings.length);
      expect(rtFt!.internalConstraints).toHaveLength(origFt.internalConstraints.length);

      // Verify each role.
      for (let i = 0; i < origFt.roles.length; i++) {
        const origRole = origFt.roles[i]!;
        const rtRole = rtFt!.roles[i]!;
        expect(rtRole.id).toBe(origRole.id);
        expect(rtRole.name).toBe(origRole.name);
        expect(rtRole.playerId).toBe(origRole.playerId);
      }

      // Verify constraint types match.
      for (let i = 0; i < origFt.internalConstraints.length; i++) {
        expect(rtFt!.internalConstraints[i]!.type).toBe(origFt.internalConstraints[i]!.type);
      }
    }
  });

  it("preserves value constraints through round-trip", () => {
    const yaml = loadFixture("orderManagement.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    const origRating = original.getObjectTypeByName("Rating");
    const rtRating = roundTripped.getObjectTypeByName("Rating");
    expect(origRating).toBeDefined();
    expect(rtRating).toBeDefined();
    expect(rtRating!.valueConstraint).toEqual(origRating!.valueConstraint);
  });

  it("preserves definitions through round-trip", () => {
    const yaml = loadFixture("orderManagement.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    for (let i = 0; i < original.definitions.length; i++) {
      const origDef = original.definitions[i]!;
      const rtDef = roundTripped.definitions[i]!;
      expect(rtDef.term).toBe(origDef.term);
      expect(rtDef.definition).toBe(origDef.definition);
      expect(rtDef.context).toBe(origDef.context);
    }
  });

  it("round-trips the Phase 2 constraints model", () => {
    const yaml = loadFixture("phase2Constraints.orm.yaml");
    const model = serializer.deserialize(yaml);

    expect(model.name).toBe("Phase 2 Constraint Showcase");
    expect(model.objectTypes).toHaveLength(4);
    expect(model.factTypes).toHaveLength(4);

    // Verify specific Phase 2 constraints loaded correctly.
    const drivesFt = model.getFactTypeByName("Person drives Car");
    expect(drivesFt).toBeDefined();
    const xorConstraint = model.constraintsTouching(drivesFt!.id).find(
      (c) => c.type === "exclusive_or",
    );
    expect(xorConstraint).toBeDefined();

    const purchaseFt = model.getFactTypeByName("Person purchases Ticket");
    expect(purchaseFt).toBeDefined();
    const subsetConstraint = model.constraintsTouching(purchaseFt!.id).find(
      (c) => c.type === "subset",
    );
    expect(subsetConstraint).toBeDefined();

    const parentFt = model.getFactTypeByName("Person is parent of Person");
    expect(parentFt).toBeDefined();
    const ringConstraints = parentFt!.internalConstraints.filter(
      (c) => c.type === "ring",
    );
    expect(ringConstraints).toHaveLength(2);

    // Round-trip.
    const reserialized = serializer.serialize(model);
    const roundTripped = serializer.deserialize(reserialized);

    expect(roundTripped.objectTypes).toHaveLength(model.objectTypes.length);
    expect(roundTripped.factTypes).toHaveLength(model.factTypes.length);

    // The constraints across fact types (the exclusive-or and the subset
    // among them) survive whole; no fact type's own list holds them.
    expect(model.constraints.length).toBeGreaterThan(0);
    expect(roundTripped.constraints).toEqual(model.constraints);

    // Verify the ring constraints survived.
    const rtParent = roundTripped.getFactTypeByName(
      "Person is parent of Person",
    );
    expect(rtParent).toBeDefined();
    const rtRings = rtParent!.internalConstraints.filter((c) => c.type === "ring");
    expect(rtRings).toHaveLength(2);
  });

  it("round-trips the Objectified Fact Types model", () => {
    const yaml = loadFixture("objectifiedFactTypes.orm.yaml");
    const model = serializer.deserialize(yaml);

    expect(model.name).toBe("University Enrollment");
    expect(model.domainContext).toBe("education");
    expect(model.objectTypes).toHaveLength(6);
    expect(model.factTypes).toHaveLength(4);
    expect(model.objectifiedFactTypes).toHaveLength(1);
    expect(model.definitions).toHaveLength(1);

    // Verify the objectified fact type loaded correctly.
    const oft = model.objectifiedFactTypes[0]!;
    expect(oft.id).toBe("oft-enrollment");
    expect(oft.factTypeId).toBe("ft-student-enrolls-course");
    expect(oft.objectTypeId).toBe("ot-enrollment");

    // Round-trip.
    const reserialized = serializer.serialize(model);
    const roundTripped = serializer.deserialize(reserialized);

    // Verify structural equivalence.
    expect(roundTripped.name).toBe(model.name);
    expect(roundTripped.domainContext).toBe(model.domainContext);
    expect(roundTripped.objectTypes).toHaveLength(model.objectTypes.length);
    expect(roundTripped.factTypes).toHaveLength(model.factTypes.length);
    expect(roundTripped.objectifiedFactTypes).toHaveLength(1);
    expect(roundTripped.definitions).toHaveLength(model.definitions.length);
  });

  it("preserves objectified fact type details through round-trip", () => {
    const yaml = loadFixture("objectifiedFactTypes.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    // Verify each objectified fact type survived the round trip.
    for (const origOft of original.objectifiedFactTypes) {
      const rtOft = roundTripped.getObjectifiedFactType(origOft.id);
      expect(rtOft).toBeDefined();
      expect(rtOft!.id).toBe(origOft.id);
      expect(rtOft!.factTypeId).toBe(origOft.factTypeId);
      expect(rtOft!.objectTypeId).toBe(origOft.objectTypeId);
    }

    // Verify the objectification query helpers work on the round-tripped model.
    const oft = roundTripped.objectificationOf("ft-student-enrolls-course");
    expect(oft).toBeDefined();
    expect(oft!.objectTypeId).toBe("ot-enrollment");

    const oftForEntity = roundTripped.objectificationFor("ot-enrollment");
    expect(oftForEntity).toBeDefined();
    expect(oftForEntity!.factTypeId).toBe("ft-student-enrolls-course");
  });

  it("round-trips the Population Instances model", () => {
    const yaml = loadFixture("populationInstances.orm.yaml");
    const model = serializer.deserialize(yaml);

    expect(model.name).toBe("Order Management with Populations");
    expect(model.populations).toHaveLength(2);

    // Round-trip.
    const reserialized = serializer.serialize(model);
    const roundTripped = serializer.deserialize(reserialized);

    // Verify structural equivalence.
    expect(roundTripped.name).toBe(model.name);
    expect(roundTripped.objectTypes).toHaveLength(model.objectTypes.length);
    expect(roundTripped.factTypes).toHaveLength(model.factTypes.length);
    expect(roundTripped.populations).toHaveLength(model.populations.length);
  });

  it("preserves population details through round-trip", () => {
    const yaml = loadFixture("populationInstances.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    for (const origPop of original.populations) {
      const rtPop = roundTripped.getPopulation(origPop.id);
      expect(rtPop).toBeDefined();
      expect(rtPop!.id).toBe(origPop.id);
      expect(rtPop!.factTypeId).toBe(origPop.factTypeId);
      expect(rtPop!.description).toBe(origPop.description);
      expect(rtPop!.instances).toHaveLength(origPop.instances.length);

      for (let i = 0; i < origPop.instances.length; i++) {
        const origInst = origPop.instances[i]!;
        const rtInst = rtPop!.instances[i]!;
        expect(rtInst.id).toBe(origInst.id);
        expect(rtInst.roleValues).toEqual(origInst.roleValues);
      }
    }
  });

  it("preserves value constraints on Grade through round-trip with objectification", () => {
    const yaml = loadFixture("objectifiedFactTypes.orm.yaml");
    const original = serializer.deserialize(yaml);
    const roundTripped = serializer.deserialize(
      serializer.serialize(original),
    );

    const origGrade = original.getObjectTypeByName("Grade");
    const rtGrade = roundTripped.getObjectTypeByName("Grade");
    expect(origGrade).toBeDefined();
    expect(rtGrade).toBeDefined();
    expect(rtGrade!.valueConstraint).toEqual(origGrade!.valueConstraint);
  });
});
