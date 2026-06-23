/**
 * Tests for the diff command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("barwise diff", () => {
  it("reports no changes for identical models", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple.orm.yaml`,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No changes");
  });

  it("reports changes between different models", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("change(s) detected");
  });

  it("shows added elements", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
    ]);
    expect(result.stdout).toContain("ADDED");
    expect(result.stdout).toContain("Email");
  });

  it("outputs JSON with --format json", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("hasChanges", true);
    expect(parsed).toHaveProperty("deltas");
    expect(Array.isArray(parsed.deltas)).toBe(true);
  });

  it("reports error for nonexistent file", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/nonexistent.orm.yaml`,
    ]);
    expect(result.stderr).toContain("File not found");
    expect(result.exitCode).toBe(1);
  });
});
