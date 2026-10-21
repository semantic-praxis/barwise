/**
 * Tests for the migrate command (orm-format-3 WS4b-iii): one per
 * requirement in the spec, each through runCli.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** A 2.0 file: one identifier the reader keeps, one flag it drops. */
const V20 = `orm_version: "2.0"
model:
  name: Shop
  object_types:
    - { id: ot-c, name: Customer, kind: entity, reference_mode: nr }
    - { id: ot-nr, name: CustomerNr, kind: value }
    - { id: ot-n, name: Name, kind: value }
  fact_types:
    - id: ft-nr
      name: Customer has CustomerNr
      roles:
        - { id: r-c, player: ot-c, role_name: has }
        - { id: r-nr, player: ot-nr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-nr, type: internal_uniqueness, roles: [r-nr], is_preferred: true }
    - id: ft-n
      name: Customer has Name
      roles:
        - { id: r-cn, player: ot-c, role_name: has }
        - { id: r-n, player: ot-n, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: u-cn, type: internal_uniqueness, roles: [r-cn], is_preferred: true }
`;

describe("barwise migrate", () => {
  let dir: string;
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text, "utf-8");
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-migrate-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("rewrites a 2.0 file in place as 3.0, saying where it came from and what it dropped", async () => {
    const path = file("shop.orm.yaml", V20);
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${path}: 2.0 -> 3.0\n`
        + `  dropped the is_preferred flag on constraint "u-cn" in "Customer has Name": it identifies no entity type\n`,
    );
    const written = readFileSync(path, "utf-8");
    expect(written).toMatch(/^orm_version: "3\.0"/);
    expect(written).toContain("preferred_identifier: u-nr");
    expect(written).not.toContain("is_preferred");
  });

  it("leaves a 3.0 file untouched and says so", async () => {
    const path = file("shop.orm.yaml", V20);
    await runCli(["migrate", path]);
    const once = readFileSync(path, "utf-8");
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${path}: already 3.0\n`);
    expect(readFileSync(path, "utf-8")).toBe(once);
  });

  it("writes nothing under --check, and exits 1 when a file would be rewritten", async () => {
    const path = file("shop.orm.yaml", V20);
    const result = await runCli(["migrate", "--check", path]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`${path}: 2.0 would migrate to 3.0\n`);
    expect(readFileSync(path, "utf-8")).toBe(V20);
  });

  it("exits 0 under --check when every file is current", async () => {
    const path = file("shop.orm.yaml", V20);
    await runCli(["migrate", path]);
    expect((await runCli(["migrate", "--check", path])).exitCode).toBe(0);
  });

  it("reports a file that does not load, goes on with the rest, and exits 2", async () => {
    const broken = file("broken.orm.yaml", 'orm_version: "2.0"\nmodel: {}\n');
    const good = file("shop.orm.yaml", V20);
    const missing = join(dir, "missing.orm.yaml");
    const result = await runCli(["migrate", broken, missing, good]);
    expect(result.exitCode).toBe(2);
    const lines = result.stdout.split("\n");
    expect(lines[0]).toMatch(new RegExp(`^${broken}: YAML does not conform`));
    expect(lines[1]).toBe(`${missing}: File not found: ${missing}`);
    expect(lines[2]).toBe(`${good}: 2.0 -> 3.0`);
    expect(readFileSync(good, "utf-8")).toMatch(/^orm_version: "3\.0"/);
  });

  it("migrates a fragment that names an element it does not define, as validate would load it", async () => {
    const fragment = readFileSync(
      join(__dirname, "../fixtures/fragment-typo-population.orm.yaml"),
      "utf-8",
    );
    const path = file("fragment.orm.yaml", fragment);
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path, "utf-8")).toContain("ft-typo");
  });

  it("refuses a 2.0 file whose rewrite would not load, and leaves it untouched", async () => {
    // 2.0 accepted two constraints sharing an id; 3.0 refuses them.
    const twice = V20.replace("id: u-cn,", "id: u-nr,");
    const path = file("twice.orm.yaml", twice);
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toBe(
      `${path}: Two constraints share the id "u-nr"; a constraint id names one constraint.\n`,
    );
    expect(readFileSync(path, "utf-8")).toBe(twice);
  });

  it("refuses a fragment whose flag names an object type it does not define", async () => {
    // Customer is defined in the file this fragment merges into.
    const fragment = V20.replace(
      "    - { id: ot-c, name: Customer, kind: entity, reference_mode: nr }\n",
      "",
    );
    const path = file("fragment.orm.yaml", fragment);
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain(
      `the is_preferred flag on constraint "u-nr" in "Customer has CustomerNr" names an object type this file does not define`,
    );
    expect(readFileSync(path, "utf-8")).toBe(fragment);
  });

  it("refuses an unknown --format before touching any file", async () => {
    const path = file("shop.orm.yaml", V20);
    const result = await runCli(["migrate", "--format", "jsno", path]);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain(`unknown --format "jsno"`);
    expect(readFileSync(path, "utf-8")).toBe(V20);
  });

  it("prints one record per file with --format json", async () => {
    const path = file("shop.orm.yaml", V20);
    const result = await runCli(["migrate", "--format", "json", path]);
    expect(JSON.parse(result.stdout)).toEqual([{
      file: path,
      status: "migrated",
      from: "2.0",
      notes: [{ kind: "flag-dropped", factType: "Customer has Name", constraintId: "u-cn" }],
    }]);
  });
});
