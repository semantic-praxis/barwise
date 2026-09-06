/**
 * Tests for OrmProject, the multi-file project container.
 *
 * An OrmProject aggregates multiple domain models (each with its own
 * bounded context), context mappings between domains, and data-product
 * models that depend on domains and mappings. These tests verify:
 *   - Domain, mapping, and product registration
 *   - Context lookups and qualified-reference resolution (e.g. "crm:Customer")
 *   - Duplicate-context prevention
 *   - Model attachment and retrieval for domains
 */
import { describe, expect, it } from "vitest";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmProject } from "../../src/model/OrmProject.js";

describe("OrmProject", () => {
  it("creates a project with a name", () => {
    const project = new OrmProject({ name: "My Project" });
    expect(project.name).toBe("My Project");
    expect(project.domains).toHaveLength(0);
    expect(project.mappings).toHaveLength(0);
    expect(project.products).toHaveLength(0);
  });

  it("rejects empty project name", () => {
    expect(() => new OrmProject({ name: "" })).toThrow();
  });

  it("rejects an empty name assigned after construction", () => {
    const project = new OrmProject({ name: "Test" });
    expect(() => {
      project.name = "   ";
    }).toThrow("Project name must be a non-empty string.");
  });

  it("allows renaming to a valid non-empty name", () => {
    const project = new OrmProject({ name: "Test" });
    project.name = "  Renamed  ";
    expect(project.name).toBe("Renamed");
  });

  describe("domains", () => {
    it("adds a domain", () => {
      const project = new OrmProject({ name: "Test" });
      const domain = project.addDomain({
        path: "./domains/crm.orm.yaml",
        context: "crm",
      });
      expect(domain.path).toBe("./domains/crm.orm.yaml");
      expect(domain.context).toBe("crm");
      expect(project.domains).toHaveLength(1);
    });

    it("rejects duplicate domain contexts", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });
      expect(() => project.addDomain({ path: "./crm2.orm.yaml", context: "crm" })).toThrow(
        /already exists/,
      );
    });

    it("rejects domain context colliding with an existing product context", () => {
      const project = new OrmProject({ name: "Test" });
      project.addProduct({
        path: "./clv.orm.yaml",
        context: "clv",
        dependsOnDomains: [],
        dependsOnMappings: [],
      });
      expect(() => project.addDomain({ path: "./clv-domain.orm.yaml", context: "clv" })).toThrow(
        "already used by a data product",
      );
    });

    it("looks up domain by context", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });
      expect(project.getDomain("crm")).toBeDefined();
      expect(project.getDomain("billing")).toBeUndefined();
    });

    it("rejects an empty domain path", () => {
      const project = new OrmProject({ name: "Test" });
      expect(() => project.addDomain({ path: "", context: "crm" })).toThrow(
        "Domain model path must be a non-empty string.",
      );
    });

    it("rejects a whitespace-only domain context", () => {
      const project = new OrmProject({ name: "Test" });
      expect(() => project.addDomain({ path: "./crm.orm.yaml", context: "   " })).toThrow(
        "Domain model context must be a non-empty string.",
      );
    });
  });

  describe("mappings", () => {
    it("adds a context mapping", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });
      project.addDomain({
        path: "./billing.orm.yaml",
        context: "billing",
      });

      const mapping = project.addMapping({
        path: "./crm-billing.map.yaml",
        sourceContext: "crm",
        targetContext: "billing",
        pattern: "shared_kernel",
      });

      expect(mapping.sourceContext).toBe("crm");
      expect(project.mappings).toHaveLength(1);
    });

    it("finds mappings for a context", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./a.orm.yaml", context: "a" });
      project.addDomain({ path: "./b.orm.yaml", context: "b" });
      project.addDomain({ path: "./c.orm.yaml", context: "c" });
      project.addMapping({
        path: "./a-b.map.yaml",
        sourceContext: "a",
        targetContext: "b",
        pattern: "shared_kernel",
      });
      project.addMapping({
        path: "./b-c.map.yaml",
        sourceContext: "b",
        targetContext: "c",
        pattern: "anticorruption_layer",
      });

      expect(project.mappingsForContext("b")).toHaveLength(2);
      expect(project.mappingsForContext("a")).toHaveLength(1);
      expect(project.mappingsForContext("d")).toHaveLength(0);
    });
  });

  describe("products", () => {
    it("adds a data product", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });
      const product = project.addProduct({
        path: "./clv.orm.yaml",
        context: "clv",
        dependsOnDomains: ["crm"],
        dependsOnMappings: [],
      });

      expect(product.context).toBe("clv");
      expect(product.dependsOnDomains).toEqual(["crm"]);
      expect(project.products).toHaveLength(1);
    });

    it("rejects duplicate product contexts", () => {
      const project = new OrmProject({ name: "Test" });
      project.addProduct({
        path: "./a.orm.yaml",
        context: "clv",
        dependsOnDomains: [],
        dependsOnMappings: [],
      });
      expect(() =>
        project.addProduct({
          path: "./b.orm.yaml",
          context: "clv",
          dependsOnDomains: [],
          dependsOnMappings: [],
        })
      ).toThrow(/already exists/);
    });

    it("rejects an empty product path", () => {
      const project = new OrmProject({ name: "Test" });
      expect(() =>
        project.addProduct({
          path: "",
          context: "clv",
          dependsOnDomains: [],
          dependsOnMappings: [],
        })
      ).toThrow("Product path must be a non-empty string.");
    });

    it("rejects a whitespace-only product context", () => {
      const project = new OrmProject({ name: "Test" });
      expect(() =>
        project.addProduct({
          path: "./clv.orm.yaml",
          context: "   ",
          dependsOnDomains: [],
          dependsOnMappings: [],
        })
      ).toThrow("Product context must be a non-empty string.");
    });

    it("rejects product context colliding with domain context", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });
      expect(() =>
        project.addProduct({
          path: "./crm-product.orm.yaml",
          context: "crm",
          dependsOnDomains: [],
          dependsOnMappings: [],
        })
      ).toThrow(/already used/);
    });
  });

  describe("cross-domain reference resolution", () => {
    it("parses namespace-qualified references", () => {
      const parsed = OrmProject.parseQualifiedRef("crm:Customer");
      expect(parsed).toEqual({ context: "crm", name: "Customer" });
    });

    it("returns undefined for unqualified references", () => {
      expect(OrmProject.parseQualifiedRef("Customer")).toBeUndefined();
      expect(OrmProject.parseQualifiedRef(":Customer")).toBeUndefined();
      expect(OrmProject.parseQualifiedRef("crm:")).toBeUndefined();
    });

    it("resolves a qualified reference to an object type", () => {
      const project = new OrmProject({ name: "Test" });
      const domain = project.addDomain({
        path: "./crm.orm.yaml",
        context: "crm",
      });

      const model = new OrmModel({ name: "CRM" });
      model.addObjectType({
        name: "Customer",
        kind: "entity",
        referenceMode: "customer_id",
      });
      domain.setModel(model);

      const ot = project.resolveQualifiedRef("crm:Customer");
      expect(ot).toBeDefined();
      expect(ot!.name).toBe("Customer");
    });

    it("returns undefined for unresolvable references", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });

      // Domain model not loaded.
      expect(
        project.resolveQualifiedRef("crm:Customer"),
      ).toBeUndefined();

      // Nonexistent context.
      expect(
        project.resolveQualifiedRef("billing:Invoice"),
      ).toBeUndefined();

      // Malformed reference (no "context:Name" separator).
      expect(project.resolveQualifiedRef("Customer")).toBeUndefined();
    });

    it("lists all context names", () => {
      const project = new OrmProject({ name: "Test" });
      project.addDomain({ path: "./crm.orm.yaml", context: "crm" });
      project.addProduct({
        path: "./clv.orm.yaml",
        context: "clv",
        dependsOnDomains: [],
        dependsOnMappings: [],
      });

      expect(project.allContexts).toEqual(
        expect.arrayContaining(["crm", "clv"]),
      );
      expect(project.allContexts).toHaveLength(2);
    });
  });

  describe("constructor with config", () => {
    it("builds a full project from config", () => {
      const project = new OrmProject({
        name: "Warehouse",
        domains: [
          { path: "./crm.orm.yaml", context: "crm" },
          { path: "./billing.orm.yaml", context: "billing" },
        ],
        products: [
          {
            path: "./clv.orm.yaml",
            context: "clv",
            dependsOnDomains: ["crm", "billing"],
            dependsOnMappings: ["crm-billing"],
          },
        ],
      });

      expect(project.domains).toHaveLength(2);
      expect(project.products).toHaveLength(1);
      expect(project.getProduct("clv")!.dependsOnDomains).toEqual([
        "crm",
        "billing",
      ]);
    });
  });

  describe("settings", () => {
    it("defaults to empty settings", () => {
      const project = new OrmProject({ name: "Test" });
      expect(project.settings).toEqual({});
    });

    it("initializes settings from config", () => {
      const project = new OrmProject({
        name: "Test",
        settings: {
          dbtProjectDir: "dbt",
          defaultExportFormat: "dbt",
        },
      });
      expect(project.settings.dbtProjectDir).toBe("dbt");
      expect(project.settings.defaultExportFormat).toBe("dbt");
      expect(project.settings.defaultExportDir).toBeUndefined();
    });

    it("replaces settings via setter", () => {
      const project = new OrmProject({
        name: "Test",
        settings: { dbtProjectDir: "dbt" },
      });

      project.settings = { defaultExportFormat: "ddl" };

      expect(project.settings.dbtProjectDir).toBeUndefined();
      expect(project.settings.defaultExportFormat).toBe("ddl");
    });

    it("merges partial settings with updateSettings", () => {
      const project = new OrmProject({
        name: "Test",
        settings: {
          dbtProjectDir: "dbt",
          defaultExportFormat: "dbt",
        },
      });

      project.updateSettings({ defaultExportDir: "dbt/models/staging" });

      expect(project.settings.dbtProjectDir).toBe("dbt");
      expect(project.settings.defaultExportFormat).toBe("dbt");
      expect(project.settings.defaultExportDir).toBe("dbt/models/staging");
    });

    it("returns a defensive copy from getter", () => {
      const project = new OrmProject({
        name: "Test",
        settings: { dbtProjectDir: "dbt" },
      });

      const s = project.settings;
      (s as Record<string, unknown>).dbtProjectDir = "MUTATED";

      expect(project.settings.dbtProjectDir).toBe("dbt");
    });
  });
});
