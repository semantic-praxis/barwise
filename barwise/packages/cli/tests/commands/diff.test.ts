/**
 * Tests for the diff command.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");
const testOutput = resolve(__dirname, "../test-output");

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

  it("suppresses synonym candidates in text output with --no-synonyms", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
      "--no-synonyms",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("change(s) detected");
  });

  it("suppresses synonym candidates in JSON output with --no-synonyms", async () => {
    const result = await runCli([
      "diff",
      `${fixtures}/simple.orm.yaml`,
      `${fixtures}/simple-modified.orm.yaml`,
      "--format",
      "json",
      "--no-synonyms",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed.synonymCandidates).toEqual([]);
  });

  it("labels a definition delta by its glossary term, in text and JSON", async () => {
    const base = `${fixtures}/simple.orm.yaml`;
    const incomingRaw = readFileSync(base, "utf-8")
      + '\n  definitions:\n    - term: "Order"\n      definition: "A customer request."\n';
    const incoming = join(testOutput, "diff-with-definition.orm.yaml");
    mkdirSync(testOutput, { recursive: true });
    writeFileSync(incoming, incomingRaw);

    const textResult = await runCli(["diff", base, incoming]);
    expect(textResult.exitCode).toBe(0);
    expect(textResult.stdout).toContain("Definition: Order");

    const jsonResult = await runCli(["diff", base, incoming, "--format", "json"]);
    const parsed = JSON.parse(jsonResult.stdout);
    expect(parsed.deltas.some((d: { name: string; }) => d.name === "Order")).toBe(true);

    // `test-output` is shared and transient, and every other writer here
    // removes what it wrote (new-export.test.ts, throughout). This one did
    // not, so a run left an untracked .orm.yaml behind -- noise in every
    // later `git status`, and a file a careless `git add -A` would commit.
    rmSync(incoming);
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
