/**
 * Integration tests for the NORMA XML import pipeline.
 *
 * These tests exercise the full import path: XML file -> parse -> map -> OrmModel.
 * They use hand-crafted .orm fixture files that mirror the documented NORMA
 * XML format without embedding any NORMA source code.
 */
import { ValidationEngine } from "@barwise/core";
import { RelationalMapper, renderDdl } from "@barwise/core/mapping";
import { Verbalizer } from "@barwise/core/verbalization";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { importNormaXml, NormaImportError } from "../src/NormaXmlImporter.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const validator = new ValidationEngine();
const verbalizer = new Verbalizer();
const mapper = new RelationalMapper();

function loadFixture(name: string): string {
  return readFileSync(resolve(__dirname, "fixtures", name), "utf-8");
}

describe("NORMA XML Import integration", () => {
  describe("Order Management model", () => {
    const xml = loadFixture("orderManagement.orm");
    const model = importNormaXml(xml);

    it("imports the model with correct name", () => {
      expect(model.name).toBe("Order Management");
    });

    it("imports all entity types", () => {
      const customer = model.getObjectTypeByName("Customer");
      const order = model.getObjectTypeByName("Order");
      expect(customer).toBeDefined();
      expect(customer!.kind).toBe("entity");
      expect(order).toBeDefined();
      expect(order!.kind).toBe("entity");
    });

    it("imports all value types", () => {
      const name = model.getObjectTypeByName("Name");
      const date = model.getObjectTypeByName("Date");
      const rating = model.getObjectTypeByName("Rating");
      expect(name).toBeDefined();
      expect(name!.kind).toBe("value");
      expect(date!.kind).toBe("value");
      expect(rating!.kind).toBe("value");
    });

    it("imports value type with inline value constraint", () => {
      const rating = model.getObjectTypeByName("Rating")!;
      expect(rating.valueConstraint).toBeDefined();
      expect(rating.valueConstraint!.values).toEqual(["1", "2", "3", "4", "5"]);
    });

    it("imports entity type definition", () => {
      const customer = model.getObjectTypeByName("Customer")!;
      expect(customer.definition).toBe(
        "A person or organization that places orders.",
      );
    });

    it("imports all fact types with readings", () => {
      expect(model.factTypes).toHaveLength(3);

      const places = model.getFactTypeByName("Customer places Order")!;
      expect(places).toBeDefined();
      expect(places.arity).toBe(2);
      // Should have readings from both reading orders.
      expect(places.readings.length).toBeGreaterThanOrEqual(1);
      expect(places.readings[0]!.template).toBe("{0} places {1}");
    });

    it("imports uniqueness constraints", () => {
      const places = model.getFactTypeByName("Customer places Order")!;
      const uc = places.constraints.find(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uc).toBeDefined();
    });

    it("imports mandatory constraints", () => {
      const places = model.getFactTypeByName("Customer places Order")!;
      const mc = places.constraints.find((c) => c.type === "mandatory");
      expect(mc).toBeDefined();
    });

    it("produces a model that passes validation", () => {
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });

    it("produces a model that can be verbalized", () => {
      const verbalizations = verbalizer.verbalizeModel(model);
      expect(verbalizations.length).toBeGreaterThan(0);
      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Customer"))).toBe(true);
      expect(texts.some((t) => t.includes("Order"))).toBe(true);
    });

    it("produces a model that can be mapped to relational schema", () => {
      const schema = mapper.map(model);
      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("customer");
      expect(tableNames).toContain("order");
    });

    it("produces valid DDL from the mapped schema", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);
      expect(ddl).toContain("CREATE TABLE customer");
      expect(ddl).toContain("CREATE TABLE order");
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });
  });

  describe("University Enrollment model (objectified + subtypes)", () => {
    const xml = loadFixture("universityEnrollment.orm");
    const model = importNormaXml(xml);

    it("imports the model with correct name", () => {
      expect(model.name).toBe("University Enrollment");
    });

    it("imports entity types including objectified type", () => {
      expect(model.getObjectTypeByName("Person")).toBeDefined();
      expect(model.getObjectTypeByName("Student")).toBeDefined();
      expect(model.getObjectTypeByName("Course")).toBeDefined();
      expect(model.getObjectTypeByName("Enrollment")).toBeDefined();
    });

    it("imports value type with value constraint", () => {
      const grade = model.getObjectTypeByName("Grade")!;
      expect(grade.kind).toBe("value");
      expect(grade.valueConstraint).toBeDefined();
      expect(grade.valueConstraint!.values).toEqual(["A", "B", "C", "D", "F"]);
    });

    it("imports subtype fact (Student is-a Person)", () => {
      expect(model.subtypeFacts).toHaveLength(1);
      const sf = model.subtypeFacts[0]!;
      expect(sf.subtypeId).toBe(model.getObjectTypeByName("Student")!.id);
      expect(sf.supertypeId).toBe(model.getObjectTypeByName("Person")!.id);
      expect(sf.providesIdentification).toBe(true);
    });

    it("imports objectified fact type (Enrollment)", () => {
      expect(model.objectifiedFactTypes).toHaveLength(1);
      const oft = model.objectifiedFactTypes[0]!;
      expect(oft.objectTypeId).toBe(model.getObjectTypeByName("Enrollment")!.id);
      const enrollsFt = model.getFactTypeByName("Student enrolls in Course")!;
      expect(oft.factTypeId).toBe(enrollsFt.id);
    });

    it("imports ring constraint on self-referencing fact type", () => {
      const mentors = model.getFactTypeByName("Person mentors Person")!;
      expect(mentors).toBeDefined();
      const ring = mentors.constraints.find((c) => c.type === "ring");
      expect(ring).toBeDefined();
      if (ring?.type === "ring") {
        expect(ring.ringType).toBe("irreflexive");
      }
    });

    it("imports spanning uniqueness on the objectified fact type", () => {
      const enrolls = model.getFactTypeByName("Student enrolls in Course")!;
      const uc = enrolls.constraints.find(
        (c) => c.type === "internal_uniqueness",
      );
      expect(uc).toBeDefined();
      if (uc?.type === "internal_uniqueness") {
        expect(uc.roleIds).toHaveLength(2);
      }
    });

    it("produces a model that passes validation", () => {
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });

    it("produces a model that can be verbalized", () => {
      const verbalizations = verbalizer.verbalizeModel(model);
      expect(verbalizations.length).toBeGreaterThan(0);
      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Student"))).toBe(true);
      expect(texts.some((t) => t.includes("Course"))).toBe(true);
    });

    it("produces a model that can be mapped to relational schema", () => {
      const schema = mapper.map(model);
      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("person");
      expect(tableNames).toContain("student");
      expect(tableNames).toContain("course");
      expect(tableNames).toContain("enrollment");
    });

    it("renders valid DDL", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);
      expect(ddl).toContain("CREATE TABLE enrollment");
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });
  });

  describe("PersonCountryDemo (real NORMA-generated file)", () => {
    const xml = loadFixture("personCountryDemo.orm");
    const model = importNormaXml(xml);

    it("imports the model name", () => {
      expect(model.name).toBe("PersonCountryDemo");
    });

    it("imports all entity types", () => {
      const person = model.getObjectTypeByName("Person");
      const country = model.getObjectTypeByName("Country");
      const region = model.getObjectTypeByName("Region");
      expect(person).toBeDefined();
      expect(person!.kind).toBe("entity");
      expect(country).toBeDefined();
      expect(country!.kind).toBe("entity");
      expect(region).toBeDefined();
      expect(region!.kind).toBe("entity");
    });

    it("imports entity reference modes", () => {
      const person = model.getObjectTypeByName("Person")!;
      expect(person.referenceMode).toBe("id");
      const country = model.getObjectTypeByName("Country")!;
      expect(country.referenceMode).toBe("name");
      const region = model.getObjectTypeByName("Region")!;
      expect(region.referenceMode).toBe("code");
    });

    it("imports all value types", () => {
      const personId = model.getObjectTypeByName("Person_id");
      const title = model.getObjectTypeByName("Title");
      const firstName = model.getObjectTypeByName("FirstName");
      const lastName = model.getObjectTypeByName("LastName");
      const countryName = model.getObjectTypeByName("Country_name");
      const regionCode = model.getObjectTypeByName("Region_code");
      expect(personId).toBeDefined();
      expect(personId!.kind).toBe("value");
      expect(title!.kind).toBe("value");
      expect(firstName!.kind).toBe("value");
      expect(lastName!.kind).toBe("value");
      expect(countryName!.kind).toBe("value");
      expect(regionCode!.kind).toBe("value");
    });

    it("resolves data types from NORMA DataTypes section", () => {
      // PersonCountryDemo value types have ConceptualDataType refs.
      // Person_id should be auto_counter, FirstName should be text, etc.
      const personId = model.getObjectTypeByName("Person_id")!;
      expect(personId.dataType).toBeDefined();
      expect(personId.dataType!.name).toBe("auto_counter");

      const firstName = model.getObjectTypeByName("FirstName")!;
      expect(firstName.dataType).toBeDefined();
      expect(firstName.dataType!.name).toBe("text");
      // FirstName has Length=30 in the NORMA file
      expect(firstName.dataType!.length).toBe(30);
    });

    it("imports value type with value constraint (Title)", () => {
      const title = model.getObjectTypeByName("Title")!;
      expect(title.valueConstraint).toBeDefined();
      expect(title.valueConstraint!.values).toEqual(
        expect.arrayContaining(["Dr", "Prof", "Mr", "Mrs", "Miss", "Ms"]),
      );
      expect(title.valueConstraint!.values).toHaveLength(6);
    });

    it("imports all 8 fact types", () => {
      expect(model.factTypes).toHaveLength(8);
    });

    it("imports fact types with correct readings", () => {
      const personHasId = model.getFactTypeByName("PersonHasPersonId")!;
      expect(personHasId).toBeDefined();
      expect(personHasId.arity).toBe(2);
      expect(personHasId.readings[0]!.template).toBe("{0} has {1}");
    });

    it("imports fact types with multiple readings", () => {
      const personHasId = model.getFactTypeByName("PersonHasPersonId")!;
      // Two reading orders: "{0} has {1}" and "{0} is of {1}"
      expect(personHasId.readings.length).toBeGreaterThanOrEqual(2);
    });

    it("imports uniqueness constraints from constraint role refs", () => {
      const personHasId = model.getFactTypeByName("PersonHasPersonId")!;
      const ucs = personHasId.constraints.filter(
        (c) => c.type === "internal_uniqueness",
      );
      // PersonHasPersonId has 2 uniqueness constraints (one on each role)
      expect(ucs.length).toBeGreaterThanOrEqual(2);
    });

    it("imports mandatory constraints", () => {
      const personHasId = model.getFactTypeByName("PersonHasPersonId")!;
      const mcs = personHasId.constraints.filter(
        (c) => c.type === "mandatory",
      );
      expect(mcs.length).toBeGreaterThanOrEqual(1);
    });

    it("imports preferred identifier flag on uniqueness constraints", () => {
      // PersonHasPersonId should have a uniqueness constraint marked as preferred.
      const personHasId = model.getFactTypeByName("PersonHasPersonId")!;
      const preferredUcs = personHasId.constraints.filter(
        (c) => c.type === "internal_uniqueness" && c.isPreferred,
      );
      expect(preferredUcs.length).toBeGreaterThanOrEqual(1);
    });

    it("does not import implied mandatory constraints as explicit constraints", () => {
      // ImpliedMandatoryConstraints should be filtered out. They are
      // auto-generated by NORMA and not part of the user's model.
      // Count total mandatory constraints across all fact types.
      let mandatoryCount = 0;
      for (const ft of model.factTypes) {
        mandatoryCount += ft.constraints.filter(
          (c) => c.type === "mandatory",
        ).length;
      }
      // The file has 5 simple mandatory constraints and 8 implied ones.
      // We should only see the 5 simple ones.
      expect(mandatoryCount).toBe(5);
    });

    it("produces a model that passes validation", () => {
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });

    it("produces a model that can be verbalized", () => {
      const verbalizations = verbalizer.verbalizeModel(model);
      expect(verbalizations.length).toBeGreaterThan(0);
      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Person"))).toBe(true);
      expect(texts.some((t) => t.includes("Country"))).toBe(true);
    });

    it("produces a model that can be mapped to relational schema", () => {
      const schema = mapper.map(model);
      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("person");
      expect(tableNames).toContain("country");
      expect(tableNames).toContain("region");
    });

    it("produces valid DDL", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);
      expect(ddl).toContain("CREATE TABLE person");
      expect(ddl).toContain("CREATE TABLE country");
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });
  });

  describe("Employee Project model (external uniqueness + role-level value constraint)", () => {
    const xml = loadFixture("employeeProject.orm");
    const model = importNormaXml(xml);

    it("imports the model with correct name", () => {
      expect(model.name).toBe("Employee Project");
    });

    it("imports the entity type", () => {
      const employee = model.getObjectTypeByName("Employee");
      expect(employee).toBeDefined();
      expect(employee!.kind).toBe("entity");
    });

    it("imports all value types", () => {
      const firstName = model.getObjectTypeByName("FirstName");
      const lastName = model.getObjectTypeByName("LastName");
      const roleName = model.getObjectTypeByName("RoleName");
      expect(firstName).toBeDefined();
      expect(firstName!.kind).toBe("value");
      expect(lastName).toBeDefined();
      expect(lastName!.kind).toBe("value");
      expect(roleName).toBeDefined();
      expect(roleName!.kind).toBe("value");
    });

    it("imports all three fact types", () => {
      expect(model.factTypes).toHaveLength(3);
      expect(model.getFactTypeByName("Employee has FirstName")).toBeDefined();
      expect(model.getFactTypeByName("Employee has LastName")).toBeDefined();
      expect(model.getFactTypeByName("Employee has RoleName")).toBeDefined();
    });

    it("imports internal uniqueness constraints on each fact type", () => {
      for (
        const ftName of [
          "Employee has FirstName",
          "Employee has LastName",
          "Employee has RoleName",
        ]
      ) {
        const ft = model.getFactTypeByName(ftName)!;
        const ucs = ft.constraints.filter(
          (c) => c.type === "internal_uniqueness",
        );
        expect(ucs.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("imports mandatory constraints on each fact type", () => {
      for (
        const ftName of [
          "Employee has FirstName",
          "Employee has LastName",
          "Employee has RoleName",
        ]
      ) {
        const ft = model.getFactTypeByName(ftName)!;
        const mcs = ft.constraints.filter((c) => c.type === "mandatory");
        expect(mcs.length).toBeGreaterThanOrEqual(1);
      }
    });

    it("imports external uniqueness constraint spanning FirstName and LastName", () => {
      // The external uniqueness constraint should be attached to one of the
      // fact types that contain a referenced role.
      const allConstraints = model.factTypes.flatMap((ft) => ft.constraints);
      const extUcs = allConstraints.filter(
        (c) => c.type === "external_uniqueness",
      );
      expect(extUcs).toHaveLength(1);

      const extUc = extUcs[0]!;
      if (extUc.type === "external_uniqueness") {
        // Should reference roles from both the FirstName and LastName fact types.
        expect(extUc.roleIds).toHaveLength(2);
        expect(extUc.roleIds).toContain("_r_fn_of");
        expect(extUc.roleIds).toContain("_r_ln_of");
      }
    });

    it("imports role-level value constraint on RoleName role", () => {
      const ft = model.getFactTypeByName("Employee has RoleName")!;
      const vcs = ft.constraints.filter((c) => c.type === "value_constraint");
      expect(vcs).toHaveLength(1);

      const vc = vcs[0]!;
      if (vc.type === "value_constraint") {
        expect(vc.roleId).toBe("_r_role_of");
        expect(vc.values).toEqual(["dev", "qa", "pm"]);
      }
    });

    it("does not confuse role-level value constraint with type-level restriction", () => {
      // The RoleName value type should NOT have a valueConstraint --
      // the constraint is on the role, not the type.
      const roleName = model.getObjectTypeByName("RoleName")!;
      expect(roleName.valueConstraint).toBeUndefined();
    });

    it("produces a model that passes validation", () => {
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });

    it("produces a model that can be verbalized", () => {
      const verbalizations = verbalizer.verbalizeModel(model);
      expect(verbalizations.length).toBeGreaterThan(0);
      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Employee"))).toBe(true);
    });

    it("produces a model that can be mapped to relational schema", () => {
      const schema = mapper.map(model);
      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("employee");
    });

    it("produces valid DDL from the mapped schema", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);
      expect(ddl).toContain("CREATE TABLE employee");
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });
  });

  describe("error handling", () => {
    it("throws NormaImportError for invalid XML", () => {
      expect(() => importNormaXml("<not valid")).toThrow(NormaImportError);
    });

    it("throws NormaImportError for non-NORMA XML", () => {
      const xml = `<?xml version="1.0"?><root><data/></root>`;
      expect(() => importNormaXml(xml)).toThrow(NormaImportError);
    });

    it("wraps parse errors with context", () => {
      try {
        importNormaXml("<not valid");
        expect.fail("Should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(NormaImportError);
        expect((err as NormaImportError).message).toContain("Parse error");
      }
    });
  });
});
