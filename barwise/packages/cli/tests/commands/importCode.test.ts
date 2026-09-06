/**
 * Tests for `barwise import typescript|java|kotlin`.
 *
 * No language server is installed in this environment, so every one of
 * these importers falls back to regex-based analysis and still exits 0
 * -- which is real code-analysis behavior, not a stub, and gives a
 * deterministic warnings path without a network call or a fake LLM.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-import-code-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("barwise import typescript/java/kotlin (no language server installed)", () => {
  it("falls back to regex-based analysis and reports the missing-server warning", async () => {
    mkdirSync(join(dir, "src"), { recursive: true });
    writeFileSync(join(dir, "src", "index.ts"), "export const x = 1;\n");

    const result = await runCli(["import", "typescript", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Importing ORM model from Typescript project");
    expect(result.stderr).toContain("warning(s):");
    expect(result.stderr).toContain("Could not start TypeScript language server");
    expect(result.stdout).toContain("orm_version");
  });

  it("uses the directory name as the default model name", async () => {
    const result = await runCli(["import", "java", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`name: ${dir.split("/").pop()}`);
  });

  it("honors --name over the directory-name default", async () => {
    const result = await runCli(["import", "kotlin", dir, "--name", "custom-name"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("name: custom-name");
  });

  it("passes a custom --lsp-command through to the importer", async () => {
    const result = await runCli([
      "import",
      "typescript",
      dir,
      "--lsp-command",
      "some-custom-server --stdio",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain(
      "Could not start TypeScript language server: spawn some-custom-server",
    );
  });
});
