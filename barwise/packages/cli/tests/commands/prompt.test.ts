/**
 * Tests for the prompt command's LLM-free subcommands: score against
 * the packaged suite, schema export, and history rendering. `prompt
 * eval` needs a live provider and is exercised manually per the
 * tests/live policy.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const responsesDir = resolve(
  __dirname,
  "../../../promptlab/tests/fixtures/responses",
);

describe("barwise prompt score", () => {
  it("scores a recorded payload against its case", async () => {
    const result = await runCli([
      "prompt",
      "score",
      "--case",
      "order-management",
      "--extraction",
      join(responsesDir, "order-management.json"),
    ]);
    expect(result.exitCode).toBe(0);
    const score = JSON.parse(result.stdout);
    expect(score.caseId).toBe("order-management");
    expect(score.rubricPassed).toBe(score.rubricTotal);
    expect(score.score).toBeCloseTo(0.98, 10);
  });

  it("reports an unknown case id with the available ids", async () => {
    const result = await runCli([
      "prompt",
      "score",
      "--case",
      "nope",
      "--extraction",
      join(responsesDir, "order-management.json"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown case "nope"');
    expect(result.stderr).toContain("order-management");
  });
});

describe("barwise prompt schema", () => {
  it("prints the extraction structured-output schema", async () => {
    const result = await runCli(["prompt", "schema"]);
    expect(result.exitCode).toBe(0);
    const schema = JSON.parse(result.stdout);
    expect(schema.properties).toHaveProperty("object_types");
    expect(schema.properties).toHaveProperty("fact_types");
  });

  it("rejects an unknown surface", async () => {
    const result = await runCli(["prompt", "schema", "--surface", "review"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("extraction only");
  });
});

describe("barwise prompt history", () => {
  it("reports an empty history for a fresh suite", async () => {
    const dir = mkdtempSync(join(tmpdir(), "barwise-prompt-"));
    writeFileSync(join(dir, "t.md"), "Facilitator: hi.\n");
    writeFileSync(
      join(dir, "case.eval.yaml"),
      "id: c\ntranscript: t.md\nchecks:\n  - kind: must_validate\n",
    );
    const manifest = join(dir, "suite.yaml");
    writeFileSync(
      manifest,
      "version: 1.0.0\nweights: {conformanceCorrection: 0.02, validationError: 0.1}\n"
        + "cases: [case.eval.yaml]\n",
    );
    const result = await runCli(["prompt", "history", "--suite", manifest]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("No recorded eval runs");
  });
});
