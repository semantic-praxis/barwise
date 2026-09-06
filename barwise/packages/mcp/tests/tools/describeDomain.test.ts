/**
 * Tests for describe_domain MCP tool.
 *
 * Verifies that the tool returns structured domain descriptions.
 */

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeDescribeDomain } from "../../src/tools/describeDomain.js";
import { writeManifest } from "../workspace/manifestFixture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("describe_domain tool", () => {
  const simpleModel = `
orm_version: "1.0"
model:
  name: Test Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
      definition: A person who buys products
    - id: ot-order
      name: Order
      kind: entity
      reference_mode: order_num
  fact_types:
    - id: ft-customer-places-order
      name: Customer places Order
      roles:
        - id: r-cust-places
          player: ot-customer
          role_name: places
        - id: r-order-placed-by
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
      constraints:
        - type: internal_uniqueness
          roles: [r-order-placed-by]
        - type: mandatory
          role: r-order-placed-by
`;

  describe("full summary (no focus)", () => {
    it("returns structured domain description", () => {
      const result = executeDescribeDomain(simpleModel);

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.summary).toBeDefined();
      expect(parsed.summary).toContain("Test Model");

      expect(parsed.entities).toHaveLength(2);
      expect(parsed.factTypes).toHaveLength(1);
      expect(parsed.constraints.length).toBeGreaterThanOrEqual(2);
    });

    it("includes entity definitions", () => {
      const result = executeDescribeDomain(simpleModel);

      const parsed = JSON.parse(result.content[0]!.text);

      const customer = parsed.entities.find(
        (e: { name: string; }) => e.name === "Customer",
      );
      expect(customer).toBeDefined();
      expect(customer.definition).toBe("A person who buys products");
    });

    it("includes fact type readings", () => {
      const result = executeDescribeDomain(simpleModel);

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.factTypes[0]!.primaryReading).toContain("places");
    });

    it("includes constraint verbalizations", () => {
      const result = executeDescribeDomain(simpleModel);

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.constraints.length).toBeGreaterThanOrEqual(1);
      expect(parsed.constraints[0]!.verbalization).toBeDefined();
    });
  });

  describe("entity focus", () => {
    it("returns only the focused entity and related elements", () => {
      const result = executeDescribeDomain(simpleModel, "Customer");

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(1);
      expect(parsed.entities[0]!.name).toBe("Customer");

      // Should include fact types involving Customer.
      expect(parsed.factTypes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("constraint type focus", () => {
    it("returns all constraints of the specified type", () => {
      const result = executeDescribeDomain(simpleModel, "mandatory");

      const parsed = JSON.parse(result.content[0]!.text);

      // Should have at least one mandatory constraint.
      expect(parsed.constraints.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("includePopulations option", () => {
    const modelWithPopulation = `
orm_version: "1.0"
model:
  name: Test Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
    - id: ot-order
      name: Order
      kind: entity
      reference_mode: order_num
  fact_types:
    - id: ft-customer-places-order
      name: Customer places Order
      roles:
        - id: r-cust-places
          player: ot-customer
          role_name: places
        - id: r-order-placed-by
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
      constraints:
        - type: internal_uniqueness
          roles: [r-order-placed-by]
  populations:
    - id: pop-1
      fact_type: ft-customer-places-order
      description: Sample orders
      instances:
        - id: inst-1
          role_values:
            r-cust-places: C001
            r-order-placed-by: O123
        - id: inst-2
          role_values:
            r-cust-places: C001
            r-order-placed-by: O124
`;

    it("includes populations by default", () => {
      const result = executeDescribeDomain(modelWithPopulation);

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.populations).toBeDefined();
      expect(parsed.populations.length).toBeGreaterThanOrEqual(1);
    });

    it("excludes populations when includePopulations is false", () => {
      const result = executeDescribeDomain(
        modelWithPopulation,
        undefined,
        false,
      );

      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.populations).toBeUndefined();
    });
  });

  describe("minimal model", () => {
    it("handles minimal valid model", () => {
      // Minimal valid model with no fact types
      const minimalModel = `
orm_version: "1.0"
model:
  name: Minimal Model
  object_types:
    - id: ot-customer
      name: Customer
      kind: entity
      reference_mode: cust_id
`;

      const result = executeDescribeDomain(minimalModel);

      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.summary).toBeDefined();
      expect(parsed.entities).toHaveLength(1);
      expect(parsed.factTypes).toHaveLength(0);
    });
  });

  describe("truncation of large models", () => {
    function modelWithEntities(n: number): string {
      const types = Array.from(
        { length: n },
        (_, i) =>
          `    - id: ot-${i}\n      name: Entity${i}\n`
          + `      kind: entity\n      reference_mode: id${i}`,
      ).join("\n");
      return `orm_version: "1.0"\nmodel:\n  name: Big Model\n`
        + `  object_types:\n${types}\n`;
    }

    it("does not truncate a model within the cap", () => {
      const result = executeDescribeDomain(modelWithEntities(10));
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(10);
      expect(parsed.truncation).toBeUndefined();
    });

    it("caps the entity array and reports truncation", () => {
      const result = executeDescribeDomain(modelWithEntities(40));
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(25);
      expect(parsed.truncation.entities).toEqual({ shown: 25, total: 40 });
      expect(parsed.note).toContain("query_model");
    });

    // 30 binary fact types between the same two entities, each carrying
    // one internal-uniqueness constraint -- one model that exceeds both
    // the fact-type and the constraint cap in a single call.
    function modelWithFactTypes(n: number): string {
      const facts = Array.from({ length: n }, (_, i) => {
        const id = `ft-${i}`;
        return [
          `    - id: "${id}"`,
          `      name: "A relates${i} B"`,
          "      roles:",
          `        - id: "r-a-${i}"`,
          "          player: ot-a",
          `          role_name: "relates${i}"`,
          `        - id: "r-b-${i}"`,
          "          player: ot-b",
          `          role_name: "is related${i} to"`,
          "      readings:",
          `        - "{0} relates${i} {1}"`,
          "      constraints:",
          "        - type: internal_uniqueness",
          `          roles: ["r-a-${i}"]`,
        ].join("\n");
      }).join("\n");
      return `orm_version: "1.0"\nmodel:\n  name: Fact Model\n`
        + "  object_types:\n"
        + "    - id: ot-a\n      name: A\n      kind: entity\n      reference_mode: a_id\n"
        + "    - id: ot-b\n      name: B\n      kind: entity\n      reference_mode: b_id\n"
        + `  fact_types:\n${facts}\n`;
    }

    it("caps the fact-type and constraint arrays and reports truncation", () => {
      const result = executeDescribeDomain(modelWithFactTypes(30));
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.factTypes).toHaveLength(25);
      expect(parsed.truncation.factTypes).toEqual({ shown: 25, total: 30 });
      expect(parsed.constraints).toHaveLength(25);
      expect(parsed.truncation.constraints).toEqual({ shown: 25, total: 30 });
    });
  });

  describe("lineage-aware (filePath) mode", () => {
    let dir: string;

    beforeEach(() => {
      dir = mkdtempSync(join(tmpdir(), "mcp-describe-lineage-"));
    });

    afterEach(() => {
      rmSync(dir, { recursive: true, force: true });
    });

    function writeModelAndManifest(
      entitySources: Array<{ elementId: string; elementName: string; }>,
    ) {
      const modelPath = join(dir, "model.orm.yaml");
      writeFileSync(modelPath, simpleModel, "utf-8");
      const artifactPath = join(dir, "schema.sql");
      writeFileSync(artifactPath, "CREATE TABLE customer;", "utf-8");
      writeManifest(dir, {
        version: 1,
        sourceModel: "model.orm.yaml",
        sourceModelHash: "abc123",
        exports: [
          {
            artifact: artifactPath,
            format: "ddl",
            exportedAt: "2026-01-01T00:00:00.000Z",
            modelHash: "abc123",
            sources: entitySources.map((s) => ({
              elementId: s.elementId,
              elementType: "EntityType" as const,
              elementName: s.elementName,
            })),
          },
        ],
      });
      return artifactPath;
    }

    it("resolves the source model through the lineage manifest and focuses on the single entity source", () => {
      const artifactPath = writeModelAndManifest([{
        elementId: "ot-customer",
        elementName: "Customer",
      }]);

      const result = executeDescribeDomain("unused", undefined, undefined, artifactPath);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.lineage.artifact).toBe(artifactPath);
      expect(parsed.lineage.format).toBe("ddl");
      expect(parsed.lineage.sourceElements).toEqual([
        { elementId: "ot-customer", elementType: "EntityType", elementName: "Customer" },
      ]);
      // No explicit focus, exactly one entity source -> focused on it.
      expect(parsed.entities).toHaveLength(1);
      expect(parsed.entities[0]!.name).toBe("Customer");
    });

    it("prefers an explicit focus over the single-entity-source default", () => {
      const artifactPath = writeModelAndManifest([{
        elementId: "ot-customer",
        elementName: "Customer",
      }]);

      const result = executeDescribeDomain("unused", "Order", undefined, artifactPath);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.entities).toHaveLength(1);
      expect(parsed.entities[0]!.name).toBe("Order");
    });

    it("does not default the focus when there are zero or multiple entity sources", () => {
      const artifactPath = writeModelAndManifest([]);

      const result = executeDescribeDomain("unused", undefined, undefined, artifactPath);
      const parsed = JSON.parse(result.content[0]!.text);

      // No focus applied -- both entities appear.
      expect(parsed.entities).toHaveLength(2);
    });

    it("reports an error when no lineage manifest is found for the artifact", () => {
      const orphanPath = join(dir, "no-manifest.sql");
      writeFileSync(orphanPath, "CREATE TABLE x;", "utf-8");

      const result = executeDescribeDomain("unused", undefined, undefined, orphanPath);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.error).toContain("No lineage manifest found");
    });

    it("reports an error when the manifest is found but the source model is missing", () => {
      const artifactPath = join(dir, "schema.sql");
      writeFileSync(artifactPath, "CREATE TABLE x;", "utf-8");
      writeManifest(dir, {
        version: 1,
        sourceModel: "does-not-exist.orm.yaml",
        sourceModelHash: "abc123",
        exports: [
          {
            artifact: artifactPath,
            format: "ddl",
            exportedAt: "2026-01-01T00:00:00.000Z",
            modelHash: "abc123",
            sources: [],
          },
        ],
      });

      const result = executeDescribeDomain("unused", undefined, undefined, artifactPath);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.error).toContain("source model not located");
    });
  });

  describe("project source", () => {
    const project = `${fixtures}/project/project.orm-project.yaml`;

    it("describes every domain when no domain is given", () => {
      const result = executeDescribeDomain(project);
      const parsed = JSON.parse(result.content[0]!.text);
      const domains = parsed.domains as Array<{ domain: string; summary: string; }>;
      expect(domains).toHaveLength(2);
      expect(domains.map((d) => d.domain)).toEqual(["crm", "billing"]);
      expect(domains[0]!.summary).toContain("CRM Domain");
    });

    it("describes only the chosen domain", () => {
      const result = executeDescribeDomain(project, undefined, undefined, undefined, "billing");
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.domain).toBe("billing");
      expect(parsed.summary).toContain("Billing Domain");
      expect(parsed.domains).toBeUndefined();
    });

    it("reports an error for an unknown domain", () => {
      const result = executeDescribeDomain(project, undefined, undefined, undefined, "ghost");
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.error).toContain("crm, billing");
    });

    it("carries assembly warnings alongside the single resolved domain", () => {
      // The manifest also lists a "ghost" domain whose file does not exist;
      // that failure surfaces as a `problems` warning even though only the
      // one loadable domain ("crm") is returned.
      const broken = `${fixtures}/project/broken.orm-project.yaml`;
      const result = executeDescribeDomain(broken);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.domains).toBeUndefined();
      expect(parsed.summary).toContain("CRM Domain");
      expect(parsed.warnings).toBeDefined();
      expect(parsed.warnings[0]).toContain("ghost");
    });
  });
});
