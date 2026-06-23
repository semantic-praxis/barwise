/**
 * Tests for the diagram command.
 */
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");
const tmpDir = resolve(__dirname, "../tmp-diagram");

describe("barwise diagram", () => {
  afterEach(() => {
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true });
    }
  });

  it("generates SVG to stdout", async () => {
    const result = await runCli(["diagram", `${fixtures}/simple.orm.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<svg");
  });

  it("writes SVG to file with --output", async () => {
    mkdirSync(tmpDir, { recursive: true });
    const outFile = join(tmpDir, "diagram.svg");
    const result = await runCli([
      "diagram",
      `${fixtures}/simple.orm.yaml`,
      "--output",
      outFile,
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(outFile)).toBe(true);
    const content = readFileSync(outFile, "utf-8");
    expect(content).toContain("<svg");
  });

  it("writes one SVG per domain for a project", async () => {
    const result = await runCli([
      "diagram",
      `${fixtures}/project/project.orm-project.yaml`,
      "--output",
      tmpDir,
    ]);
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(tmpDir, "crm.svg"))).toBe(true);
    expect(existsSync(join(tmpDir, "billing.svg"))).toBe(true);
    expect(readFileSync(join(tmpDir, "crm.svg"), "utf-8")).toContain("<svg");
  });

  it("requires --output when diagramming a project", async () => {
    const result = await runCli([
      "diagram",
      `${fixtures}/project/project.orm-project.yaml`,
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--output");
  });

  it("diagrams a single named domain with --domain", async () => {
    const result = await runCli([
      "diagram",
      `${fixtures}/project/project.orm-project.yaml`,
      "--domain",
      "crm",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<svg");
  });

  it("errors for an unknown --domain", async () => {
    const result = await runCli([
      "diagram",
      `${fixtures}/project/project.orm-project.yaml`,
      "--domain",
      "ghost",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ghost");
  });
});
