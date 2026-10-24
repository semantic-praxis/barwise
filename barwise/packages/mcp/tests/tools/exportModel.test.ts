/**
 * Tests for export_model MCP tool.
 *
 * Verifies that the tool dispatches to the correct format adapter,
 * handles errors appropriately, and bounds large output by spilling it
 * to a file.
 */

import { OrmYamlSerializer } from "@barwise/core";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeExportModel } from "../../src/tools/exportModel.js";
import { usePrivateCwd } from "../workspace/privateCwd.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

// Exports spill beside their source: an inline one under the cwd, a file one
// next to the file. Both are private to each test.
const ws = usePrivateCwd();

const _serializer = new OrmYamlSerializer();

/** Resolve a tool result to its full text, reading the spill file if spilled. */
function readResult(result: { content: Array<{ text: string; }>; }): string {
  const text = result.content[0]!.text;
  const m = text.match(/Full content written to: (.+)/);
  return m ? readFileSync(m[1]!.trim(), "utf8") : text;
}

function isSpilled(result: { content: Array<{ text: string; }>; }): boolean {
  return result.content[0]!.text.includes("Full content written to:");
}

describe("export_model tool", () => {
  const simpleModel = `
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
`;

  describe("DDL format", () => {
    it("produces DDL output inline", () => {
      const result = executeExportModel(simpleModel, "ddl");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");
      // DDL for a small model is below the inline limit.
      expect(isSpilled(result)).toBe(false);
      expect(result.content[0]!.text).toContain("CREATE TABLE");
    });

    it("supports annotate option", () => {
      const result = executeExportModel(simpleModel, "ddl", {
        annotate: true,
      });

      expect(readResult(result)).toContain("--");
    });
  });

  describe("OpenAPI format", () => {
    it("produces OpenAPI JSON", () => {
      const result = executeExportModel(simpleModel, "openapi");

      expect(result.content).toHaveLength(1);
      expect(result.content[0]!.type).toBe("text");

      const spec = JSON.parse(readResult(result));
      expect(spec.openapi).toBe("3.0.0");
      expect(spec.components.schemas).toBeDefined();
    });

    it("supports format-specific options", () => {
      const result = executeExportModel(simpleModel, "openapi", {
        title: "My API",
        version: "2.0.0",
      });

      const spec = JSON.parse(readResult(result));
      expect(spec.info.title).toBe("My API");
      expect(spec.info.version).toBe("2.0.0");
    });

    it("spills a large OpenAPI spec to a file", () => {
      const result = executeExportModel(simpleModel, "openapi");

      // The OpenAPI spec exceeds the inline byte limit.
      expect(isSpilled(result)).toBe(true);
      expect(result.content[0]!.text).toContain(".barwise");
      expect(result.content[0]!.text).toContain("too large to return inline");
    });

    it("honors an explicit outputPath", () => {
      const dir = mkdtempSync(join(tmpdir(), "barwise-export-"));
      const dest = join(dir, "api.json");
      try {
        const result = executeExportModel(
          simpleModel,
          "openapi",
          undefined,
          dest,
        );
        expect(result.content[0]!.text).toContain(dest);
        const spec = JSON.parse(readFileSync(dest, "utf8"));
        expect(spec.openapi).toBe("3.0.0");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe("unknown format", () => {
    it("returns error for unknown format", () => {
      const result = executeExportModel(simpleModel, "unknown_format");

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("Unknown export format");
      expect(parsed.error).toContain("unknown_format");
    });
  });

  describe("strict mode", () => {
    it("returns error when model has validation errors in strict mode", () => {
      // Create a model with ORM validation errors (constraint references non-existent role).
      const invalidModel = `
orm_version: "1.0"
model:
  name: Invalid Model
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
    - id: ft-invalid
      name: Customer places Order
      roles:
        - id: r-1
          player: ot-customer
          role_name: places
        - id: r-2
          player: ot-order
          role_name: is placed by
      readings:
        - "{0} places {1}"
      constraints:
        - type: internal_uniqueness
          roles: [r-nonexistent]
`;

      const result = executeExportModel(invalidModel, "ddl", {
        strict: true,
      });

      expect(result.content).toHaveLength(1);
      const parsed = JSON.parse(result.content[0]!.text);

      expect(parsed.error).toBeDefined();
      expect(parsed.error).toContain("validation errors");
    });
  });

  describe("inline vs file source", () => {
    it("accepts inline YAML", () => {
      const result = executeExportModel(simpleModel, "ddl");

      expect(result.content).toHaveLength(1);
      expect(readResult(result)).toContain("CREATE TABLE");
    });

    // File path testing requires actual file system interaction,
    // which is covered by integration tests.
  });

  describe("project source", () => {
    const project = () => join(ws.fixture("project"), "project.orm-project.yaml");

    it("exports the chosen domain", () => {
      const result = executeExportModel(project(), "ddl", undefined, undefined, "crm");
      expect(readResult(result)).toContain("CREATE TABLE");
    });

    it("requires a domain to disambiguate a multi-domain project", () => {
      const result = executeExportModel(project(), "ddl");
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.error).toContain("domain");
      expect(parsed.error).toContain("crm, billing");
    });

    it("reports an error for an unknown domain", () => {
      const result = executeExportModel(project(), "ddl", undefined, undefined, "ghost");
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.error).toContain("crm, billing");
    });
  });
});

describe("the project's identifier strategy (identifier-strategy-in-exports.spec.md)", () => {
  let dir: string;
  let manifest: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mcp-strategy-"));
    // crm.orm.yaml declares no type for Customer's key.
    copyFileSync(join(fixtures, "project", "domains", "crm.orm.yaml"), join(dir, "crm.orm.yaml"));
    manifest = join(dir, "shop.orm-project.yaml");
    writeFileSync(
      manifest,
      [
        "project:",
        '  name: "Shop"',
        "  settings:",
        "    preferred_identifier_strategy: uuid",
        "  domains:",
        '    - path: "./crm.orm.yaml"',
        '      context: "crm"',
        "",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("types undeclared keys by it when the source is a project (R2)", () => {
    const ddl = readResult(executeExportModel(manifest, "ddl", { includeExamples: false }));
    expect(ddl).toContain("customer_id UUID NOT NULL");
    expect(ddl).toContain("exported as UUID by the project's identifier strategy");
  });

  it("lets an explicit option win over the project's setting", () => {
    const ddl = readResult(
      executeExportModel(manifest, "ddl", {
        includeExamples: false,
        preferredIdentifierStrategy: "integer",
      }),
    );
    expect(ddl).toContain("customer_id INTEGER NOT NULL");
  });

  it("leaves a single model alone (R4)", () => {
    const ddl = readResult(
      executeExportModel(join(dir, "crm.orm.yaml"), "ddl", { includeExamples: false }),
    );
    expect(ddl).toContain("customer_id TEXT NOT NULL");
  });
});

describe("export_model reports what the format could not express (barwise-wc0)", () => {
  // DDL has no clause for an irreflexive ring, so the router spills it.
  const ringModel = `
orm_version: "1.0"
model:
  name: Ring
  object_types:
    - { id: ot-person, name: Person, kind: entity, reference_mode: person_id }
  fact_types:
    - id: ft-parent
      name: Person is parent of Person
      roles:
        - { id: r-parent, player: ot-person, role_name: is parent of }
        - { id: r-child, player: ot-person, role_name: is child of }
      readings: ["{0} is parent of {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r-parent, r-child] }
        - { type: ring, role_1: r-parent, role_2: r-child, ring_type: irreflexive }
`;
  const RING = "No Person is parent of that same Person.";

  afterEach(() => {
    delete process.env.BARWISE_MCP_INLINE_LIMIT;
  });

  it("returns the report as a second block, with pseudocode and example", () => {
    const result = executeExportModel(ringModel, "ddl");
    expect(result.content).toHaveLength(2);
    expect(result.content[0]!.text).toContain("CREATE TABLE person_is_parent_of_person");
    const report = result.content[1]!.text;
    expect(report).toMatch(/^1 constraint\(s\) the ddl format could not express:/);
    expect(report).toContain(`- ${RING}`);
    expect(report).toMatch(/ {2}Pseudocode: \S/);
    expect(report).toMatch(/ {2}Example: \S/);
  });

  it("returns one block when every constraint was expressed", () => {
    const plain = ringModel.replace(/\n {8}- \{ type: ring.*\n/, "\n");
    expect(plain).not.toContain("ring");
    expect(executeExportModel(plain, "ddl").content).toHaveLength(1);
  });

  it("bounds the report on its own, and never writes it to outputPath", () => {
    process.env.BARWISE_MCP_INLINE_LIMIT = "50";
    const outputPath = join(ws.dir(), "out.sql");
    const result = executeExportModel(ringModel, "ddl", undefined, outputPath);
    expect(result.content).toHaveLength(2);
    expect(result.content[0]!.text).toContain(`Full content written to: ${outputPath}`);
    expect(readFileSync(outputPath, "utf8")).toContain("CREATE TABLE");
    const report = result.content[1]!.text;
    expect(report).toContain("Full content written to:");
    expect(report).not.toContain(outputPath);
    // The preview still names the ring.
    expect(report).toContain(RING);
  });
});
