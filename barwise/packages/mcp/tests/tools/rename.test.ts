/**
 * Tests for the rename_element tool (iri-identity WS5b): inline YAML is
 * returned, a file is written back unless `check`, a project source
 * follows the rename into its other files, and every refusal is an
 * `error` in the result, never a write.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { executeRename } from "../../src/tools/rename.js";

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

const body = (result: ReturnType<typeof executeRename>) => JSON.parse(result.content[0]!.text);

describe("rename_element", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "barwise-mcp-rename-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns the renamed model for inline YAML, writing nothing", () => {
    const result = body(executeRename({ source: MODEL, objectType: "Order", to: "Purchase" }));
    expect(result.yaml).toContain("name: Purchase");
    expect(result.changes).toEqual([`Renamed object type "Order" to "Purchase".`]);
    expect(result.writtenTo).toBeUndefined();
  });

  it("writes a file source back, and writes nothing under check", () => {
    const path = join(dir, "shop.orm.yaml");
    writeFileSync(path, MODEL, "utf-8");

    const checked = body(
      executeRename({ source: path, objectType: "Order", to: "Purchase", check: true }),
    );
    expect(checked).toMatchObject({ written: false, files: [path] });
    expect(readFileSync(path, "utf-8")).toBe(MODEL);

    const written = body(executeRename({ source: path, objectType: "Order", to: "Purchase" }));
    expect(written).toMatchObject({ written: true, writtenTo: [path] });
    expect(readFileSync(path, "utf-8")).toContain("name: Purchase");
  });

  it("renames a role by position", () => {
    const result = body(
      executeRename({
        source: MODEL,
        factType: "Customer places Order",
        rolePosition: 1,
        to: "is placed by",
      }),
    );
    expect(result.yaml).toContain("role_name: is placed by");
  });

  it("warns, without refusing, when the model declares a domain_context", () => {
    const yaml = MODEL.replace("  name: Shop\n", "  name: Shop\n  domain_context: sales\n");
    const result = body(executeRename({ source: yaml, objectType: "Order", to: "Purchase" }));
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(`declares domain "sales"`);
    expect(result.yaml).toContain("name: Purchase");
  });

  it.each([
    [
      { objectType: "Order", factType: "Customer places Order" },
      /exactly one of objectType or factType/,
    ],
    [{ role: "places" }, /A role is named with factType/],
    [{ objectType: "Nobody" }, /No object type named "Nobody"/],
    [{ objectType: "Order", domain: "crm" }, /domain is for a \.orm-project\.yaml source/],
  ])("refuses %j as an error in the result", (args, reason) => {
    const result = body(executeRename({ source: MODEL, to: "Purchase", ...args }));
    expect(result.error).toMatch(reason);
  });

  it("refuses a 2.x file rather than migrating it silently, writing nothing", () => {
    const old = MODEL.replace(`orm_version: "3.0"`, `orm_version: "2.0"`);
    const path = join(dir, "shop.orm.yaml");
    writeFileSync(path, old, "utf-8");
    const result = body(executeRename({ source: path, objectType: "Order", to: "Purchase" }));
    expect(result.error).toContain("is format 2.0. Run `barwise migrate` on it first");
    expect(readFileSync(path, "utf-8")).toBe(old);
  });

  describe("a project source", () => {
    let project: string;
    beforeEach(() => {
      project = join(dir, "project");
      cpSync(PROJECT_FIXTURE, project, { recursive: true });
      migrateDomains(project);
    });

    it("renames through the project and writes the files it changed", () => {
      const manifest = join(project, "project.orm-project.yaml");
      const billingBefore = readFileSync(join(project, "domains/billing.orm.yaml"), "utf-8");
      const result = body(
        executeRename({ source: manifest, domain: "crm", objectType: "Customer", to: "Client" }),
      );
      expect(result.written).toBe(true);
      expect(result.writtenTo).toEqual([join(project, "domains/crm.orm.yaml")]);
      expect(readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8")).toContain(
        "name: Client",
      );
      expect(readFileSync(join(project, "domains/billing.orm.yaml"), "utf-8")).toBe(billingBefore);
    });

    it("needs a domain", () => {
      const manifest = join(project, "project.orm-project.yaml");
      expect(body(executeRename({ source: manifest, objectType: "Customer", to: "Client" })).error)
        .toBe("A project source needs domain.");
    });

    it("refuses when any domain is not the current format, not only the one renamed", () => {
      const billing = join(project, "domains/billing.orm.yaml");
      writeFileSync(billing, readFileSync(join(PROJECT_FIXTURE, "domains/billing.orm.yaml")));
      const crmBefore = readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8");
      const result = body(
        executeRename({
          source: join(project, "project.orm-project.yaml"),
          domain: "crm",
          objectType: "Customer",
          to: "Client",
        }),
      );
      expect(result.error).toContain("billing.orm.yaml is format 1.0");
      expect(readFileSync(join(project, "domains/crm.orm.yaml"), "utf-8")).toBe(crmBefore);
    });

    it("refuses a project whose load reported a problem", () => {
      const manifest = join(project, "broken.orm-project.yaml");
      const result = body(
        executeRename({ source: manifest, domain: "crm", objectType: "Customer", to: "Client" }),
      );
      expect(result.error).toContain("did not load cleanly");
    });
  });
});
