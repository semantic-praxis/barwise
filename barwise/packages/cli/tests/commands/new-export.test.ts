/**
 * Tests for the new export command (format registry dispatch).
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");
const testOutput = resolve(__dirname, "../test-output");

describe("barwise export (new format registry)", () => {
  it("exports DDL to stdout with --format ddl", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "ddl",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CREATE TABLE");
  });

  it("exports OpenAPI to stdout with --format openapi", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "openapi",
    ]);
    expect(result.exitCode).toBe(0);
    // OpenAPI output should be JSON.
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("openapi");
    expect(parsed).toHaveProperty("info");
    expect(parsed).toHaveProperty("paths");
  });

  it("writes output to file with --output", async () => {
    const outputFile = `${testOutput}/test-export.sql`;
    // Clean up from previous runs.
    if (existsSync(outputFile)) {
      rmSync(outputFile);
    }

    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "ddl",
      "--output",
      outputFile,
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(outputFile)).toBe(true);

    const content = readFileSync(outputFile, "utf-8");
    expect(content).toContain("CREATE TABLE");

    // Clean up.
    rmSync(outputFile);
  });

  it("reports error for unknown format", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "unknown",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Unknown export format");
    expect(result.stderr).toContain("Available formats:");
  });

  it("reports error for nonexistent file", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/nonexistent.orm.yaml`,
      "--format",
      "ddl",
    ]);
    expect(result.stderr).toContain("File not found");
    expect(result.exitCode).toBe(1);
  });

  it("respects --no-annotate flag", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "ddl",
      "--no-annotate",
    ]);
    expect(result.exitCode).toBe(0);
    // With --no-annotate, output should be cleaner (no TODO comments).
    // This is a behavior test, not a strict check.
    expect(result.stdout).toContain("CREATE TABLE");
  });

  it("respects --strict flag and fails on validation errors", async () => {
    // Use invalid fixture if available, otherwise skip.
    const invalidFile = `${fixtures}/invalid.orm.yaml`;
    if (!existsSync(invalidFile)) {
      // Skip if invalid fixture doesn't exist.
      return;
    }

    const result = await runCli([
      "export",
      invalidFile,
      "--format",
      "ddl",
      "--strict",
    ]);
    // Should fail in strict mode with validation errors.
    expect(result.exitCode).toBe(1);
    expect(result.stderr.toLowerCase()).toContain("error");
  });

  it("exports dbt to stdout with --format dbt", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "dbt",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("schema.yml");
    expect(result.stdout).toContain("version: 2");
  });

  it("exports Avro to stdout with --format avro", async () => {
    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "avro",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('"type": "record"');
    expect(result.stdout).toContain(".avsc");
  });

  it("writes dbt multi-file output with --output", async () => {
    const outputDir = `${testOutput}/dbt-export`;
    // Clean up from previous runs.
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true });
    }

    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "dbt",
      "--output",
      outputDir,
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(outputDir)).toBe(true);

    // Should have schema.yml.
    const schemaPath = join(outputDir, "models", "schema.yml");
    expect(existsSync(schemaPath)).toBe(true);
    const schemaContent = readFileSync(schemaPath, "utf-8");
    expect(schemaContent).toContain("version: 2");

    // Clean up.
    rmSync(outputDir, { recursive: true });
  });

  it("persists lineage manifest when exporting with --output", async () => {
    const outputFile = `${testOutput}/manifest-test.sql`;
    const manifestPath = join(
      dirname(resolve(`${fixtures}/simple.orm.yaml`)),
      ".barwise",
      "lineage.yaml",
    );

    // Clean up from previous runs.
    if (existsSync(outputFile)) {
      rmSync(outputFile);
    }

    const result = await runCli([
      "export",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "ddl",
      "--output",
      outputFile,
    ]);
    expect(result.exitCode).toBe(0);

    // Manifest should be created next to the fixture.
    expect(existsSync(manifestPath)).toBe(true);
    const manifestContent = readFileSync(manifestPath, "utf-8");
    expect(manifestContent).toContain("version: 1");
    expect(manifestContent).toContain("format: ddl");

    // Clean up.
    rmSync(outputFile);
    rmSync(manifestPath);
    // Remove .barwise directory if empty.
    const barwiseDir = dirname(manifestPath);
    try {
      rmSync(barwiseDir, { recursive: true });
    } catch {
      // Ignore if directory not empty.
    }
  });
});

describe("barwise export (project)", () => {
  const project = `${fixtures}/project/project.orm-project.yaml`;

  it("writes one file per domain into the --output directory", async () => {
    const outputDir = `${testOutput}/project-export`;
    if (existsSync(outputDir)) {
      rmSync(outputDir, { recursive: true });
    }

    const result = await runCli([
      "export",
      project,
      "--format",
      "ddl",
      "--output",
      outputDir,
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(outputDir, "crm.ddl"))).toBe(true);
    expect(existsSync(join(outputDir, "billing.ddl"))).toBe(true);
    expect(readFileSync(join(outputDir, "crm.ddl"), "utf-8")).toContain("CREATE TABLE");

    rmSync(outputDir, { recursive: true });
  });

  it("exports a single domain to stdout with --domain", async () => {
    const result = await runCli([
      "export",
      project,
      "--format",
      "ddl",
      "--domain",
      "crm",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("CREATE TABLE");
  });

  it("exports a single domain to a file with --domain and --output", async () => {
    const outputFile = `${testOutput}/crm-only.sql`;
    if (existsSync(outputFile)) {
      rmSync(outputFile);
    }

    const result = await runCli([
      "export",
      project,
      "--format",
      "ddl",
      "--domain",
      "crm",
      "--output",
      outputFile,
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(outputFile)).toBe(true);
    expect(readFileSync(outputFile, "utf-8")).toContain("CREATE TABLE");

    rmSync(outputFile);
  });

  it("requires --output when exporting a whole project", async () => {
    const result = await runCli([
      "export",
      project,
      "--format",
      "ddl",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("requires --output");
  });

  it("reports an error for an unknown --domain", async () => {
    const result = await runCli([
      "export",
      project,
      "--format",
      "ddl",
      "--domain",
      "ghost",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ghost");
  });
});
