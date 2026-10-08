/**
 * `--infer-references` reaches the DDL importer through every path that
 * accepts it, and is refused where it would do nothing
 * (reference-inference.spec.md, requirements 5 and 6).
 */
import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "barwise-infer-references-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const SQL = `CREATE TABLE site (site_id INT PRIMARY KEY, name VARCHAR(40));
CREATE TABLE network_device (device_id INT PRIMARY KEY, site_id INT);
`;

function related(yaml: string): boolean {
  const model: OrmModel = new OrmYamlSerializer().deserialize(yaml);
  const ids = ["NetworkDevice", "Site"].map((n) => model.getObjectTypeByName(n)?.id);
  return model.factTypes.some((f) =>
    ids.every((id) => id !== undefined && f.roles.some((r) => r.playerId === id))
  );
}

describe("--infer-references", () => {
  it("reaches the DDL importer through import model --format ddl", async () => {
    const file = join(dir, "schema.sql");
    writeFileSync(file, SQL);
    const without = await runCli(["import", "model", file, "--format", "ddl"]);
    expect(related(without.stdout)).toBe(false);
    const result = await runCli(["import", "model", file, "--format", "ddl", "--infer-references"]);
    expect(result.exitCode).toBe(0);
    expect(related(result.stdout)).toBe(true);
    expect(result.stderr).toContain(`is read as a reference to "site" by its name`);
  });

  it("reaches it through import sql on a file and on a directory", async () => {
    const file = join(dir, "schema.sql");
    writeFileSync(file, SQL);
    const onFile = await runCli(["import", "sql", file, "--infer-references"]);
    expect(onFile.exitCode).toBe(0);
    expect(related(onFile.stdout)).toBe(true);

    const sub = join(dir, "project");
    mkdirSync(sub);
    writeFileSync(join(sub, "schema.sql"), SQL);
    const onDir = await runCli(["import", "sql", sub, "--infer-references"]);
    expect(onDir.exitCode).toBe(0);
    expect(related(onDir.stdout)).toBe(true);
  });

  it("is refused for a format that does not read it, naming the ones that do", async () => {
    const file = join(dir, "api.json");
    writeFileSync(file, `{"openapi":"3.0.0","info":{"title":"t","version":"1"},"paths":{}}`);
    const result = await runCli([
      "import",
      "model",
      file,
      "--format",
      "openapi",
      "--infer-references",
    ]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("--infer-references applies to --format ddl");
    expect(result.stderr).toContain("barwise import sql");
  });
});
