/**
 * Tests for the schema command.
 */
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("barwise schema", () => {
  it("generates DDL by default", async () => {
    const result = await runCli(["schema", `${fixtures}/simple.orm.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CREATE TABLE");
  });

  it("generates JSON with --format json", async () => {
    const result = await runCli([
      "schema",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("tables");
    expect(Array.isArray(parsed.tables)).toBe(true);
    expect(parsed.tables.length).toBeGreaterThan(0);
    expect(parsed.tables[0]).toHaveProperty("name");
    expect(parsed.tables[0]).toHaveProperty("columns");
  });

  it("reports error for nonexistent file", async () => {
    const result = await runCli(["schema", `${fixtures}/nonexistent.orm.yaml`]);
    expect(result.stderr).toContain("File not found");
    expect(result.exitCode).toBe(1);
  });
});

/**
 * `barwise schema` renders DDL through the `ddl` exporter
 * (schema-ddl-routing.spec.md, barwise-zk4). It called `renderDdl` on the
 * mapper's schema directly, so a constraint the router expresses got no
 * clause and one it cannot express went unreported.
 */
describe("barwise schema renders through the DDL exporter", () => {
  const RING = "No Person is parent of that same Person.";
  const uniqueEmail = `orm_version: "3.0"
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
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-schema-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("reports what DDL cannot express on stderr, after the deprecation notice", async () => {
    const r = await runCli(["schema", `${fixtures}/ring.orm.yaml`]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toMatch(/deprecated[\s\S]*1 constraint\(s\) the ddl format could not express/);
    expect(r.stderr).toContain(`  - ${RING}\n`);
  });

  it("writes the UNIQUE clause the router adds for a secondary unique value", async () => {
    const model = join(dir, "mail.orm.yaml");
    writeFileSync(model, uniqueEmail);
    const r = await runCli(["schema", model]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toContain("UNIQUE (email)");
  });

  it("prints exactly what export --format ddl --no-annotate --no-examples prints", async () => {
    const schema = await runCli(["schema", `${fixtures}/ring.orm.yaml`]);
    const exported = await runCli([
      "export",
      `${fixtures}/ring.orm.yaml`,
      "--format",
      "ddl",
      "--no-annotate",
      "--no-examples",
    ]);
    expect(schema.stdout).toBe(exported.stdout);
  });

  it("writes no lineage manifest with --output", async () => {
    const model = join(dir, "ring.orm.yaml");
    copyFileSync(`${fixtures}/ring.orm.yaml`, model);
    const r = await runCli(["schema", model, "--output", join(dir, "out.sql")]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(readFileSync(join(dir, "out.sql"), "utf8")).toContain("CREATE TABLE person");
    expect(existsSync(join(dir, ".barwise"))).toBe(false);
    expect(r.stderr).toContain(RING);
  });
});
