/**
 * An export records what it was built from, so `lineage impact` finds it
 * (export-lineage-sources.spec.md, barwise-ofb). Every manifest recorded
 * `sources: []` and `sourceModel: ""`, and impact answered nothing for any
 * element with exit 0 -- behind green unit tests of generators nothing
 * called. This is the surface test whose absence allowed that (R4).
 */
import { registerFormat } from "@barwise/core";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");

describe("export, then lineage impact", () => {
  let dir: string;
  let model: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-lineage-"));
    model = join(dir, "model.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), model);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.each(["ddl", "openapi", "avro", "norma", "dbt"])(
    "impact on an element the %s artifact renders lists that artifact",
    async (format) => {
      const out = join(dir, format === "dbt" ? "dbt" : `out.${format}`);
      const exported = await runCli(["export", model, "--format", format, "--output", out]);
      expect(exported.exitCode, exported.stderr).toBe(0);
      expect(exported.stderr).not.toMatch(/records no lineage/);

      const impact = await runCli([
        "lineage",
        "impact",
        model,
        "--element",
        "ot-customer",
        "--format",
        "json",
      ]);
      const report = JSON.parse(impact.stdout);
      expect(report.affectedArtifacts.map((a: { artifact: string; }) => a.artifact)).toContain(
        resolve(out),
      );
    },
  );

  // PR #577 review: RelationalMapper records a subtype fact id on the
  // subtype table's key, and NORMA writes every subtype fact, but the
  // generators named neither, so impact on a subtype fact found nothing.
  it.each(["ddl", "openapi", "avro", "norma", "dbt"])(
    "impact on a subtype fact lists the %s artifact",
    async (format) => {
      const hierarchy = join(dir, "hierarchy.orm.yaml");
      copyFileSync(
        join(fixtures, "../../../../examples/output/employee-hierarchy.orm.yaml"),
        hierarchy,
      );
      const out = join(dir, format === "dbt" ? "dbt" : `out.${format}`);
      const exported = await runCli(["export", hierarchy, "--format", format, "--output", out]);
      expect(exported.exitCode, exported.stderr).toBe(0);
      const impact = await runCli([
        "lineage",
        "impact",
        hierarchy,
        "--element",
        "9bb914ef-c751-469b-80f1-b449d0364495",
        "--format",
        "json",
      ]);
      const report = JSON.parse(impact.stdout);
      expect(report.affectedArtifacts.map((a: { artifact: string; }) => a.artifact)).toContain(
        resolve(out),
      );
    },
  );

  it("names the model in the manifest, so the artifact can be traced back to it", async () => {
    await runCli(["export", model, "--format", "ddl", "--output", join(dir, "schema.sql")]);
    const manifest = readFileSync(join(dir, ".barwise", "lineage.yaml"), "utf8");
    expect(manifest).toMatch(/sourceModel: model\.orm\.yaml/);
  });

  it("warns when a format records no lineage, rather than writing a silent empty list (R3)", async () => {
    registerFormat({
      name: "no-lineage-test",
      description: "a test format that records no lineage",
      extension: "txt",
      exporter: {
        name: "no-lineage-test",
        description: "a test format that records no lineage",
        export: () => ({ text: "x" }),
      },
    });
    const out = join(dir, "out.txt");
    const r = await runCli(["export", model, "--format", "no-lineage-test", "--output", out]);
    expect(r.exitCode).toBe(0);
    expect(r.stderr).toContain("records no lineage; lineage impact cannot see");
  });
});
