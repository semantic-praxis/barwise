/**
 * Tests for the describe command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
