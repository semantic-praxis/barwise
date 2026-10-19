/**
 * Tests for the verbalize command.
 */
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = resolve(__dirname, "../fixtures");

describe("barwise verbalize", () => {
  it("generates verbalizations for a model", async () => {
    const result = await runCli(["verbalize", `${fixtures}/simple.orm.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Customer");
    expect(result.stdout).toContain("Name");
  });

  it("outputs JSON with --format json", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThan(0);
    expect(parsed[0]).toHaveProperty("category");
    expect(parsed[0]).toHaveProperty("text");
  });

  it("names every constraint row by its own id and the fact types it applies to", async () => {
    // orm-format-3 Open decision 9: one rule for every constraint row, so a
    // consumer resolves sourceElementId as a constraint and factTypeIds as
    // fact types, whatever the kind. The external uniqueness spans both.
    const fixture = resolve(
      __dirname,
      "../../../../test-plan/fixtures/external-uniqueness.orm.yaml",
    );
    for (const extra of [[], ["--counterexamples"]]) {
      const result = await runCli(["verbalize", fixture, "--format", "json", ...extra]);
      expect(result.exitCode).toBe(0);
      const parsed = JSON.parse(result.stdout);
      const rows: Array<{ category: string; sourceElementId: string; factTypeIds?: string[]; }> =
        Array.isArray(parsed) ? parsed : parsed.verbalizations;
      const factTypeIds = new Set(
        rows.filter((r) => r.category === "fact_type").map((r) => r.sourceElementId),
      );
      const constraints = rows.filter((r) => r.category === "constraint");
      expect(constraints.length).toBeGreaterThan(0);
      for (const r of constraints) {
        expect(factTypeIds.has(r.sourceElementId), r.sourceElementId).toBe(false);
        expect(r.factTypeIds!.every((id) => factTypeIds.has(id))).toBe(true);
      }
      expect(constraints.map((r) => r.factTypeIds!.length).sort()).toEqual([1, 1, 2]);
      expect(rows.some((r) => r.category === "section")).toBe(true);
      expect(rows.filter((r) => r.category !== "constraint").every((r) => !("factTypeIds" in r)))
        .toBe(true);
    }
  });

  it("filters by fact type with --fact-type", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--fact-type",
      "Customer has Name",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Customer");
  });

  it("appends the open-questions section from model annotations", async () => {
    // simple.orm.yaml's Name value type has no data type -- a TODO
    // annotation -- so the default output carries the section.
    const result = await runCli(["verbalize", `${fixtures}/simple.orm.yaml`]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("== Open questions ==");
  });

  it("omits the open-questions section with --no-annotate", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--no-annotate",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("== Open questions ==");
  });

  it("treats an empty --fact-type as a name that is not found", async () => {
    const result = await runCli(["verbalize", `${fixtures}/simple.orm.yaml`, "--fact-type", ""]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain(`Fact type "" not found in model.`);
  });

  it("gives a project domain without the fact type no counterexamples", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/project/project.orm-project.yaml`,
      "--fact-type",
      "Customer has Email",
      "--counterexamples",
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const blocks: Array<{ domain: string; counterexamples: unknown[]; }> = JSON.parse(
      result.stdout,
    );
    expect(blocks.find((b) => b.domain === "crm")!.counterexamples.length).toBeGreaterThan(0);
    expect(blocks.find((b) => b.domain === "billing")!.counterexamples).toEqual([]);
  });

  it("appends counterexamples with --counterexamples", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--counterexamples",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(
      "Counterexamples (what the constraints rule out):",
    );
    expect(result.stdout).toContain("Rules out:");
  });

  it("includes counterexamples in JSON output", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--counterexamples",
      "--format",
      "json",
    ]);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty("verbalizations");
    expect(parsed).toHaveProperty("counterexamples");
    expect(Array.isArray(parsed.counterexamples)).toBe(true);
    expect(parsed.counterexamples.length).toBeGreaterThan(0);
  });

  it("reports error for nonexistent fact type", async () => {
    const result = await runCli([
      "verbalize",
      `${fixtures}/simple.orm.yaml`,
      "--fact-type",
      "Nonexistent Fact",
    ]);
    expect(result.stderr).toContain("not found");
    expect(result.exitCode).toBe(1);
  });
});

describe("barwise verbalize (project)", () => {
  const project = `${fixtures}/project/project.orm-project.yaml`;

  it("verbalizes every domain with == context == headers", async () => {
    const result = await runCli(["verbalize", project]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("== crm ==");
    expect(result.stdout).toContain("== billing ==");
  });

  it("verbalizes one domain with --domain (no headers)", async () => {
    const result = await runCli(["verbalize", project, "--domain", "crm"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("== billing ==");
    expect(result.stdout).not.toContain("== crm ==");
  });

  it("emits a JSON array over domains with --format json", async () => {
    const result = await runCli(["verbalize", project, "--format", "json"]);
    const parsed = JSON.parse(result.stdout);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.map((b) => b.domain).sort()).toEqual(["billing", "crm"]);
  });

  it("errors for an unknown --domain", async () => {
    const result = await runCli(["verbalize", project, "--domain", "ghost"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("ghost");
  });
});
