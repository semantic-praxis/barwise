/**
 * Multi-file project integration tests.
 *
 * These tests exercise the multi-domain project workflow: loading a
 * project manifest, multiple domain models, and a context mapping from
 * fixture files, then validating, verbalizing, and mapping each domain
 * independently. This proves the project-level plumbing works end-to-end:
 *   - Project manifest round-trip
 *   - Domain model loading and attachment
 *   - Context mapping loading and round-trip
 *   - Cross-domain qualified-reference resolution (e.g. "crm:Customer")
 *   - Per-domain validation, verbalization, and DDL generation
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import { OrmProject } from "../../src/model/OrmProject.js";
import { MappingSerializer } from "../../src/serialization/MappingSerializer.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ProjectSerializer } from "../../src/serialization/ProjectSerializer.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";
import { Verbalizer } from "../../src/verbalization/Verbalizer.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const modelSerializer = new OrmYamlSerializer();
const projectSerializer = new ProjectSerializer();
const mappingSerializer = new MappingSerializer();
const validator = new ValidationEngine();
const verbalizer = new Verbalizer();
const mapper = new RelationalMapper();

function loadFixture(...parts: string[]): string {
  return readFileSync(resolve(__dirname, "fixtures", ...parts), "utf-8");
}

describe("Multi-file project integration", () => {
  // Load all files that constitute the multi-domain project.
  const projectYaml = loadFixture(
    "multi-domain",
    "project.orm-project.yaml",
  );
  const crmYaml = loadFixture(
    "multi-domain",
    "domains",
    "crm.orm.yaml",
  );
  const billingYaml = loadFixture(
    "multi-domain",
    "domains",
    "billing.orm.yaml",
  );
  const mappingYaml = loadFixture(
    "multi-domain",
    "mappings",
    "crm-billing.map.yaml",
  );

  describe("project manifest loading", () => {
    it("deserializes the project manifest", () => {
      const project = projectSerializer.deserialize(projectYaml);
      expect(project.name).toBe("Data Warehouse Semantic Model");
      expect(project.domains).toHaveLength(2);
      expect(project.products).toHaveLength(1);
    });

    it("extracts mapping paths from manifest", () => {
      const paths = projectSerializer.getMappingPaths(projectYaml);
      expect(paths).toHaveLength(1);
      expect(paths[0]).toBe("./mappings/crm-billing.map.yaml");
    });

    it("round-trips the project manifest", () => {
      const project = projectSerializer.deserialize(projectYaml);
      const reserialized = projectSerializer.serialize(project);
      const roundTripped = projectSerializer.deserialize(reserialized);

      expect(roundTripped.name).toBe(project.name);
      expect(roundTripped.domains).toHaveLength(project.domains.length);
      expect(roundTripped.products).toHaveLength(project.products.length);
    });
  });

  describe("domain model loading", () => {
    it("loads the CRM domain model", () => {
      const model = modelSerializer.deserialize(crmYaml);
      expect(model.name).toBe("CRM Domain");
      expect(model.domainContext).toBe("crm");
      expect(model.objectTypes).toHaveLength(3);
      expect(model.factTypes).toHaveLength(2);
    });

    it("loads the Billing domain model", () => {
      const model = modelSerializer.deserialize(billingYaml);
      expect(model.name).toBe("Billing Domain");
      expect(model.domainContext).toBe("billing");
      expect(model.objectTypes).toHaveLength(3);
      expect(model.factTypes).toHaveLength(2);
    });
  });

  describe("context mapping loading", () => {
    it("loads the CRM-Billing mapping", () => {
      const mapping = mappingSerializer.deserialize(
        mappingYaml,
        "./mappings/crm-billing.map.yaml",
      );
      expect(mapping.sourceContext).toBe("crm");
      expect(mapping.targetContext).toBe("billing");
      expect(mapping.pattern).toBe("anticorruption_layer");
      expect(mapping.entityMappings).toHaveLength(1);
      expect(mapping.semanticConflicts).toHaveLength(1);
    });

    it("entity mapping references valid object types", () => {
      const mapping = mappingSerializer.deserialize(
        mappingYaml,
        "./mappings/crm-billing.map.yaml",
      );
      const em = mapping.entityMappings[0]!;
      expect(em.sourceObjectType).toBe("Customer");
      expect(em.targetObjectType).toBe("Account");
    });

    it("round-trips the context mapping", () => {
      const mapping = mappingSerializer.deserialize(
        mappingYaml,
        "./mappings/crm-billing.map.yaml",
      );
      const reserialized = mappingSerializer.serialize(mapping);
      const roundTripped = mappingSerializer.deserialize(
        reserialized,
        "./mappings/crm-billing.map.yaml",
      );

      expect(roundTripped.sourceContext).toBe(mapping.sourceContext);
      expect(roundTripped.targetContext).toBe(mapping.targetContext);
      expect(roundTripped.pattern).toBe(mapping.pattern);
      expect(roundTripped.entityMappings).toHaveLength(
        mapping.entityMappings.length,
      );
      expect(roundTripped.semanticConflicts).toHaveLength(
        mapping.semanticConflicts.length,
      );
    });
  });

  describe("cross-domain reference resolution", () => {
    it("resolves namespace-qualified references", () => {
      const crmModel = modelSerializer.deserialize(crmYaml);
      const billingModel = modelSerializer.deserialize(billingYaml);

      const project = new OrmProject({ name: "Test" });
      const crm = project.addDomain({
        path: "./domains/crm.orm.yaml",
        context: "crm",
      });
      crm.setModel(crmModel);

      const billing = project.addDomain({
        path: "./domains/billing.orm.yaml",
        context: "billing",
      });
      billing.setModel(billingModel);

      // Resolve "crm:Customer".
      const customer = project.resolveQualifiedRef("crm:Customer");
      expect(customer).toBeDefined();
      expect(customer!.name).toBe("Customer");
      expect(customer!.kind).toBe("entity");

      // Resolve "billing:Account".
      const account = project.resolveQualifiedRef("billing:Account");
      expect(account).toBeDefined();
      expect(account!.name).toBe("Account");

      // Non-existent reference returns undefined.
      const missing = project.resolveQualifiedRef("billing:Customer");
      expect(missing).toBeUndefined();
    });
  });

  describe("per-domain validation", () => {
    it("CRM domain passes validation", () => {
      const model = modelSerializer.deserialize(crmYaml);
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });

    it("Billing domain passes validation", () => {
      const model = modelSerializer.deserialize(billingYaml);
      const errors = validator.errors(model);
      expect(errors).toHaveLength(0);
    });
  });

  describe("per-domain verbalization", () => {
    it("CRM domain produces verbalizations", () => {
      const model = modelSerializer.deserialize(crmYaml);
      const verbalizations = verbalizer.verbalizeModel(model);

      expect(verbalizations.length).toBeGreaterThan(0);

      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Customer"))).toBe(true);
      expect(texts.some((t) => t.includes("Email"))).toBe(true);
    });

    it("Billing domain produces verbalizations", () => {
      const model = modelSerializer.deserialize(billingYaml);
      const verbalizations = verbalizer.verbalizeModel(model);

      expect(verbalizations.length).toBeGreaterThan(0);

      const texts = verbalizations.map((v) => v.text);
      expect(texts.some((t) => t.includes("Account"))).toBe(true);
      expect(texts.some((t) => t.includes("Invoice"))).toBe(true);
    });
  });

  describe("per-domain relational mapping and DDL", () => {
    it("CRM domain maps to expected tables", () => {
      const model = modelSerializer.deserialize(crmYaml);
      const schema = mapper.map(model);

      // Customer entity -> customer table.
      const customerTable = schema.tables.find(
        (t) => t.name === "customer",
      );
      expect(customerTable).toBeDefined();
      expect(customerTable!.primaryKey.columnNames).toEqual([
        "customer_id",
      ]);

      // Value types (Email, Status) should become columns on customer table.
      const emailCol = customerTable!.columns.find(
        (c) => c.name === "email",
      );
      expect(emailCol).toBeDefined();
      // Mandatory -> NOT NULL.
      expect(emailCol!.nullable).toBe(false);

      const statusCol = customerTable!.columns.find(
        (c) => c.name === "status",
      );
      expect(statusCol).toBeDefined();
      expect(statusCol!.nullable).toBe(false);
    });

    it("Billing domain maps to expected tables", () => {
      const model = modelSerializer.deserialize(billingYaml);
      const schema = mapper.map(model);

      const accountTable = schema.tables.find(
        (t) => t.name === "account",
      );
      expect(accountTable).toBeDefined();

      const invoiceTable = schema.tables.find(
        (t) => t.name === "invoice",
      );
      expect(invoiceTable).toBeDefined();

      // Invoice should have FK to Account (mandatory).
      expect(
        invoiceTable!.foreignKeys.some(
          (fk) => fk.referencedTable === "account",
        ),
      ).toBe(true);

      // Amount is a value type -> column on invoice.
      const amountCol = invoiceTable!.columns.find(
        (c) => c.name === "amount",
      );
      expect(amountCol).toBeDefined();
      expect(amountCol!.nullable).toBe(false);
    });
  });

  describe("full project assembly", () => {
    it("assembles a complete project with domains and mapping", () => {
      const project = projectSerializer.deserialize(projectYaml);
      const crmModel = modelSerializer.deserialize(crmYaml);
      const billingModel = modelSerializer.deserialize(billingYaml);
      const mapping = mappingSerializer.deserialize(
        mappingYaml,
        "./mappings/crm-billing.map.yaml",
      );

      // Attach models to domains.
      const crmDomain = project.getDomain("crm")!;
      crmDomain.setModel(crmModel);

      const billingDomain = project.getDomain("billing")!;
      billingDomain.setModel(billingModel);

      // Verify project structure.
      expect(project.allContexts).toContain("crm");
      expect(project.allContexts).toContain("billing");
      expect(project.allContexts).toContain("clv");

      // Verify mapping references valid contexts.
      expect(mapping.involvesContext("crm")).toBe(true);
      expect(mapping.involvesContext("billing")).toBe(true);
      expect(mapping.involvesContext("unknown")).toBe(false);

      // Verify semantic conflict documentation.
      const conflict = mapping.semanticConflicts[0]!;
      expect(conflict.term).toBe("Customer");
      expect(conflict.resolution).toContain("billing definition");

      // Validate both domains independently.
      expect(validator.isValid(crmModel)).toBe(true);
      expect(validator.isValid(billingModel)).toBe(true);
    });
  });
});
