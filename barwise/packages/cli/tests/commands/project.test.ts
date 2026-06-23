/**
 * Tests for the `barwise project` command group: init and split.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runCli } from "../workspace/run.js";

/** A small two-entity model with one cross-domain fact type. */
const SHOP_MODEL = `orm_version: "1.0"
model:
  name: shop
  object_types:
    - { id: ot-customer, name: Customer, kind: entity, reference_mode: customer_id }
    - { id: ot-email, name: Email, kind: value }
    - { id: ot-invoice, name: Invoice, kind: entity, reference_mode: invoice_id }
    - { id: ot-amount, name: Amount, kind: value }
  fact_types:
    - id: ft-cust-email
      name: Customer has Email
      roles:
        - { id: r1, player: ot-customer, role_name: has }
        - { id: r2, player: ot-email, role_name: of }
      readings: ["{0} has {1}"]
    - id: ft-inv-amount
      name: Invoice has Amount
      roles:
        - { id: r3, player: ot-invoice, role_name: has }
        - { id: r4, player: ot-amount, role_name: of }
      readings: ["{0} has {1}"]
    - id: ft-cust-invoice
      name: Customer pays Invoice
      roles:
        - { id: r5, player: ot-customer, role_name: pays }
        - { id: r6, player: ot-invoice, role_name: paid-by }
      readings: ["{0} pays {1}"]
`;

const SPLIT_CONFIG = `projectName: "Shop"
domains:
  crm:
    - Customer
  billing:
    - Invoice
`;

describe("barwise project init", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "barwise-cli-project-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("creates a manifest and the standard directory layout", async () => {
    const dir = makeTmpDir();
    const result = await runCli(["project", "init", "Warehouse", "--dir", dir]);

    expect(result.exitCode).toBe(0);
    expect(existsSync(join(dir, "warehouse.orm-project.yaml"))).toBe(true);
    expect(existsSync(join(dir, "domains"))).toBe(true);
    expect(existsSync(join(dir, "mappings"))).toBe(true);
  });

  it("refuses to overwrite an existing manifest", async () => {
    const dir = makeTmpDir();
    await runCli(["project", "init", "Warehouse", "--dir", dir]);
    const result = await runCli(["project", "init", "Warehouse", "--dir", dir]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("already exists");
  });
});

describe("barwise project split", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  function makeTmpDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "barwise-cli-split-"));
    tmpDirs.push(dir);
    return dir;
  }

  it("splits a model into a project that validates with no errors", async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "shop.orm.yaml"), SHOP_MODEL, "utf-8");
    writeFileSync(join(dir, "split.yaml"), SPLIT_CONFIG, "utf-8");
    const out = join(dir, "project");

    const split = await runCli([
      "project",
      "split",
      join(dir, "shop.orm.yaml"),
      "--config",
      join(dir, "split.yaml"),
      "--out",
      out,
    ]);
    expect(split.exitCode).toBe(0);

    const manifest = join(out, "project.orm-project.yaml");
    expect(existsSync(manifest)).toBe(true);
    expect(existsSync(join(out, "domains/crm.orm.yaml"))).toBe(true);
    expect(existsSync(join(out, "domains/billing.orm.yaml"))).toBe(true);

    const validate = await runCli(["validate", manifest]);
    expect(validate.stdout).toContain("0 error");
    expect(validate.exitCode).toBe(0);
  }, 15000);

  it("errors when no --config is given", async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "shop.orm.yaml"), SHOP_MODEL, "utf-8");
    const result = await runCli([
      "project",
      "split",
      join(dir, "shop.orm.yaml"),
    ]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("--config");
  });

  it("prints a starter config with --scaffold-config", async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "shop.orm.yaml"), SHOP_MODEL, "utf-8");
    const result = await runCli([
      "project",
      "split",
      join(dir, "shop.orm.yaml"),
      "--scaffold-config",
      "--domains",
      "crm,billing",
    ]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("projectName:");
    expect(result.stdout).toContain("crm:");
    expect(result.stdout).toContain("Customer");
  });

  it("does not overwrite an existing manifest without --force", async () => {
    const dir = makeTmpDir();
    writeFileSync(join(dir, "shop.orm.yaml"), SHOP_MODEL, "utf-8");
    writeFileSync(join(dir, "split.yaml"), SPLIT_CONFIG, "utf-8");
    const out = join(dir, "project");
    const args = [
      "project",
      "split",
      join(dir, "shop.orm.yaml"),
      "--config",
      join(dir, "split.yaml"),
      "--out",
      out,
    ];

    expect((await runCli(args)).exitCode).toBe(0);
    const second = await runCli(args);
    expect(second.exitCode).toBe(1);
    expect(second.stderr).toContain("already exists");

    const forced = await runCli([...args, "--force"]);
    expect(forced.exitCode).toBe(0);
    // The manifest is still the project manifest after a forced rewrite.
    expect(readFileSync(join(out, "project.orm-project.yaml"), "utf-8"))
      .toContain("Shop");
  }, 15000);
});
