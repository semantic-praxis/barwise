/**
 * Tests for the generate_schema tool.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { executeSchema } from "../../src/tools/schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("generate_schema tool", () => {
  it("returns DDL by default", () => {
    const result = executeSchema(`${fixtures}/simple.orm.yaml`);
    expect(result.content[0]!.text).toContain("CREATE TABLE");
  });

  it("returns DDL when format is ddl", () => {
    const result = executeSchema(`${fixtures}/simple.orm.yaml`, "ddl");
    expect(result.content[0]!.text).toContain("CREATE TABLE");
  });

  it("returns JSON when format is json", () => {
    const result = executeSchema(`${fixtures}/simple.orm.yaml`, "json");
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveProperty("tables");
    expect(Array.isArray(parsed.tables)).toBe(true);
  });

  it("returns content in MCP format", () => {
    const result = executeSchema(`${fixtures}/simple.orm.yaml`);
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe("text");
  });
});

describe("generate_schema renders through export_model (barwise-zk4)", () => {
  // DDL has no clause for an irreflexive ring, so the router spills it.
  const ring = `
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
  const uniqueEmail = `
orm_version: "3.0"
model:
  name: Mail
  object_types:
    - { id: ot-c, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-e, name: Email, kind: value }
  fact_types:
    - id: ft-ce
      name: Customer has Email
      roles:
        - { id: r-c, player: ot-c, role_name: has }
        - { id: r-e, player: ot-e, role_name: belongs to }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-c, type: internal_uniqueness, roles: [r-c] }
        - { id: u-e, type: internal_uniqueness, roles: [r-e] }
`;

  it("returns the report as a second block for what DDL cannot express", () => {
    const result = executeSchema(ring, "ddl");
    expect(result.content).toHaveLength(2);
    expect(result.content[1]!.text).toContain("- No Person is parent of that same Person.");
  });

  it("writes the UNIQUE clause the router adds", () => {
    expect(executeSchema(uniqueEmail, "ddl").content[0]!.text).toContain("UNIQUE (email)");
  });
});
