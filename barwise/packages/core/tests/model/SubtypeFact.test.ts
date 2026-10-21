/**
 * Tests for SubtypeFact model class and OrmModel subtype management.
 *
 * SubtypeFact represents a specialization relationship between entity
 * types (e.g., "Employee is a subtype of Person"). These tests verify:
 *   - Construction and property access
 *   - Self-referencing prevention
 *   - OrmModel CRUD operations for subtype facts
 *   - Entity-only enforcement (value types cannot participate)
 *   - Duplicate prevention
 *   - supertypesOf / subtypesOf query methods
 *   - Cascading reference checks on removeObjectType
 *   - Element count includes subtype facts
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { SubtypeFact } from "../../src/model/SubtypeFact.js";

describe("SubtypeFact", () => {
  describe("construction", () => {
    it("creates with required properties", () => {
      const sf = new SubtypeFact({
        subtypeId: "sub-1",
        supertypeId: "super-1",
      });
      expect(sf.subtypeId).toBe("sub-1");
      expect(sf.supertypeId).toBe("super-1");
      expect(sf.providesIdentification).toBe(true);
      expect(sf.id).toBeTruthy();
    });

    it("accepts custom id", () => {
      const sf = new SubtypeFact({
        id: "custom-id",
        subtypeId: "sub-1",
        supertypeId: "super-1",
      });
      expect(sf.id).toBe("custom-id");
    });

    it("accepts providesIdentification = false", () => {
      const sf = new SubtypeFact({
        subtypeId: "sub-1",
        supertypeId: "super-1",
        providesIdentification: false,
      });
      expect(sf.providesIdentification).toBe(false);
    });

    it("defaults providesIdentification to true", () => {
      const sf = new SubtypeFact({
        subtypeId: "sub-1",
        supertypeId: "super-1",
      });
      expect(sf.providesIdentification).toBe(true);
    });

    it("throws when subtype equals supertype", () => {
      expect(
        () =>
          new SubtypeFact({
            subtypeId: "same-id",
            supertypeId: "same-id",
          }),
      ).toThrow("same entity");
    });
  });
});

describe("OrmModel subtype facts", () => {
  function makeModelWithEntities(): OrmModel {
    const model = new OrmModel({ name: "Test" });
    model.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
    model.addObjectType({ name: "Employee", kind: "entity", referenceMode: "employee_id" });
    model.addObjectType({ name: "Manager", kind: "entity", referenceMode: "manager_id" });
    return model;
  }

  describe("addSubtypeFact", () => {
    it("adds a subtype fact between two entity types", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      const sf = model.addSubtypeFact({
        subtypeId: employee.id,
        supertypeId: person.id,
      });

      expect(sf).toBeInstanceOf(SubtypeFact);
      expect(sf.subtypeId).toBe(employee.id);
      expect(sf.supertypeId).toBe(person.id);
      expect(model.subtypeFacts).toHaveLength(1);
    });

    it("throws when subtype entity does not exist", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;

      expect(() =>
        model.addSubtypeFact({
          subtypeId: "nonexistent",
          supertypeId: person.id,
        })
      ).toThrow("does not exist");
    });

    it("throws when supertype entity does not exist", () => {
      const model = makeModelWithEntities();
      const employee = model.getObjectTypeByName("Employee")!;

      expect(() =>
        model.addSubtypeFact({
          subtypeId: employee.id,
          supertypeId: "nonexistent",
        })
      ).toThrow("does not exist");
    });

    it("throws when subtype is a value type", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
      const valueName = model.addObjectType({ name: "Name", kind: "value" });
      const person = model.getObjectTypeByName("Person")!;

      expect(() =>
        model.addSubtypeFact({
          subtypeId: valueName.id,
          supertypeId: person.id,
        })
      ).toThrow("entity type");
    });

    it("throws when supertype is a value type", () => {
      const model = new OrmModel({ name: "Test" });
      model.addObjectType({ name: "Person", kind: "entity", referenceMode: "person_id" });
      const valueName = model.addObjectType({ name: "Name", kind: "value" });
      const person = model.getObjectTypeByName("Person")!;

      expect(() =>
        model.addSubtypeFact({
          subtypeId: person.id,
          supertypeId: valueName.id,
        })
      ).toThrow("entity type");
    });

    it("throws on duplicate subtype relationship", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      model.addSubtypeFact({
        subtypeId: employee.id,
        supertypeId: person.id,
      });

      expect(() =>
        model.addSubtypeFact({
          subtypeId: employee.id,
          supertypeId: person.id,
        })
      ).toThrow("already exists");
    });

    it("allows multiple supertypes for one subtype", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;
      const manager = model.getObjectTypeByName("Manager")!;

      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });
      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: manager.id });

      expect(model.subtypeFacts).toHaveLength(2);
    });
  });

  describe("getSubtypeFact", () => {
    it("retrieves by id", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      const sf = model.addSubtypeFact({
        subtypeId: employee.id,
        supertypeId: person.id,
      });

      expect(model.getSubtypeFact(sf.id)).toBe(sf);
    });

    it("returns undefined for nonexistent id", () => {
      const model = makeModelWithEntities();
      expect(model.getSubtypeFact("nonexistent")).toBeUndefined();
    });
  });

  describe("removeSubtypeFact", () => {
    it("removes an existing subtype fact", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      const sf = model.addSubtypeFact({
        subtypeId: employee.id,
        supertypeId: person.id,
      });

      model.removeSubtypeFact(sf.id);
      expect(model.subtypeFacts).toHaveLength(0);
    });

    it("throws for nonexistent id", () => {
      const model = makeModelWithEntities();
      expect(() => model.removeSubtypeFact("nonexistent")).toThrow("not found");
    });
  });

  describe("supertypesOf / subtypesOf", () => {
    it("returns direct supertypes", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });

      const supertypes = model.supertypesOf(employee.id);
      expect(supertypes).toHaveLength(1);
      expect(supertypes[0]!.name).toBe("Person");
    });

    it("returns direct subtypes", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;
      const manager = model.getObjectTypeByName("Manager")!;

      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });
      model.addSubtypeFact({ subtypeId: manager.id, supertypeId: person.id });

      const subtypes = model.subtypesOf(person.id);
      expect(subtypes).toHaveLength(2);
      expect(subtypes.map((s) => s.name).sort()).toEqual(["Employee", "Manager"]);
    });

    it("returns empty for entity with no supertypes", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      expect(model.supertypesOf(person.id)).toHaveLength(0);
    });

    it("returns empty for entity with no subtypes", () => {
      const model = makeModelWithEntities();
      const employee = model.getObjectTypeByName("Employee")!;
      expect(model.subtypesOf(employee.id)).toHaveLength(0);
    });
  });

  describe("removeObjectType with subtype references", () => {
    it("prevents removal when entity is a subtype", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });

      expect(() => model.removeObjectType(employee.id)).toThrow(
        "referenced by a subtype fact",
      );
    });

    it("prevents removal when entity is a supertype", () => {
      const model = makeModelWithEntities();
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });

      expect(() => model.removeObjectType(person.id)).toThrow(
        "referenced by a subtype fact",
      );
    });
  });

  describe("elementCount", () => {
    it("includes subtype facts in count", () => {
      const model = makeModelWithEntities();
      const baseCt = model.elementCount;
      const person = model.getObjectTypeByName("Person")!;
      const employee = model.getObjectTypeByName("Employee")!;

      model.addSubtypeFact({ subtypeId: employee.id, supertypeId: person.id });
      expect(model.elementCount).toBe(baseCt + 1);
    });
  });
});
