/**
 * An export names, on stderr, the constraints its format could not
 * express (export-constraint-specs.spec.md, barwise-wc0). The DDL router
 * already spilled them into `ExportResult.constraintSpecs`, and the CLI
 * dropped the list: with `--output`, or behind `| psql`, nobody learned
 * that the irreflexive ring below has no CHECK in the artifact.
 */
import { registerFormat } from "@barwise/core";
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../fixtures");
const RING = "No Person is parent of that same Person.";

describe("export reports what the format could not express", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-specs-"));
    copyFileSync(join(fixtures, "ring.orm.yaml"), join(dir, "ring.orm.yaml"));
    copyFileSync(join(fixtures, "simple.orm.yaml"), join(dir, "simple.orm.yaml"));
    writeFileSync(
      join(dir, "p.orm-project.yaml"),
      [
        "project:",
        '  name: "P"',
        "  domains:",
        '    - path: "./simple.orm.yaml"',
        '      context: "crm"',
        '    - path: "./ring.orm.yaml"',
        '      context: "family"',
        "",
      ].join("\n"),
    );
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the ring to stderr and nothing new to stdout", async () => {
    const r = await runCli(["export", join(dir, "ring.orm.yaml"), "--format", "ddl"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toBe(`1 constraint(s) the ddl format could not express:\n  - ${RING}\n`);
    // The artifact's own spill comment is the format's; the report is not added.
    expect(r.stdout).not.toContain("could not express");
  });

  it("reports after writing with --output", async () => {
    const out = join(dir, "out.sql");
    const r = await runCli([
      "export",
      join(dir, "ring.orm.yaml"),
      "--format",
      "ddl",
      "--output",
      out,
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stdout).toBe(`Wrote ${out}\n`);
    expect(r.stderr).toContain(`  - ${RING}\n`);
  });

  it("says nothing when every constraint was expressed", async () => {
    const r = await runCli(["export", join(dir, "simple.orm.yaml"), "--format", "ddl"]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toBe("");
  });

  it("names the domain in a project export", async () => {
    const out = join(dir, "out");
    const r = await runCli([
      "export",
      join(dir, "p.orm-project.yaml"),
      "--format",
      "ddl",
      "--output",
      out,
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain(
      `1 constraint(s) the ddl format could not express (domain family):\n  - ${RING}\n`,
    );
    expect(r.stderr).not.toContain("(domain crm)");
  });

  it("names the domain chosen with --domain", async () => {
    const r = await runCli([
      "export",
      join(dir, "p.orm-project.yaml"),
      "--format",
      "ddl",
      "--domain",
      "family",
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toContain(`(domain family):\n  - ${RING}\n`);
    expect(r.stdout).not.toContain("could not express");
  });

  it("prints a rule spilled for several tables once, with its count", async () => {
    // The DDL router spills a rule once per table it touches; a person
    // needs to read it once.
    const spec = (verbalization: string) => ({ verbalization, pseudocode: "p", example: "e" });
    registerFormat({
      name: "repeat-spill-test",
      description: "a test format that spills one rule twice",
      extension: "txt",
      exporter: {
        name: "repeat-spill-test",
        description: "a test format that spills one rule twice",
        export: () => ({
          text: "x",
          constraintSpecs: [spec("Rule A."), spec("Rule B."), spec("Rule A.")],
        }),
      },
    });
    const r = await runCli([
      "export",
      join(dir, "simple.orm.yaml"),
      "--format",
      "repeat-spill-test",
    ]);
    expect(r.exitCode, r.stderr).toBe(0);
    expect(r.stderr).toBe(
      "3 constraint(s) the repeat-spill-test format could not express:\n  - Rule A. (x2)\n  - Rule B.\n",
    );
  });
});
