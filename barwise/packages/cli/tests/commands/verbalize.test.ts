/**
 * Tests for the verbalize command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("barwise verbalize", () => {
  it("generates verbalizations for a model", async () => {
    const result = await runCli(["verbalize", `${fixtures}/simple.orm.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Customer");
    expect(result.stdout).toContain("Name");
  });

  it("outputs JSON with --format json", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("category");
    expect(parsed[0]).toHaveProperty("text");
  });

  it("filters by fact type with --fact-type", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--fact-type",
      "Customer has Name",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Customer");
  });

  it("appends counterexamples with --counterexamples", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--counterexamples",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Counterexamples (what the constraints rule out):",
    );
    expect(result.stdout).toContain("Rules out:");
  });

  it("includes counterexamples in JSON output", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--counterexamples",
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("verbalizations");
    expect(parsed).toHaveProperty("counterexamples");
    expect(Array.isArray(parsed.counterexamples)).toBe(true);
    expect(parsed.counterexamples.length).toBeGreaterThan(0);
  });

  it("reports error for nonexistent fact type", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--fact-type",
      "Nonexistent Fact",
    ]);
    expect(result.stderr).toContain("not found");
    expect(result.exitCode).toBe(1);
  });
});

describe("barwise verbalize (project)", () => {
  const project = `${fixtures}/project/project.orm-project.yaml`;

  it("verbalizes every domain with == context == headers", async () => {
    const result = await runCli(["verbalize", project]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("== crm ==");
    expect(result.stdout).toContain("== billing ==");
  });

  it("verbalizes one domain with --domain (no headers)", async () => {
    const result = await runCli(["verbalize", project, "--domain", "crm"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("== billing ==");
    expect(result.stdout).not.toContain("== crm ==");
  });

  it("emits a JSON array over domains with --format json", async () => {
    const result = await runCli(["verbalize", project, "--format", "json"]);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((b) => b.domain).sort()).toEqual(["billing", "crm"]);
  });

  it("errors for an unknown --domain", async () => {
    const result = await runCli(["verbalize", project, "--domain", "ghost"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ghost");
  });
});
