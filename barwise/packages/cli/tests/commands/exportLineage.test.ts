/**
 * An export records what it was built from, so `lineage impact` finds it
 * (export-lineage-sources.spec.md, barwise-ofb). Every manifest recorded
 * `sources: []` and `sourceModel: ""`, and impact answered nothing for any
 * element with exit 0 -- behind green unit tests of generators nothing
 * called. This is the surface test whose absence allowed that (R4).
 */
import { registerFormat } from "@barwise/core";
import { type LineageManifest, parseManifest, serializeManifest } from "@barwise/core/lineage";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

/**
 * One manifest serves every model in its directory, so each export names
 * its model and the lineage commands read only that model's (iri-identity,
 * WS6 6a). An export written before that names none; the next export from
 * the model that owns its sources records whose it is.
 */
describe("two models, one manifest", () => {
  let dir: string;
  let a: string;
  let b: string;
  const manifestFile = () => join(dir, ".barwise", "lineage.yaml");

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-lineage-two-"));
    a = join(dir, "a.orm.yaml");
    b = join(dir, "b.orm.yaml");
    copyFileSync(join(fixtures, "simple.orm.yaml"), a);
    copyFileSync(join(fixtures, "../../../../examples/output/employee-hierarchy.orm.yaml"), b);
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const json = async (args: string[]) =>
    JSON.parse((await runCli([...args, "--format", "json"])).stdout);

  it("names each export's model, and status reads only its own", async () => {
    expect(
      (await runCli(["export", a, "--format", "ddl", "--output", join(dir, "a.sql")])).exitCode,
    )
      .toBe(0);
    expect(
      (await runCli(["export", b, "--format", "ddl", "--output", join(dir, "b.sql")])).exitCode,
    )
      .toBe(0);

    const shown = await json(["lineage", "show", a]);
    expect(shown.exports.map((e: { sourceModel: string; }) => e.sourceModel)).toEqual([
      "a.orm.yaml",
      "b.orm.yaml",
    ]);
    // Before, b's export overwrote the one model the manifest named, and
    // status on a compared a's hash with b's artifact.
    const status = await json(["lineage", "status", a]);
    expect(status.freshArtifacts).toEqual([resolve(join(dir, "a.sql"))]);
    expect(status.staleArtifacts).toEqual([]);
    expect(status.unattributedArtifacts).toEqual([]);
  });

  it("skips another model's export in impact, though it holds the id", async () => {
    mkdirSync(join(dir, ".barwise"));
    const holding = (artifact: string, sourceModel: string) => ({
      artifact,
      format: "ddl",
      exportedAt: "2026-10-29T00:00:00Z",
      modelHash: "h",
      sources: [{ elementId: "ot-customer", elementType: "EntityType", elementName: "Customer" }],
      sourceModel,
    });
    writeFileSync(
      manifestFile(),
      serializeManifest({
        version: 1,
        sourceModel: "b.orm.yaml",
        sourceModelHash: "h",
        exports: [holding("a.sql", "a.orm.yaml"), holding("b.sql", "b.orm.yaml")],
      } as LineageManifest),
    );
    const report = await json(["lineage", "impact", a, "--element", "ot-customer"]);
    expect(report.affectedArtifacts.map((x: { artifact: string; }) => x.artifact)).toEqual([
      "a.sql",
    ]);
  });

  it("records whose an older export is on the next export, and lists one it cannot place", async () => {
    mkdirSync(join(dir, ".barwise"));
    const legacy = (artifact: string, ids: string[]) => ({
      artifact,
      format: "ddl",
      exportedAt: "2026-10-01T00:00:00Z",
      modelHash: "old",
      sources: ids.map((elementId) => ({ elementId, elementType: "EntityType", elementName: "x" })),
    });
    writeFileSync(
      manifestFile(),
      serializeManifest({
        version: 1,
        sourceModel: "b.orm.yaml",
        sourceModelHash: "old",
        exports: [legacy("old-a.sql", ["ot-customer"]), legacy("old-nolineage.sql", [])],
      } as LineageManifest),
    );

    expect(
      (await runCli(["export", a, "--format", "ddl", "--output", join(dir, "a.sql")])).exitCode,
    )
      .toBe(0);
    const written = parseManifest(readFileSync(manifestFile(), "utf-8"));
    expect(
      written.exports.map((e: { artifact: string; sourceModel?: string; }) => [
        e.artifact,
        e.sourceModel,
      ]),
    ).toEqual([
      ["old-a.sql", "a.orm.yaml"],
      ["old-nolineage.sql", undefined],
      [resolve(join(dir, "a.sql")), "a.orm.yaml"],
    ]);

    const status = await runCli(["lineage", "status", a]);
    expect(status.stdout).toContain("1 artifact(s) name no model");
    expect(status.stdout).toContain("old-nolineage.sql");
    // Neither fresh nor stale can be said of it, so the check fails as a
    // stale artifact fails it.
    expect(status.exitCode).toBe(1);
  });
});
