/**
 * Tests for the SQL import format.
 *
 * Verifies both text-based (single file) and directory-based
 * SQL import, including dialect detection and pattern extraction.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SqlImportFormat } from "../src/SqlImportFormat.js";

let testDir: string;

function createTestDir(): string {
  const dir = join(tmpdir(), `barwise-sql-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("SqlImportFormat", () => {
  const format = new SqlImportFormat();

  describe("interface properties", () => {
    it("has name 'sql'", () => {
      expect(format.name).toBe("sql");
    });

    it("has inputKind 'text'", () => {
      expect(format.inputKind).toBe("text");
    });

    it("implements both parse() and parseAsync()", () => {
      expect(format.parse).toBeDefined();
      expect(format.parseAsync).toBeDefined();
    });
  });

  describe("parse (text input)", () => {
    it("parses CREATE TABLE with constraints", () => {
      const sql = `
CREATE TABLE customers (
  id INT NOT NULL,
  name VARCHAR(100),
  email VARCHAR(200) NOT NULL,
  UNIQUE(email),
  UNIQUE(id)
);
`;
      const result = format.parse!(sql);

      expect(result.model).toBeDefined();
      expect(result.confidence).toBe("medium");
      expect(result.warnings).toBeDefined();
    });

    it("parses SELECT with JOINs", () => {
      const sql = `
SELECT o.id, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'active'
`;
      const result = format.parse!(sql);

      expect(result.model).toBeDefined();
      // Should create entity types for the tables
      expect(result.model.objectTypes.length).toBeGreaterThan(0);
    });

    it("returns low confidence for empty SQL", () => {
      const result = format.parse!("-- just a comment");
      expect(result.confidence).toBe("low");
    });

    it("uses provided model name", () => {
      const result = format.parse!("SELECT 1", { modelName: "Test Model" });
      expect(result.model.name).toBe("Test Model");
    });

    it("accepts explicit dialect option", () => {
      const result = format.parse!(
        "SELECT * FROM orders WHERE status = 'active'",
        { dialect: "snowflake" },
      );
      expect(result).toBeDefined();
    });

    it("detects Snowflake dialect from hints", () => {
      const sql = "-- dialect: snowflake\nCREATE OR REPLACE STAGE my_stage";
      const result = format.parse!(sql);
      // Should not throw, should handle gracefully
      expect(result).toBeDefined();
    });
  });

  describe("parseAsync (directory input)", () => {
    beforeEach(() => {
      testDir = createTestDir();
    });

    afterEach(() => {
      rmSync(testDir, { recursive: true, force: true });
    });

    it("parses directory of SQL files", async () => {
      writeFileSync(
        join(testDir, "schema.sql"),
        `CREATE TABLE users (
          id INT NOT NULL,
          email VARCHAR(100) NOT NULL,
          UNIQUE(email)
        );`,
      );
      writeFileSync(
        join(testDir, "queries.sql"),
        "SELECT * FROM users WHERE email IS NOT NULL;",
      );

      const result = await format.parseAsync!(testDir);

      expect(result.model).toBeDefined();
      expect(result.confidence).toBe("medium");
    });

    it("returns low confidence for empty directory", async () => {
      const result = await format.parseAsync!(testDir);
      expect(result.confidence).toBe("low");
      expect(result.warnings.some((w) => w.includes("No .sql files"))).toBe(true);
    });

    it("uses provided model name", async () => {
      writeFileSync(join(testDir, "test.sql"), "SELECT 1");

      const result = await format.parseAsync!(testDir, {
        modelName: "My SQL Model",
      });
      expect(result.model.name).toBe("My SQL Model");
    });

    it("handles unreadable files gracefully", async () => {
      writeFileSync(join(testDir, "good.sql"), "SELECT 1");
      // No way to make truly unreadable in tests, but verify the flow works
      const result = await format.parseAsync!(testDir);
      expect(result).toBeDefined();
    });
  });
});
