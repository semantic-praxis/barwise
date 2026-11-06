/**
 * The DDL half of core's integration tests (tests/integration/
 * fullPipeline.test.ts and multiFileProject.test.ts): load a fixture, map
 * it, render it. The renderer moved to @barwise/formats
 * (format-renderers-to-connectors.spec.md, WS1), so these cases moved with
 * it; they read core's fixtures in place rather than copying them.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { RelationalMapper } from "@barwise/core/mapping";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderDdl } from "../src/ddl/renderDdl.js";

const here = dirname(fileURLToPath(import.meta.url));
const serializer = new OrmYamlSerializer();
const modelSerializer = serializer;
const mapper = new RelationalMapper();

function loadFixture(...parts: string[]): string {
  return readFileSync(resolve(here, "../../core/tests/integration/fixtures", ...parts), "utf-8");
}

describe("Full pipeline: YAML -> model -> relational schema -> DDL", () => {
  describe("Order Management model with populations", () => {
    const yaml = loadFixture("populationInstances.orm.yaml");
    const model = serializer.deserialize(yaml);

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
  });

  describe("Phase 2 Constraint model", () => {
    const yaml = loadFixture("phase2Constraints.orm.yaml");
    const model = serializer.deserialize(yaml);

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

describe("Multi-file project: each domain renders DDL", () => {
  const crmYaml = loadFixture("multi-domain", "domains", "crm.orm.yaml");
  const billingYaml = loadFixture("multi-domain", "domains", "billing.orm.yaml");

  describe("relational mapping per domain", () => {
    it("CRM domain renders valid DDL", () => {
      const model = modelSerializer.deserialize(crmYaml);
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      expect(ddl).toContain("CREATE TABLE customer");
      expect(ddl).toContain("customer_id TEXT NOT NULL");
      expect(ddl).toContain("PRIMARY KEY (customer_id)");
      expect(ddl).toContain("email TEXT NOT NULL");
      expect(ddl).toContain("status TEXT NOT NULL");

      // Only one table (customer) since Email and Status are value types.
      expect((ddl.match(/CREATE TABLE/g) ?? []).length).toBe(1);
    });

    it("Billing domain renders valid DDL", () => {
      const model = modelSerializer.deserialize(billingYaml);
      const schema = mapper.map(model);
      const ddl = renderDdl(schema);

      expect(ddl).toContain("CREATE TABLE account");
      expect(ddl).toContain("CREATE TABLE invoice");
      expect(ddl).toContain("FOREIGN KEY");
      expect(ddl).toContain("REFERENCES account");

      // Two tables: account and invoice.
      expect((ddl.match(/CREATE TABLE/g) ?? []).length).toBe(2);
    });
  });
});
