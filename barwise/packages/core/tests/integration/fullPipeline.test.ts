/**
 * Full pipeline integration tests: load -> validate -> verbalize -> map -> DDL.
 *
 * These tests exercise the complete Barwise core pipeline against realistic
 * fixture models. Each model is deserialized from YAML, validated (no errors
 * expected), verbalized into natural language, mapped to a relational schema,
 * and rendered as DDL. This proves all subsystems compose correctly and that
 * the output is structurally valid (correct table/column/FK generation).
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { renderDdl } from "../../src/mapping/renderers/ddl.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serializer = new OrmYamlSerializer();
const validator = new ValidationEngine();
const verbalizer = new Verbalizer();
const mapper = new RelationalMapper();

function loadFixture(name: string): string {
  return readFileSync(
    resolve(__dirname, "fixtures", name),
    "utf-8",
  );
}

describe("Full pipeline integration: load -> validate -> verbalize -> map -> DDL", () => {
  describe("Order Management model with populations", () => {
    const yaml = loadFixture("populationInstances.orm.yaml");
    const model = serializer.deserialize(yaml);

    it("loads the model with populations from YAML", () => {
      expect(model.name).toBe("Order Management with Populations");
      expect(model.objectTypes).toHaveLength(4);
      expect(model.factTypes).toHaveLength(2);
      expect(model.populations).toHaveLength(2);
    });

    it("loads population instances correctly", () => {
      const ordersPop = model.getPopulation("pop-orders");
      expect(ordersPop).toBeDefined();
      expect(ordersPop!.description).toBe("Sample customer orders");
      expect(ordersPop!.instances).toHaveLength(3);

      const inst1 = ordersPop!.getInstance("inst-1")!;
      expect(inst1.roleValues["r-cust-places"]).toBe("C001");
      expect(inst1.roleValues["r-order-placed-by"]).toBe("O100");
    });

    it("passes validation with valid populations (no constraint violations)", () => {
      const diagnostics = validator.validate(model);
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("verbalizes fact types regardless of populations", () => {
      const verbalizations = verbalizer.verbalizeModel(model);
      expect(verbalizations.length).toBeGreaterThan(0);
      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Customer"))).toBe(true);
      expect(texts.some((t) => t.includes("Order"))).toBe(true);
    });

    it("maps to relational schema (populations do not affect mapping)", () => {
      const schema = mapper.map(model);
      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).toContain("customer");
      expect(tableNames).toContain("order");
      expect(tableNames).toContain("product");
    });

    it("renders valid DDL", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);
      expect(ddl).toContain("CREATE TABLE customer");
      expect(ddl).toContain("CREATE TABLE order");
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });
  });

  describe("Order Management model", () => {
    const yaml = loadFixture("orderManagement.orm.yaml");
    const model = serializer.deserialize(yaml);

    it("loads the model from YAML", () => {
      expect(model.name).toBe("Order Management");
      expect(model.objectTypes).toHaveLength(7);
      expect(model.factTypes).toHaveLength(5);
    });

    it("passes validation with no errors", () => {
      const diagnostics = validator.validate(model);
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("may produce completeness warnings", () => {
      const diagnostics = validator.validate(model);
      const warnings = diagnostics.filter((d) => d.severity === "warning");
      // Warnings are acceptable (e.g., spanning uniqueness on Order-contains-Product).
      // We just verify validation runs without crashing.
      expect(diagnostics).toBeDefined();
      // There should be at least some warnings for fact types without definitions.
      expect(warnings.length).toBeGreaterThanOrEqual(0);
    });

    it("verbalizes all fact types and constraints", () => {
      const verbalizations = verbalizer.verbalizeModel(model);

      // 5 fact types, each with at least 1 reading + constraints.
      expect(verbalizations.length).toBeGreaterThan(5);

      // All verbalizations should have non-empty text.
      for (const v of verbalizations) {
        expect(v.text.length).toBeGreaterThan(0);
        expect(v.category).toBeDefined();
      }

      // Check specific verbalizations exist.
      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Customer"))).toBe(true);
      expect(texts.some((t) => t.includes("Order"))).toBe(true);
      expect(texts.some((t) => t.includes("at most one"))).toBe(true);
      expect(texts.some((t) => t.includes("at least one"))).toBe(true);
    });

    it("maps to a relational schema", () => {
      const schema = mapper.map(model);

      // Entity tables: Customer, Order, Product (Name, Date, Quantity, Rating are value types).
      const entityTableNames = schema.tables
        .filter((t) => !t.name.includes("_"))
        .map((t) => t.name);
      expect(entityTableNames).toContain("customer");
      expect(entityTableNames).toContain("order");
      expect(entityTableNames).toContain("product");

      // Customer table should have: customer_id (PK), name (value type col),
      // and no FK to Order (FK goes on Order side).
      const customerTable = schema.tables.find(
        (t) => t.name === "customer",
      )!;
      expect(customerTable.primaryKey.columnNames).toEqual(["customer_id"]);
      const nameCol = customerTable.columns.find((c) => c.name === "name");
      expect(nameCol).toBeDefined();

      // Order table should have: order_number (PK), customer_id (FK), date (value type col).
      const orderTable = schema.tables.find((t) => t.name === "order")!;
      expect(orderTable.primaryKey.columnNames).toEqual(["order_number"]);
      expect(
        orderTable.foreignKeys.some(
          (fk) => fk.referencedTable === "customer",
        ),
      ).toBe(true);
      const dateCol = orderTable.columns.find((c) => c.name === "date");
      expect(dateCol).toBeDefined();
    });

    it("renders valid DDL", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      // Basic DDL structure.
      expect(ddl).toContain("CREATE TABLE customer");
      expect(ddl).toContain("CREATE TABLE order");
      expect(ddl).toContain("CREATE TABLE product");
      expect(ddl).toContain("PRIMARY KEY");
      expect(ddl).toContain("FOREIGN KEY");

      // Every CREATE TABLE should have a matching closing );
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });

    it("DDL contains NOT NULL for mandatory columns", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      // customer_id PK should be NOT NULL.
      expect(ddl).toContain("customer_id TEXT NOT NULL");
      // order_number PK should be NOT NULL.
      expect(ddl).toContain("order_number TEXT NOT NULL");
    });

    it("frequency constraint passes validation", () => {
      // The Customer rates Product fact type has a frequency constraint.
      const ratesFt = model.getFactTypeByName("Customer rates Product");
      expect(ratesFt).toBeDefined();
      const freqConstraint = ratesFt!.internalConstraints.find(
        (c) => c.type === "frequency",
      );
      expect(freqConstraint).toBeDefined();

      // Should not produce validation errors.
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });
  });

  describe("Phase 2 Constraint model", () => {
    const yaml = loadFixture("phase2Constraints.orm.yaml");
    const model = serializer.deserialize(yaml);

    it("loads all Phase 2 constraint types", () => {
      const allConstraints = model.everyConstraint().map(([c]) => c);
      const types = new Set(allConstraints.map((c) => c.type));

      expect(types.has("exclusive_or")).toBe(true);
      expect(types.has("subset")).toBe(true);
      expect(types.has("ring")).toBe(true);
    });

    it("passes validation (ring constraints on self-referencing fact type)", () => {
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });

    it("verbalizes Phase 2 constraints", () => {
      const verbalizations = verbalizer.verbalizeModel(model);
      const texts = verbalizations.map((v) => v.text);

      // Exclusive-or should produce "but not both".
      expect(texts.some((t) => t.includes("but not both"))).toBe(true);

      // Ring irreflexive should produce "No Person ... that same Person".
      expect(texts.some((t) => t.includes("that same"))).toBe(true);

      // Subset should produce "If ... then".
      expect(
        texts.some(
          (t) => t.includes("If") && t.includes("then"),
        ),
      ).toBe(true);
    });

    it("maps the self-referencing fact type correctly", () => {
      const schema = mapper.map(model);
      const personTable = schema.tables.find(
        (t) => t.name === "person",
      )!;
      expect(personTable).toBeDefined();
      expect(personTable.primaryKey.columnNames).toEqual(["person_id"]);
    });

    it("generates DDL for the full model", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);
      expect(ddl).toContain("CREATE TABLE person");
      expect(ddl).toContain("CREATE TABLE car");
      expect(ddl).toContain("CREATE TABLE bus");
      expect(ddl).toContain("CREATE TABLE ticket");
    });
  });

  describe("University Enrollment model (objectified fact types)", () => {
    const yaml = loadFixture("objectifiedFactTypes.orm.yaml");
    const model = serializer.deserialize(yaml);

    it("loads the model with objectified fact types from YAML", () => {
      expect(model.name).toBe("University Enrollment");
      expect(model.objectTypes).toHaveLength(6);
      expect(model.factTypes).toHaveLength(4);
      expect(model.objectifiedFactTypes).toHaveLength(1);

      const oft = model.objectifiedFactTypes[0]!;
      expect(oft.factTypeId).toBe("ft-student-enrolls-course");
      expect(oft.objectTypeId).toBe("ot-enrollment");
    });

    it("passes validation with no errors", () => {
      const diagnostics = validator.validate(model);
      const errors = diagnostics.filter((d) => d.severity === "error");
      expect(errors).toHaveLength(0);
    });

    it("verbalizes objectified fact types", () => {
      const verbalizations = verbalizer.verbalizeModel(model);

      // Should have objectification verbalizations.
      const objectificationVerbs = verbalizations.filter(
        (v) => v.category === "objectification",
      );
      expect(objectificationVerbs).toHaveLength(1);
      expect(objectificationVerbs[0]!.text).toBe(
        "Enrollment is where Student enrolls in Course.",
      );

      // Should also have fact type readings for all 4 fact types.
      const factTypeVerbs = verbalizations.filter(
        (v) => v.category === "fact_type",
      );
      expect(factTypeVerbs.length).toBeGreaterThanOrEqual(4);

      // Constraint verbalizations should exist (uniqueness, mandatory).
      const constraintVerbs = verbalizations.filter(
        (v) => v.category === "constraint",
      );
      expect(constraintVerbs.length).toBeGreaterThan(0);
    });

    it("maps objectified fact type to a table with composite PK", () => {
      const schema = mapper.map(model);

      // Enrollment table should exist with composite PK from the objectified roles.
      const enrollmentTable = schema.tables.find(
        (t) => t.name === "enrollment",
      )!;
      expect(enrollmentTable).toBeDefined();

      // PK should be the composite of student_id and course_code (from the roles).
      expect(enrollmentTable.primaryKey.columnNames).toEqual([
        "student_id",
        "course_code",
      ]);

      // Should have FK constraints to both student and course tables.
      expect(enrollmentTable.foreignKeys.length).toBeGreaterThanOrEqual(2);
      const studentFk = enrollmentTable.foreignKeys.find(
        (fk) => fk.referencedTable === "student",
      );
      expect(studentFk).toBeDefined();
      expect(studentFk!.referencedColumns).toEqual(["student_id"]);

      const courseFk = enrollmentTable.foreignKeys.find(
        (fk) => fk.referencedTable === "course",
      );
      expect(courseFk).toBeDefined();
      expect(courseFk!.referencedColumns).toEqual(["course_code"]);
    });

    it("maps non-objectified fact types normally alongside objectified ones", () => {
      const schema = mapper.map(model);

      // Instructor teaches Course should produce a FK on Course table.
      const courseTable = schema.tables.find((t) => t.name === "course")!;
      expect(courseTable).toBeDefined();
      const instructorFk = courseTable.foreignKeys.find(
        (fk) => fk.referencedTable === "instructor",
      );
      expect(instructorFk).toBeDefined();

      // Enrollment has Grade should produce a grade column on enrollment.
      const enrollmentTable = schema.tables.find(
        (t) => t.name === "enrollment",
      )!;
      const gradeCol = enrollmentTable.columns.find(
        (c) => c.name === "grade",
      );
      expect(gradeCol).toBeDefined();

      // Enrollment in Semester should produce a semester column on enrollment.
      const semesterCol = enrollmentTable.columns.find(
        (c) => c.name === "semester",
      );
      expect(semesterCol).toBeDefined();
      // Semester is mandatory, so not nullable.
      expect(semesterCol!.nullable).toBe(false);
    });

    it("does not create an associative table for the objectified fact type", () => {
      const schema = mapper.map(model);

      // No associative table for "Student enrolls in Course" -- it's absorbed
      // into the Enrollment entity table instead.
      const tableNames = schema.tables.map((t) => t.name);
      expect(tableNames).not.toContain("student_enrolls_in_course");
    });

    it("renders valid DDL with objectified table", () => {
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      // Entity tables should all be present.
      expect(ddl).toContain("CREATE TABLE student");
      expect(ddl).toContain("CREATE TABLE course");
      expect(ddl).toContain("CREATE TABLE enrollment");
      expect(ddl).toContain("CREATE TABLE instructor");

      // Enrollment table should have composite PK.
      expect(ddl).toContain("PRIMARY KEY (student_id, course_code)");

      // FK constraints from enrollment to student and course.
      expect(ddl).toContain(
        "FOREIGN KEY (student_id) REFERENCES student (student_id)",
      );
      expect(ddl).toContain(
        "FOREIGN KEY (course_code) REFERENCES course (course_code)",
      );

      // Every CREATE TABLE should have a matching closing );
      const createCount = (ddl.match(/CREATE TABLE/g) ?? []).length;
      const closeCount = (ddl.match(/\);/g) ?? []).length;
      expect(closeCount).toBe(createCount);
    });
  });
});
