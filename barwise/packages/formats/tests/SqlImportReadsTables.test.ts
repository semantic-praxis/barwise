/**
 * `import sql` builds entities from the tables the input declares, and
 * refuses a dialect it does not support (sql-import-reads-tables.spec.md,
 * R4 and R5, barwise-jjd). It built them from foreign-key targets, so
 * every table nothing referenced was dropped silently, and it accepted any
 * dialect.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SqlImportFormat } from "../src/sql/SqlImportFormat.js";

const sql = new SqlImportFormat();
const entities = (model: { objectTypes: readonly { kind: string; name: string; }[]; }) =>
  model.objectTypes.filter((o) => o.kind === "entity").map((o) => o.name).sort();

/** The enterprise trial's reproduction (barwise-jjd), moved here when the issue closed. */
const JJD = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "fixtures/sql-import-reads-tables.sql"),
  "utf8",
);

describe("R4: tables come from the CREATE TABLEs the input declares", () => {
  it("imports all three tables of the reproduction, not only the foreign-key target", () => {
    expect(entities(sql.parse(JJD, { dialect: "postgres" }).model)).toEqual([
      "AuditLog",
      "Customers",
      "Orders",
    ]);
  });

  it("names a table the SQL mentions but never declares, rather than inventing it", () => {
    const input = `
      CREATE TABLE orders (order_id INT NOT NULL, PRIMARY KEY (order_id));
      SELECT o.order_id FROM orders o JOIN shipments s ON s.order_id = o.order_id;`;
    const { model, warnings } = sql.parse(input);
    expect(entities(model)).toEqual(["Orders"]);
    expect(warnings.some((w) => /never declares/.test(w) && w.includes("shipments"))).toBe(true);
  });

  it("reads declared tables across the files of a directory", async () => {
    const dir = join(tmpdir(), `barwise-sql-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    try {
      writeFileSync(
        join(dir, "a.sql"),
        "CREATE TABLE customers (customer_id INT, PRIMARY KEY (customer_id));",
      );
      writeFileSync(
        join(dir, "b.sql"),
        "CREATE TABLE orders (order_id INT, customer_id INT, PRIMARY KEY (order_id), "
          + "FOREIGN KEY (customer_id) REFERENCES customers (customer_id));",
      );
      const { model } = await sql.parseAsync(dir);
      expect(entities(model)).toEqual(["Customers", "Orders"]);
      expect(model.factTypes.some((f) => /Orders/.test(f.name) && /Customers/.test(f.name))).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("keeps pattern mining for input that declares no table", () => {
    // Unchanged path: the mined tables become entities, as before.
    const input = "SELECT * FROM orders o JOIN customers c ON c.customer_id = o.customer_id;";
    const { model, warnings } = sql.parse(input);
    expect(entities(model)).toContain("Customers");
    expect(warnings.some((w) => /never declares/.test(w))).toBe(false);
  });
});

describe("R5: an unsupported dialect is refused, the way export refuses one", () => {
  it.each(["oracle", "db2", "sqlserver"])("refuses %s, naming the supported ones", (dialect) => {
    expect(() => sql.parse(JJD, { dialect })).toThrow(
      new RegExp(`"${dialect}" is not supported.*postgres`),
    );
  });

  it("refuses it for a directory too", async () => {
    await expect(sql.parseAsync(tmpdir(), { dialect: "oracle" })).rejects.toThrow(/not supported/);
  });
});
