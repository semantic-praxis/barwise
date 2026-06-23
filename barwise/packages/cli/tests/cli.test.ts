/**
 * Tests for the CLI scaffolding: program creation, version, help.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "./workspace/run.js";

const { version } = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
) as { version: string; };

describe("CLI scaffolding", () => {
  it("shows version with --version", async () => {
    const result = await runCli(["--version"]);
    expect(result.stdout).toContain(version);
  });

  it("shows help with --help", async () => {
    const result = await runCli(["--help"]);
    expect(result.stdout).toContain("ORM 2");
    expect(result.stdout).toContain("validate");
    expect(result.stdout).toContain("verbalize");
    expect(result.stdout).toContain("schema");
    expect(result.stdout).toContain("diagram");
    expect(result.stdout).toContain("diff");
    expect(result.stdout).toContain("export");
    expect(result.stdout).toContain("import");
  });
});
