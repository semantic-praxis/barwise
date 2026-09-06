/**
 * Tests for the describe command.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("barwise describe", () => {
  it("returns domain summary for valid model", async () => {
    const result = await runCli(["describe", `${fixtures}/simple.orm.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Domain Model:");
    expect(result.stdout).toContain("Entities:");
    expect(result.stdout).toContain("Fact Types:");
  });

  it("returns focused output with --focus on entity", async () => {
    const result = await runCli([
      "describe",
      `${fixtures}/simple.orm.yaml`,
      "--focus",
      "Customer",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Entity: Customer");
    expect(result.stdout).toContain("Related Fact Types:");
  });

  it("returns JSON output with --json", async () => {
    const result = await runCli([
      "describe",
      `${fixtures}/simple.orm.yaml`,
      "--json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("summary");
    expect(parsed).toHaveProperty("entityTypes");
    expect(parsed).toHaveProperty("factTypes");
    expect(parsed).toHaveProperty("constraints");
    expect(Array.isArray(parsed.entityTypes)).toBe(true);
    expect(Array.isArray(parsed.factTypes)).toBe(true);
    expect(Array.isArray(parsed.constraints)).toBe(true);
  });

  it("returns verbose output with --verbose", async () => {
    const result = await runCli([
      "describe",
      `${fixtures}/simple.orm.yaml`,
      "--verbose",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Entity Types:");
    expect(result.stdout).toContain("Fact Types:");
    expect(result.stdout).toContain("Constraints:");
  });

  it("reports error for nonexistent file", async () => {
    const result = await runCli([
      "describe",
      `${fixtures}/nonexistent.orm.yaml`,
    ]);
    expect(result.stderr).toContain("File not found");
    expect(result.exitCode).toBe(1);
  });

  it("handles focus on constraint type", async () => {
    const result = await runCli([
      "describe",
      `${fixtures}/simple.orm.yaml`,
      "--focus",
      "mandatory",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Constraint Type:");
  });
});

describe("barwise describe (project)", () => {
  const project = `${fixtures}/project/project.orm-project.yaml`;

  it("describes every domain with == context == headers", async () => {
    const result = await runCli(["describe", project]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("== crm ==");
    expect(result.stdout).toContain("== billing ==");
  });

  it("describes one domain with --domain", async () => {
    const result = await runCli(["describe", project, "--domain", "billing"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("== crm ==");
  });

  it("emits a JSON array over domains with --json", async () => {
    const result = await runCli(["describe", project, "--json"]);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((b) => b.domain).sort()).toEqual(["billing", "crm"]);
  });

  it("errors for an unknown --domain", async () => {
    const result = await runCli(["describe", project, "--domain", "ghost"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ghost");
  });
});

describe("barwise describe --verbose (empty and populated sections)", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-describe-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("omits every section when the model has no entities, fact types, or constraints", async () => {
    const modelPath = join(dir, "bare.orm.yaml");
    writeFileSync(
      modelPath,
      'orm_version: "1.0"\nmodel:\n  name: Bare\n  domain_context: bare\n',
    );

    const result = await runCli(["describe", modelPath, "--verbose"]);
    expect(result.exitCode).toBe(0);
    // The summary line always reads "Fact Types: 0" etc.; only the
    // verbose section header (colon immediately followed by newline)
    // is what these branches control.
    expect(result.stdout).not.toContain("Entity Types:\n");
    expect(result.stdout).not.toContain("Fact Types:\n");
    expect(result.stdout).not.toContain("Constraints:\n");
  });

  it("renders a Populations section when the model carries sample instances", async () => {
    const modelPath = join(dir, "populated.orm.yaml");
    writeFileSync(
      modelPath,
      [
        'orm_version: "1.0"',
        "model:",
        "  name: Populated",
        "  domain_context: populated",
        "  object_types:",
        '    - id: "ot-customer"',
        '      name: "Customer"',
        '      kind: "entity"',
        '      reference_mode: "customer_id"',
        '    - id: "ot-name"',
        '      name: "Name"',
        '      kind: "value"',
        "  fact_types:",
        '    - id: "ft-customer-has-name"',
        '      name: "Customer has Name"',
        "      roles:",
        '        - id: "r-has"',
        '          player: "ot-customer"',
        '          role_name: "has"',
        '        - id: "r-of"',
        '          player: "ot-name"',
        '          role_name: "is of"',
        '      readings: ["{0} has {1}"]',
        "  populations:",
        '    - id: "pop-1"',
        '      fact_type: "ft-customer-has-name"',
        "      instances:",
        '        - id: "inst-1"',
        "          role_values:",
        '            r-has: "C001"',
        '            r-of: "Ann"',
        "",
      ].join("\n"),
    );

    const result = await runCli(["describe", modelPath, "--verbose"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Populations:");
    expect(result.stdout).toContain("instances");
  });
});
