/**
 * `barwise export <project>` types undeclared keys by the project's
 * `preferred_identifier_strategy`; exporting the same model file on its own
 * does not (identifier-strategy-in-exports.spec.md, R2 and R4). Before,
 * the setting was saved and loaded and never reached an export.
 */
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("barwise export and the project's identifier strategy", () => {
  let dir: string;
  let manifest: string;
  let model: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-strategy-"));
    model = join(dir, "sales.orm.yaml");
    // simple.orm.yaml declares no type for Customer's key.
    copyFileSync(join(fixtures, "simple.orm.yaml"), model);
    manifest = join(dir, "shop.orm-project.yaml");
    writeFileSync(
      manifest,
      [
        "project:",
        '  name: "Shop"',
        "  settings:",
        "    preferred_identifier_strategy: integer",
        "  domains:",
        '    - path: "./sales.orm.yaml"',
        '      context: "sales"',
        "",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("types the key by the strategy when exporting the project", async () => {
    const r = await runCli([
      "export",
      manifest,
      "--format",
      "ddl",
      "--domain",
      "sales",
      "--no-examples",
    ]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("customer_id INTEGER NOT NULL");
    expect(r.stdout).toContain("exported as INTEGER by the project's identifier strategy");
  });

  it("applies it to every domain of a whole-project export", async () => {
    const out = join(dir, "out");
    const r = await runCli(["export", manifest, "--format", "ddl", "--output", out]);
    expect(r.exitCode).toBe(0);
    expect(readFileSync(join(out, "sales.sql"), "utf8")).toContain("customer_id INTEGER NOT NULL");
  });

  it("leaves a single model file alone, even inside the project's directory", async () => {
    const r = await runCli(["export", model, "--format", "ddl", "--no-examples"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain("customer_id TEXT NOT NULL");
  });
});
