/**
 * Tests for ObjectifiedFactType model class and OrmModel objectification
 * management.
 *
 * ObjectifiedFactType declares that a fact type is simultaneously an
 * entity type (nesting). These tests verify:
 *   - Construction and property access
 *   - Self-referencing prevention
 *   - OrmModel CRUD operations for objectified fact types
 *   - Entity-only enforcement (value types cannot be objectifications)
 *   - Duplicate prevention (one objectification per fact type / entity type)
 *   - objectificationOf / objectificationFor query methods
 *   - Cascading reference checks on removeObjectType and removeFactType
 *   - Element count includes objectified fact types
 *   - ModelBuilder integration
 */
import { describe, expect, it } from "vitest";
import { objectificationRef, ObjectifiedFactType } from "../../src/model/ObjectifiedFactType.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ModelBuilder } from "../helpers/ModelBuilder.js";

describe("ObjectifiedFactType", () => {
  describe("construction", () => {
    it("creates with required properties", () => {
      const oft = new ObjectifiedFactType({
        factTypeId: "ft-1",
        objectTypeId: "ot-1",
      });
      expect(oft.factTypeId).toBe("ft-1");
      expect(oft.objectTypeId).toBe("ot-1");
      // Unnamed until a model names it (iri-identity decision 19).
      expect(oft.id).toBeUndefined();
    });

    it("accepts custom id", () => {
      const oft = new ObjectifiedFactType({
        id: "custom-id",
        factTypeId: "ft-1",
        objectTypeId: "ot-1",
      });
      expect(oft.id).toBe("custom-id");
    });

    it("is referred to by its id, or by what it relates when it has none", () => {
      const unnamed = new ObjectifiedFactType({ factTypeId: "ft-1", objectTypeId: "ot-1" });
      expect(objectificationRef(unnamed)).toBe("unnamed:ot-1=ft-1");
      const named = new ObjectifiedFactType({ id: "o", factTypeId: "ft-1", objectTypeId: "ot-1" });
      expect(objectificationRef(named)).toBe("o");
    });

    it("throws when factTypeId equals objectTypeId", () => {
      expect(
        () =>
          new ObjectifiedFactType({
            factTypeId: "same-id",
            objectTypeId: "same-id",
          }),
      ).toThrow("same id");
    });
  });
});

describe("OrmModel objectified fact types", () => {
  function makeModel(): OrmModel {
    const model = new OrmModel({ name: "Test" });
    const person = model.addObjectType({
      name: "Person",
      kind: "entity",
      referenceMode: "person_id",
    });
    model.addObjectType({ name: "Date", kind: "value" });
    model.addObjectType({
      name: "Marriage",
      kind: "entity",
      referenceMode: "marriage_id",
    });
    model.addFactType({
      name: "Person marries Person",
      roles: [
        { name: "marries", playerId: person.id },
        { name: "is married to", playerId: person.id },
      ],
      readings: ["{0} marries {1}", "{1} is married to {0}"],
    });
    return model;
  }

  describe("addObjectifiedFactType", () => {
    it("adds an objectified fact type linking a fact type to an entity type", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      const oft = model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(oft).toBeInstanceOf(ObjectifiedFactType);
      expect(oft.factTypeId).toBe(ft.id);
      expect(oft.objectTypeId).toBe(marriage.id);
      expect(model.objectifiedFactTypes).toHaveLength(1);
    });

    it("throws when fact type does not exist", () => {
      const model = makeModel();
      const marriage = model.getObjectTypeByName("Marriage")!;

      expect(() =>
        model.addObjectifiedFactType({
          factTypeId: "nonexistent",
          objectTypeId: marriage.id,
        })
      ).toThrow("does not exist");
    });

    it("throws when object type does not exist", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;

      expect(() =>
        model.addObjectifiedFactType({
          factTypeId: ft.id,
          objectTypeId: "nonexistent",
        })
      ).toThrow("does not exist");
    });

    it("throws when object type is a value type", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const date = model.getObjectTypeByName("Date")!;

      expect(() =>
        model.addObjectifiedFactType({
          factTypeId: ft.id,
          objectTypeId: date.id,
        })
      ).toThrow("entity type");
    });

    it("throws when fact type is already objectified", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      // Try to objectify the same fact type with a different entity.
      model.addObjectType({
        name: "Union",
        kind: "entity",
        referenceMode: "union_id",
      });
      const union = model.getObjectTypeByName("Union")!;

      expect(() =>
        model.addObjectifiedFactType({
          factTypeId: ft.id,
          objectTypeId: union.id,
        })
      ).toThrow("already objectified");
    });

    it("throws when object type is already used as an objectification", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      // Add a second fact type and try to objectify it with the same entity.
      const person = model.getObjectTypeByName("Person")!;
      model.addFactType({
        name: "Person employs Person",
        roles: [
          { name: "employs", playerId: person.id },
          { name: "is employed by", playerId: person.id },
        ],
        readings: ["{0} employs {1}", "{1} is employed by {0}"],
      });
      const ft2 = model.getFactTypeByName("Person employs Person")!;

      expect(() =>
        model.addObjectifiedFactType({
          factTypeId: ft2.id,
          objectTypeId: marriage.id,
        })
      ).toThrow("already used as an objectification");
    });
  });

  describe("getObjectifiedFactType", () => {
    it("retrieves by id", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      const oft = model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(model.getObjectifiedFactType(oft.id)).toBe(oft);
    });

    it("returns undefined for nonexistent id", () => {
      const model = makeModel();
      expect(model.getObjectifiedFactType("nonexistent")).toBeUndefined();
    });
  });

  describe("removeObjectifiedFactType", () => {
    it("removes an existing objectified fact type", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      const oft = model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      model.removeObjectifiedFactType(oft.id);
      expect(model.objectifiedFactTypes).toHaveLength(0);
    });

    it("throws for nonexistent id", () => {
      const model = makeModel();
      expect(() => model.removeObjectifiedFactType("nonexistent")).toThrow(
        "not found",
      );
    });
  });

  describe("objectificationOf / objectificationFor", () => {
    it("returns objectification for a given fact type", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      const oft = model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(model.objectificationOf(ft.id)).toBe(oft);
    });

    it("returns undefined when fact type is not objectified", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      expect(model.objectificationOf(ft.id)).toBeUndefined();
    });

    it("returns objectification for a given entity type", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      const oft = model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(model.objectificationFor(marriage.id)).toBe(oft);
    });

    it("returns undefined when entity is not an objectification", () => {
      const model = makeModel();
      const person = model.getObjectTypeByName("Person")!;
      expect(model.objectificationFor(person.id)).toBeUndefined();
    });
  });

  describe("removeObjectType with objectification references", () => {
    it("prevents removal when entity is an objectification target", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(() => model.removeObjectType(marriage.id)).toThrow(
        "referenced by an objectified fact type",
      );
    });
  });

  describe("removeFactType with objectification references", () => {
    it("prevents removal when fact type is objectified", () => {
      const model = makeModel();
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(() => model.removeFactType(ft.id)).toThrow(
        "referenced by an objectified fact type",
      );
    });
  });

  describe("elementCount", () => {
    it("includes objectified fact types in count", () => {
      const model = makeModel();
      const baseCt = model.elementCount;
      const ft = model.getFactTypeByName("Person marries Person")!;
      const marriage = model.getObjectTypeByName("Marriage")!;

      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: marriage.id,
      });

      expect(model.elementCount).toBe(baseCt + 1);
    });
  });
});

describe("ModelBuilder objectified fact types", () => {
  it("builds a model with an objectified fact type", () => {
    const model = new ModelBuilder("Marriage Test")
      .withEntityType("Person")
      .withEntityType("Marriage")
      .withBinaryFactType("Person marries Person", {
        role1: { player: "Person", name: "marries" },
        role2: { player: "Person", name: "is married to" },
        uniqueness: "spanning",
      })
      .withObjectifiedFactType("Person marries Person", "Marriage")
      .build();

    expect(model.objectifiedFactTypes).toHaveLength(1);
    const oft = model.objectifiedFactTypes[0]!;
    expect(oft.factTypeId).toBe(
      model.getFactTypeByName("Person marries Person")!.id,
    );
    expect(oft.objectTypeId).toBe(model.getObjectTypeByName("Marriage")!.id);
  });

  it("throws when fact type name does not exist", () => {
    const builder = new ModelBuilder("Test")
      .withEntityType("Person")
      .withEntityType("Marriage")
      .withObjectifiedFactType("Nonexistent", "Marriage");

    expect(() => builder.build()).toThrow("not found");
  });

  it("throws when object type name does not exist", () => {
    const builder = new ModelBuilder("Test")
      .withEntityType("Person")
      .withBinaryFactType("Person marries Person", {
        role1: { player: "Person", name: "marries" },
        role2: { player: "Person", name: "is married to" },
      })
      .withObjectifiedFactType("Person marries Person", "Nonexistent");

    expect(() => builder.build()).toThrow("not found");
  });
});
