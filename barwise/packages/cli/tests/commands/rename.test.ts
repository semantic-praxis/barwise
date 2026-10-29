/**
 * Tests for `barwise rename` (iri-identity WS5b): the two forms, the
 * `--check` and json contract and exit codes as `migrate`'s, the
 * `domain_context` warning, the refusals, and the staged write.
 */
import { OrmYamlSerializer } from "@barwise/core";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PartialWriteError, writeFilesAtomically } from "../../src/workspace/stagedWrite.js";
import { runCli } from "../workspace/run.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_FIXTURE = join(__dirname, "../fixtures/project");

/**
 * The project fixture is format 1.0, shared with tests that read it as it
 * is, and rename refuses a file that is not current (it would rewrite the
 * format silently). So the copy is migrated first, as a user would.
 */
function migrateDomains(project: string): void {
  const domains = join(project, "domains");
  for (const name of readdirSync(domains)) {
    const path = join(domains, name);
    const { model } = new OrmYamlSerializer().migrate(readFileSync(path, "utf-8"), {
      lenient: true,
    });
    writeFileSync(path, new OrmYamlSerializer().serialize(model), "utf-8");
  }
}

const MODEL = `orm_version: "3.0"
model:
  name: Shop
  object_types:
    - { id: ot-c, name: Customer, kind: entity, reference_mode: customer_nr }
    - { id: ot-o, name: Order, kind: entity, reference_mode: order_nr }
  fact_types:
    - id: ft-places
      name: Customer places Order
      roles:
        - { id: r1, player: ot-c, role_name: places }
        - { id: r2, player: ot-o, role_name: placed by }
      readings: ["{0} places {1}"]
`;

describe("barwise rename", () => {
  let dir: string;
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text, "utf-8");
    return path;
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-rename-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("renames an object type in a model file and says what it wrote", async () => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli(["rename", path, "--object-type", "Order", "--to", "Purchase"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Renamed object type "Order" to "Purchase".`);
    expect(result.stdout).toContain(`Wrote 1 file(s): ${path}`);
    expect(readFileSync(path, "utf-8")).toContain("name: Purchase");
    expect(readdirSync(dir)).toEqual(["shop.orm.yaml"]);
  });

  it("renames a role by its position", async () => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli([
      "rename",
      path,
      "--fact-type",
      "Customer places Order",
      "--role-position",
      "1",
      "--to",
      "is placed by",
    ]);
    expect(result.exitCode).toBe(0);
    expect(readFileSync(path, "utf-8")).toContain("role_name: is placed by");
  });

  it("writes nothing under --check and exits 1, as migrate --check does", async () => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli([
      "rename",
      path,
      "--object-type",
      "Order",
      "--to",
      "Purchase",
      "--check",
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain(`Would write 1 file(s): ${path}`);
    expect(readFileSync(path, "utf-8")).toBe(MODEL);
  });

  it("reports as json", async () => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli([
      "rename",
      path,
      "--object-type",
      "Order",
      "--to",
      "Purchase",
      "--check",
      "--format",
      "json",
    ]);
    expect(JSON.parse(result.stdout)).toEqual({
      status: "would-rename",
      files: [path],
      changes: [`Renamed object type "Order" to "Purchase".`],
      warnings: [],
    });
  });

  it("warns, without refusing, when the file declares a domain_context", async () => {
    const path = file(
      "shop.orm.yaml",
      MODEL.replace("  name: Shop\n", "  name: Shop\n  domain_context: sales\n"),
    );
    const result = await runCli(["rename", path, "--object-type", "Order", "--to", "Purchase"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`Warning: ${path} declares domain "sales".`);
  });

  it.each([
    [
      ["--object-type", "Order", "--fact-type", "Customer places Order"],
      /exactly one of --object-type or --fact-type/,
    ],
    [["--role", "places"], /A role is named with --fact-type/],
    [["--domain", "crm", "--object-type", "Order"], /--project and --domain go together/],
    [["--object-type", "Nobody"], /No object type named "Nobody"/],
    [
      ["--object-type", "Order", "--fact-type", "x", "--role", "a", "--role-position", "0"],
      /not both/,
    ],
  ])("refuses %j with exit 2, naming the reason", async (args, reason) => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli(["rename", path, ...args, "--to", "Purchase"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toMatch(reason);
    expect(readFileSync(path, "utf-8")).toBe(MODEL);
  });

  it("refuses a 2.x file rather than migrating it silently, writing nothing", async () => {
    const old = MODEL.replace(`orm_version: "3.0"`, `orm_version: "2.0"`);
    const path = file("shop.orm.yaml", old);
    const result = await runCli(["rename", path, "--object-type", "Order", "--to", "Purchase"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("is format 2.0. Run `barwise migrate` on it first");
    expect(readFileSync(path, "utf-8")).toBe(old);
  });

  it("refuses a missing --to with exit 2, not commander's 1", async () => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli(["rename", path, "--object-type", "Order"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--to is required.");
  });

  it.each(["-1", "0x1", "1.5", "one"])("refuses --role-position %j", async (position) => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli([
      "rename",
      path,
      "--fact-type",
      "Customer places Order",
      `--role-position=${position}`,
      "--to",
      "x",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("--role-position must be a whole number from 0");
    expect(readFileSync(path, "utf-8")).toBe(MODEL);
  });

  it("points a project manifest given as the file at --project", async () => {
    const path = file("p.orm-project.yaml", 'format_version: "1.0"\n');
    const result = await runCli(["rename", path, "--object-type", "Order", "--to", "X"]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("is a project. Rename through it with --project and --domain.");
  });

  it("refuses a model file and --project together", async () => {
    const path = file("shop.orm.yaml", MODEL);
    const result = await runCli([
      "rename",
      path,
      "--project",
      "p.orm-project.yaml",
      "--domain",
      "crm",
      "--object-type",
      "Order",
      "--to",
      "X",
    ]);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Name a model file or --project, not both.");
  });

  describe("--project", () => {
    let project: string;
    beforeEach(() => {
      project = join(dir, "project");
      cpSync(PROJECT_FIXTURE, project, { recursive: true });
      migrateDomains(project);
    });

    it("renames through the project and writes exactly the files that name the element", async () => {
      const manifest = join(project, "project.orm-project.yaml");
      const billingBefore = readFileSync(join(project, "domains/billing.orm.yaml"), "utf-8");
      const result = await runCli([
        "rename",
        "--project",
        manifest,
        "--domain",
        "crm",
        "--object-type",
        "Customer",
        "--to",
        "Client",
      ]);
      expect(result.exitCode).toBe(0);
      expect(readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8")).toContain(
        "name: Client",
      );
      const mapping = readFileSync(join(project, "mappings/crm-billing.map.yaml"), "utf-8");
      expect(mapping).toContain("source_object_type: Client");
      // The target side names billing's own Account, not a shadow of Customer.
      expect(mapping).toContain("target_object_type: Account");
      expect(readFileSync(join(project, "domains/billing.orm.yaml"), "utf-8")).toBe(billingBefore);
      expect(result.stdout).toContain("Wrote 2 file(s)");
    });

    it("refuses when any domain is not the current format, not only the one renamed", async () => {
      const billing = join(project, "domains/billing.orm.yaml");
      writeFileSync(billing, readFileSync(join(PROJECT_FIXTURE, "domains/billing.orm.yaml")));
      const crmBefore = readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8");
      const result = await runCli([
        "rename",
        "--project",
        join(project, "project.orm-project.yaml"),
        "--domain",
        "crm",
        "--object-type",
        "Customer",
        "--to",
        "Client",
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("billing.orm.yaml is format 1.0");
      expect(readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8")).toBe(crmBefore);
    });

    it("refuses a project whose load reported a problem, writing nothing", async () => {
      const manifest = join(project, "missing-domain.orm-project.yaml");
      const result = await runCli([
        "rename",
        "--project",
        manifest,
        "--domain",
        "crm",
        "--object-type",
        "Customer",
        "--to",
        "Client",
      ]);
      expect(result.exitCode).toBe(2);
      expect(result.stdout).toContain("did not load cleanly");
      expect(readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8")).not.toContain(
        "Client",
      );
    });
  });

  describe("the staged write", () => {
    it("changes nothing when a later file cannot be resolved", () => {
      const first = file("a.orm.yaml", "before\n");
      const missing = join(dir, "no-such-dir", "b.orm.yaml");
      expect(() =>
        writeFilesAtomically([
          { path: first, text: "after\n" },
          { path: missing, text: "after\n" },
        ])
      ).toThrow();
      expect(readFileSync(first, "utf-8")).toBe("before\n");
      expect(existsSync(`${first}.barwise-staged`)).toBe(false);
    });

    it("replaces every file once all are staged", () => {
      const a = file("a.orm.yaml", "a0\n");
      const b = file("b.orm.yaml", "b0\n");
      writeFilesAtomically([{ path: a, text: "a1\n" }, { path: b, text: "b1\n" }]);
      expect([readFileSync(a, "utf-8"), readFileSync(b, "utf-8")]).toEqual(["a1\n", "b1\n"]);
      expect(readdirSync(dir).sort()).toEqual(["a.orm.yaml", "b.orm.yaml"]);
    });

    it("refuses two writes that name one file, writing nothing", () => {
      const a = file("a.orm.yaml", "a0\n");
      expect(() =>
        writeFilesAtomically([{ path: a, text: "a1\n" }, {
          path: join(dir, ".", "a.orm.yaml"),
          text: "a2\n",
        }])
      ).toThrow(/Two writes name one file/);
      expect(readFileSync(a, "utf-8")).toBe("a0\n");
      expect(readdirSync(dir)).toEqual(["a.orm.yaml"]);
    });

    it("leaves a staged file it did not create alone, writing nothing", () => {
      const a = file("a.orm.yaml", "a0\n");
      const b = file("b.orm.yaml", "b0\n");
      file("b.orm.yaml.barwise-staged", "someone else's\n");
      expect(() => writeFilesAtomically([{ path: a, text: "a1\n" }, { path: b, text: "b1\n" }]))
        .toThrow(/A staged file already exists beside .*b\.orm\.yaml/);
      expect(readFileSync(a, "utf-8")).toBe("a0\n");
      expect(readFileSync(b, "utf-8")).toBe("b0\n");
      expect(readFileSync(join(dir, "b.orm.yaml.barwise-staged"), "utf-8")).toBe(
        "someone else's\n",
      );
      expect(existsSync(join(dir, "a.orm.yaml.barwise-staged"))).toBe(false);
    });

    it("names the files it replaced when a rename fails part-way", () => {
      const a = file("a.orm.yaml", "a0\n");
      // Named through a symlink, so the given path and the real one differ.
      const link = join(dir, "link.orm.yaml");
      symlinkSync(a, link);
      // A non-empty directory stages (its temp is a file beside it) but
      // cannot be renamed over, so the second replacement fails.
      const blocked = join(dir, "blocked");
      mkdirSync(blocked);
      writeFileSync(join(blocked, "keep"), "x", "utf-8");
      let caught: unknown;
      try {
        writeFilesAtomically([{ path: link, text: "a1\n" }, { path: blocked, text: "b1\n" }]);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(PartialWriteError);
      // As given, not resolved, so a report names the file the user named.
      expect((caught as PartialWriteError).replaced).toEqual([link]);
      expect(readFileSync(a, "utf-8")).toBe("a1\n");
    });
  });
});
