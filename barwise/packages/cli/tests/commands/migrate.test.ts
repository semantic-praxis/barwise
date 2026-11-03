/**
 * Tests for the migrate command (orm-format-3 WS4b-iii): one per
 * requirement in the spec, each through runCli.
 */
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  it("rewrites a 2.0 file in place as 4.0, saying where it came from and what it dropped [adr:schema-versioning#load-forward]", async () => {
    const path = file("shop.orm.yaml", V20);
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(
      `${path}: 2.0 -> 4.0\n`
        + `  dropped the is_preferred flag on constraint "u-cn" in "Customer has Name": it identifies no entity type\n`,
    );
    const written = readFileSync(path, "utf-8");
    expect(written).toMatch(/^orm_version: "4\.0"/);
    // Replayed into 4.0's ids: the identifier the flag kept, by its minted name.
    expect(written).toContain(
      "preferred_identifier: For_each_CustomerNr,_at_most_one_Customer_has_that_CustomerNr",
    );
    expect(written).not.toContain("is_preferred");
  });

  it("leaves a 4.0 file untouched and says so", async () => {
    const path = file("shop.orm.yaml", V20);
    await runCli(["migrate", path]);
    const once = readFileSync(path, "utf-8");
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(`${path}: already 4.0\n`);
    expect(readFileSync(path, "utf-8")).toBe(once);
  });

  it("writes nothing under --check, and exits 1 when a file would be rewritten", async () => {
    const path = file("shop.orm.yaml", V20);
    const result = await runCli(["migrate", "--check", path]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`${path}: 2.0 would migrate to 4.0\n`);
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
    expect(lines[2]).toBe(`${good}: 2.0 -> 4.0`);
    expect(readFileSync(good, "utf-8")).toMatch(/^orm_version: "4\.0"/);
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

  it("migrates a 2.0 file holding one constraint id twice, naming each apart", async () => {
    // 2.0 accepted two constraints sharing an id, and 3.0 refused them, so
    // this file used to stay unmigrated. The replay into 4.0 names every
    // constraint from its sentence, so the repeat does not survive it.
    const twice = V20.replace("id: u-cn,", "id: u-nr,");
    const path = file("twice.orm.yaml", twice);
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(0);
    const written = readFileSync(path, "utf-8");
    expect(written).toMatch(/^orm_version: "4\.0"/);
    expect(written).not.toContain("u-nr");
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
      `not migrated: it names elements it does not define ("ot-c") and carries is_preferred flags`,
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

  it("migrates the file a symlink names, keeping the link and the file's mode", async () => {
    const target = file("real.orm.yaml", V20);
    // Group-writable, which a creation mode under umask 022 would lose.
    chmodSync(target, 0o664);
    const link = join(dir, "link.orm.yaml");
    symlinkSync(target, link);
    const result = await runCli(["migrate", link]);
    expect(result.exitCode).toBe(0);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(target, "utf-8")).toMatch(/^orm_version: "4\.0"/);
    expect(statSync(target).mode & 0o777).toBe(0o664);
    expect(existsSync(`${target}.migrating`)).toBe(false);
  });

  it("leaves a staged file from an interrupted run alone, refusing that file with exit 2", async () => {
    const path = file("shop.orm.yaml", V20);
    const stale = file("shop.orm.yaml.migrating", "left by a killed run\n");
    const result = await runCli(["migrate", path]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("A staged file already exists beside");
    expect(readFileSync(path, "utf-8")).toBe(V20);
    expect(readFileSync(stale, "utf-8")).toBe("left by a killed run\n");
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

  describe("a current file whose load mints ids (iri-identity decision 17)", () => {
    const TYPED = `orm_version: "4.0"
model:
  name: M
  object_types:
    - { id: Person, name: Person, kind: entity, reference_mode: nr }
  fact_types:
    - id: Person_smokes
      name: Person smokes
      roles:
        - { id: Person_smokes.smokes, player: Person, role_name: smokes }
      readings: ["{0} smokes"]
      constraints:
        # typed without an id
        - { type: mandatory, role: Person_smokes.smokes }
`;

    it("is written with those ids, its comments kept, and is current afterwards", async () => {
      const path = file("m.orm.yaml", TYPED);
      const result = await runCli(["migrate", path]);
      expect([result.exitCode, result.stdout]).toEqual([
        0,
        `${path}: 4.0 -> 4.0\n  stored "Each_Person_smokes", which the file did not state\n`,
      ]);
      const written = readFileSync(path, "utf-8");
      expect(written).toContain("# typed without an id");
      expect(written).toContain("id: Each_Person_smokes");
      expect(written).toContain("minted_from:");
      expect((await runCli(["migrate", path])).stdout).toBe(`${path}: already 4.0\n`);
    });

    it("is reported, not written, under --check, which exits 1", async () => {
      const path = file("m.orm.yaml", TYPED);
      const result = await runCli(["migrate", "--check", "--format", "json", path]);
      expect(result.exitCode).toBe(1);
      expect(JSON.parse(result.stdout)).toEqual([{
        file: path,
        status: "would-migrate",
        from: "4.0",
        notes: [],
        stored: ["Each_Person_smokes"],
      }]);
      expect(readFileSync(path, "utf-8")).toBe(TYPED);
    });
  });

  describe("a project (iri-identity WS6)", () => {
    // In sales, "Order Line" takes a suffixed id, because "Order_Line"
    // came first with the same local name; billing's shadow of it cannot
    // see that from its own file.
    const SALES = `orm_version: "3.0"
model:
  name: sales
  domain_context: sales
  object_types:
    - { id: u1, name: Order_Line, kind: entity, reference_mode: nr }
    - { id: u2, name: Order Line, kind: entity, reference_mode: nr }
`;
    const BILLING = `orm_version: "3.0"
model:
  name: billing
  domain_context: billing
  object_types:
    - { id: s1, name: Order Line, kind: entity, reference_mode: nr, source_context: sales }
`;
    const manifest = () =>
      file(
        "shop.orm-project.yaml",
        `format_version: "1.0"
project:
  name: Shop
  domains:
    - { path: sales.orm.yaml, context: sales }
    - { path: billing.orm.yaml, context: billing }
`,
      );

    it("migrates every domain, and a shadow names the id its owner's domain gave", async () => {
      file("sales.orm.yaml", SALES);
      file("billing.orm.yaml", BILLING);
      const result = await runCli(["migrate", manifest()]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout).toBe(
        `${join(dir, "sales.orm.yaml")}: 3.0 -> 4.0\n${
          join(dir, "billing.orm.yaml")
        }: 3.0 -> 4.0\n`,
      );
      expect(readFileSync(join(dir, "sales.orm.yaml"), "utf-8")).toContain("id: Order_Line_2");
      expect(readFileSync(join(dir, "billing.orm.yaml"), "utf-8")).toContain(
        "id: sales:Order_Line_2",
      );
    });

    it("settles a domain whose shadows of both owners collide when read alone", async () => {
      // Found by 6b-3a's pr-review: alone, both shadows take
      // "sales:Order_Line" and the read refuses the file, so the project
      // must retry it with the owners' ids known rather than refuse it.
      file("sales.orm.yaml", SALES);
      const both =
        `${BILLING}    - { id: s2, name: Order_Line, kind: entity, reference_mode: nr, source_context: sales }
`;
      const billing = file("billing.orm.yaml", both);
      expect((await runCli(["migrate", "--check", billing])).exitCode).toBe(2);
      const result = await runCli(["migrate", manifest()]);
      expect([result.exitCode, result.stdout]).toEqual([
        0,
        `${join(dir, "sales.orm.yaml")}: 3.0 -> 4.0\n${billing}: 3.0 -> 4.0\n`,
      ]);
      const written = readFileSync(billing, "utf-8");
      expect(written).toContain("id: sales:Order_Line_2\n");
      expect(written).toContain("id: sales:Order_Line\n");
    });

    it("migrates a domain named beside its manifest through the manifest only", async () => {
      file("sales.orm.yaml", SALES);
      const billing = file("billing.orm.yaml", BILLING);
      const result = await runCli(["migrate", billing, manifest()]);
      expect(result.exitCode).toBe(0);
      expect(result.stdout.split(billing).length - 1).toBe(1);
      expect(readFileSync(billing, "utf-8")).toContain("id: sales:Order_Line_2");
    });

    it("gives the shadow the unsuffixed id when its file is migrated alone", async () => {
      // The case the project form exists for: alone, the shadow names
      // whichever owner holds the unsuffixed local name.
      const path = file("billing.orm.yaml", BILLING);
      await runCli(["migrate", path]);
      expect(readFileSync(path, "utf-8")).toContain("id: sales:Order_Line\n");
    });

    it("writes no domain when one is refused, and exits 2", async () => {
      file("sales.orm.yaml", SALES);
      file("billing.orm.yaml", "not: [a model");
      const result = await runCli(["migrate", manifest()]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain(
        `${join(dir, "sales.orm.yaml")}: not migrated: another domain of the project was refused`,
      );
      expect(readFileSync(join(dir, "sales.orm.yaml"), "utf-8")).toBe(SALES);
    });

    it("reports a current domain as current when another domain is refused", async () => {
      file("sales.orm.yaml", SALES);
      await runCli(["migrate", join(dir, "sales.orm.yaml")]);
      file("billing.orm.yaml", "not: [a model");
      const result = await runCli(["migrate", manifest()]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain(`${join(dir, "sales.orm.yaml")}: already 4.0\n`);
    });

    it("reports a manifest that does not load, and exits 2", async () => {
      const path = file("bad.orm-project.yaml", "project: [");
      const result = await runCli(["migrate", path]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toMatch(
        new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: `),
      );
    });
  });
});
