/**
 * Tests for the schema command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
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
