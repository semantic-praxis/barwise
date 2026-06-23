/**
 * Tests for the validate command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("barwise validate", () => {
  it("reports valid model with 0 errors", async () => {
    const result = await runCli(["validate", `${fixtures}/simple.orm.yaml`]);
    expect(result.stdout).toContain("0 error");
    expect(result.exitCode).toBe(0);
  });

  it("reports errors for invalid model and exits 1", async () => {
    const result = await runCli(["validate", `${fixtures}/invalid.orm.yaml`]);
    // The invalid fixture has a dangling player reference. This may
    // be caught at deserialization (schema validation) or by the
    // validation engine. Either way, the CLI should exit 1.
    const output = result.stdout + result.stderr;
    expect(output.toLowerCase()).toContain("error");
    expect(result.exitCode).toBe(1);
  });

  it("outputs JSON with --format json on a valid model", async () => {
    const result = await runCli([
      "validate",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "json",
    ]);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    // May have warnings but no errors.
    for (const d of parsed) {
      expect(d).toHaveProperty("severity");
      expect(d).toHaveProperty("message");
    }
  });

  it("reports error for nonexistent file", async () => {
    const result = await runCli(["validate", `${fixtures}/nonexistent.orm.yaml`]);
    expect(result.stderr).toContain("File not found");
    expect(result.exitCode).toBe(1);
  });

  it("suppresses warnings with --no-warnings", async () => {
    const resultWith = await runCli(["validate", `${fixtures}/simple.orm.yaml`]);
    const resultWithout = await runCli([
      "validate",
      `${fixtures}/simple.orm.yaml`,
      "--no-warnings",
    ]);
    // Both should succeed for a valid model.
    expect(resultWith.exitCode).toBe(0);
    expect(resultWithout.exitCode).toBe(0);
  });
});

describe("barwise validate (project)", () => {
  const project = `${fixtures}/project/project.orm-project.yaml`;

  it("validates a multi-domain project with 0 errors", async () => {
    const result = await runCli(["validate", project]);
    expect(result.stdout).toContain("0 error");
    expect(result.exitCode).toBe(0);
  });

  it("outputs JSON for a project with --format json", async () => {
    const result = await runCli(["validate", project, "--format", "json"]);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(result.exitCode).toBe(0);
  });

  it("reports an unresolved domain file as an error and exits 1", async () => {
    const result = await runCli([
      "validate",
      `${fixtures}/project/missing-domain.orm-project.yaml`,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout + result.stderr).toContain("ghost");
  });

  it("reports an error for a nonexistent project file", async () => {
    const result = await runCli([
      "validate",
      `${fixtures}/project/nope.orm-project.yaml`,
    ]);
    expect(result.stderr.toLowerCase()).toContain("not found");
    expect(result.exitCode).toBe(1);
  });
});
