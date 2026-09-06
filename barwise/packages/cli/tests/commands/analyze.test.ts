/**
 * Tests for `barwise analyze`.
 *
 * A local directory analyzes in place (no clone, no `gh`). Extraction
 * against a real language always resolves to a code importer that needs
 * a language server, so the extraction-success path mocks `getImporter`
 * (from `@barwise/core`, which `analyze.ts` calls directly) rather than
 * spawning a real LSP -- the registration and lookup stay real, only the
 * parse result is faked.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real "typescript" importer needs a running language server; a
// local project always resolves to it, so extraction success/failure
// is faked at the lookup `analyze.ts` itself calls (`getImporter` from
// `@barwise/core`), not by spawning a real LSP. Registration and every
// other format stay real.
vi.mock("@barwise/core", async () => {
  const actual = await vi.importActual<typeof import("@barwise/core")>("@barwise/core");
  return {
    ...actual,
    getImporter: vi.fn((name: string) => {
      if (name === "typescript") {
        return {
          name,
          parseAsync: async () => {
            const model = new actual.OrmModel({ name: "Extracted" });
            model.addObjectType({ name: "Widget", kind: "entity", referenceMode: "widget_id" });
            return { model, confidence: "high", warnings: [] };
          },
        };
      }
      if (name === "java") {
        return { name, description: "fake, no parseAsync" };
      }
      return actual.getImporter(name);
    }),
  };
});

const { runCli } = await import("../workspace/run.js");

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-analyze-test-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("barwise analyze (local directory, profile-only)", () => {
  it("profiles an empty directory as text with no framework or build system", async () => {
    const result = await runCli(["analyze", dir, "--profile-only"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Repository: ${dir}`);
    expect(result.stdout).toContain("Framework: none");
    expect(result.stdout).toContain("Build system: none");
    expect(result.stdout).toContain("Import format: none (LLM fallback)");
  });

  it("profiles a detected TypeScript/Express project as JSON with framework and build system", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.18.0" } }),
    );
    mkdirWithFile(
      dir,
      "src/app.ts",
      `import express from 'express';\nconst app = express();\napp.get('/health', (req, res) => res.send('ok'));\n`,
    );

    const result = await runCli(["analyze", dir, "--profile-only", "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      framework: { name: string; } | null;
      buildSystem: { name: string; } | null;
      domainPaths: string[];
      importFormat: string | null;
    };
    expect(parsed.framework?.name).toBe("Express");
    expect(parsed.buildSystem?.name).toBe("npm");
    expect(parsed.domainPaths.length).toBeGreaterThan(0);
    expect(parsed.importFormat).toBe("typescript");
  });

  it("prints framework signals and domain/exclude paths in text output", async () => {
    writeFileSync(
      join(dir, "package.json"),
      JSON.stringify({ dependencies: { express: "^4.18.0" } }),
    );
    mkdirWithFile(
      dir,
      "src/app.ts",
      `import express from 'express';\nconst app = express();\napp.get('/health', (req, res) => res.send('ok'));\n`,
    );

    const result = await runCli(["analyze", dir, "--profile-only"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Signal:");
    expect(result.stdout).toContain("Domain paths:");
  });

  it("prints null framework/buildSystem in JSON when neither is detected", async () => {
    writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");

    const result = await runCli(["analyze", dir, "--profile-only", "--format", "json"]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout) as { framework: unknown; buildSystem: unknown; };
    expect(parsed.framework).toBeNull();
    expect(parsed.buildSystem).toBeNull();
  });

  it("omits the domain paths section in text output when none are found", async () => {
    // A .ts file directly at the root with no src/ directory: the
    // typescript fallback domain path ("src") does not exist, so
    // fallbackDomainPaths returns an empty list.
    writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");

    const result = await runCli(["analyze", dir, "--profile-only"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("Domain paths:");
  });

  it("reports 'no deterministic import format' for a language with no code importer", async () => {
    writeFileSync(join(dir, "main.go"), "package main\n\nfunc main() {}\n");

    const result = await runCli(["analyze", dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("no deterministic import format detected");
  });
});

describe("barwise analyze (local directory, extraction)", () => {
  it("extracts a model via the resolved importer and writes it to stdout", async () => {
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirWithFile(dir, "src/app.ts", "export const x = 1;\n");

    const result = await runCli(["analyze", dir, "--domain", "widgets"]);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("Extracting business rules...");
  });

  it("writes the extracted model to --output instead of stdout", async () => {
    writeFileSync(join(dir, "package.json"), "{}");
    mkdirWithFile(dir, "src/app.ts", "export const x = 1;\n");
    const outFile = join(dir, "out.orm.yaml");

    const result = await runCli(["analyze", dir, "--output", outFile]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
    expect(readFileSync(outFile, "utf8")).toContain("Extracted");
  });

  it("scopes extraction to the repo root when domainPaths.length is not exactly 1", async () => {
    // No src/ directory exists, so the typescript fallback domain path
    // list is empty and extractModel must fall back to the full root.
    writeFileSync(join(dir, "index.ts"), "export const x = 1;\n");

    const result = await runCli(["analyze", dir]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("orm_version");
  });

  it("reports 'is not registered' when the resolved importer has no parseAsync", async () => {
    mkdirWithFile(dir, "src/main/java/com/example/App.java", "public class App {}\n");

    const result = await runCli(["analyze", dir]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('import format "java" is not registered');
  });
});

describe("barwise analyze (non-local repo reference)", () => {
  it("rejects a malformed repo reference before any network call", async () => {
    const result = await runCli(["analyze", "not-a-valid-ref"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid repo reference");
  });

  it("fails fast when the GitHub CLI is unavailable", async () => {
    const result = await runCli(["analyze", "someorg/somerepo"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Checking GitHub authentication...");
    expect(result.stderr.toLowerCase()).toContain("github cli");
  });
});

function mkdirWithFile(root: string, relativePath: string, content: string): void {
  const full = join(root, relativePath);
  const parent = full.substring(0, full.lastIndexOf("/"));
  mkdirSync(parent, { recursive: true });
  writeFileSync(full, content);
}
