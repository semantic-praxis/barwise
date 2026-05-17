/**
 * Tests for the query command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../helpers/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");
const model = `${fixtures}/simple.orm.yaml`;

describe("barwise query", () => {
  it("lists entities", async () => {
    const result = await runCli(["query", model, "entities"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Object types");
    expect(result.stdout).toContain("Customer");
  });

  it("describes a single entity", async () => {
    const result = await runCli(["query", model, "entity", "Customer"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Entity: Customer");
  });

  it("handles a quoted fact type name passed as separate tokens", async () => {
    const result = await runCli([
      "query",
      model,
      "fact-type",
      "Customer has Name",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Fact type: Customer has Name");
  });

  it("reports model statistics", async () => {
    const result = await runCli(["query", model, "stats"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Model:");
  });

  it("outputs structured JSON with --json", async () => {
    const result = await runCli(["query", model, "--json", "stats"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.kind).toBe("stats");
    expect(parsed.stats).toBeDefined();
  });

  it("returns a not-found message for a missing entity (exit 0)", async () => {
    const result = await runCli(["query", model, "entity", "Ghost"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Ghost");
  });

  it("reports a query parse error and exits 1", async () => {
    const result = await runCli(["query", model, "bogus"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Query error");
  });

  it("errors when no query is provided", async () => {
    const result = await runCli(["query", model]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no query");
  });

  it("reports an error for a nonexistent file", async () => {
    const result = await runCli([
      "query",
      `${fixtures}/nonexistent.orm.yaml`,
      "entities",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("File not found");
  });
});
