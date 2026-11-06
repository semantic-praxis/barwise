/**
 * Tests for the SQL pattern extractor.
 *
 * Verifies regex-based extraction of ORM-relevant patterns from SQL
 * statements: JOINs, WHERE predicates, CASE branches, CHECK constraints,
 * UNIQUE, NOT NULL, FOREIGN KEY, DEFAULT, and GROUP BY.
 */
import { describe, expect, it } from "vitest";
import { extractSqlPatterns, splitSqlStatements } from "../src/sql/SqlPatternExtractor.js";

describe("extractSqlPatterns", () => {
  describe("JOIN extraction", () => {
    it("extracts INNER JOIN with ON condition", () => {
      const sql = "SELECT * FROM orders JOIN customers ON orders.customer_id = customers.id";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const joins = patterns.filter((p) => p.kind === "join");
      expect(joins).toHaveLength(1);
      expect(joins[0]!.tables).toContain("customers");
      expect(joins[0]!.parseLevel).toBe("regex");
    });

    it("extracts LEFT JOIN", () => {
      const sql = "SELECT * FROM orders LEFT JOIN customers c ON orders.customer_id = c.id";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const joins = patterns.filter((p) => p.kind === "join");
      expect(joins).toHaveLength(1);
      expect(joins[0]!.tables).toContain("customers");
    });

    it("extracts multiple JOINs", () => {
      const sql = `SELECT * FROM orders
        JOIN customers ON orders.customer_id = customers.id
        JOIN products ON orders.product_id = products.id`;
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const joins = patterns.filter((p) => p.kind === "join");
      expect(joins.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("WHERE predicate extraction", () => {
    it("extracts IN predicate", () => {
      const sql = "SELECT * FROM orders WHERE status IN ('active', 'pending')";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const wheres = patterns.filter(
        (p) => p.kind === "where" && p.details?.predicateType === "in",
      );
      expect(wheres).toHaveLength(1);
      expect(wheres[0]!.columns).toContain("status");
    });

    it("extracts IS NOT NULL predicate", () => {
      const sql = "SELECT * FROM users WHERE email IS NOT NULL";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const wheres = patterns.filter(
        (p) => p.kind === "where" && p.details?.predicateType === "is_not_null",
      );
      expect(wheres).toHaveLength(1);
      expect(wheres[0]!.columns).toContain("email");
    });

    it("extracts comparison predicate", () => {
      const sql = "SELECT * FROM products WHERE price > 100";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const wheres = patterns.filter(
        (p) => p.kind === "where" && p.details?.predicateType === "comparison",
      );
      expect(wheres).toHaveLength(1);
      expect(wheres[0]!.columns).toContain("price");
    });

    it("extracts BETWEEN predicate", () => {
      const sql = "SELECT * FROM employees WHERE age BETWEEN 18 AND 65";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const wheres = patterns.filter(
        (p) => p.kind === "where" && p.details?.predicateType === "between",
      );
      expect(wheres).toHaveLength(1);
      expect(wheres[0]!.columns).toContain("age");
    });
  });

  describe("CASE branch extraction", () => {
    it("extracts CASE WHEN values", () => {
      const sql = `SELECT CASE status
        WHEN 'active' THEN 1
        WHEN 'inactive' THEN 0
        WHEN 'deleted' THEN -1
        END FROM users`;
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const cases = patterns.filter((p) => p.kind === "case");
      expect(cases).toHaveLength(1);
      expect(cases[0]!.details?.values).toContain("active");
      expect(cases[0]!.details?.values).toContain("inactive");
      expect(cases[0]!.details?.values).toContain("deleted");
    });
  });

  describe("CHECK constraint extraction", () => {
    it("extracts CHECK constraint", () => {
      const sql = "CREATE TABLE orders (status VARCHAR(20) CHECK (status IN ('open', 'closed')))";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const checks = patterns.filter((p) => p.kind === "check");
      expect(checks).toHaveLength(1);
      expect(checks[0]!.columns).toContain("status");
    });
  });

  describe("UNIQUE constraint extraction", () => {
    it("extracts table-level UNIQUE constraint", () => {
      const sql = "CREATE TABLE users (id INT, email VARCHAR(100), UNIQUE(email))";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const uniques = patterns.filter((p) => p.kind === "unique");
      expect(uniques.length).toBeGreaterThanOrEqual(1);
      expect(uniques.some((u) => u.columns?.includes("email"))).toBe(true);
    });
  });

  describe("NOT NULL constraint extraction", () => {
    it("extracts NOT NULL constraint", () => {
      const sql = "CREATE TABLE users (id INT NOT NULL, email VARCHAR(100) NOT NULL)";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const notNulls = patterns.filter((p) => p.kind === "not_null");
      expect(notNulls.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("FOREIGN KEY extraction", () => {
    it("extracts FOREIGN KEY reference", () => {
      const sql = `CREATE TABLE orders (
        id INT PRIMARY KEY,
        customer_id INT,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      )`;
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const fks = patterns.filter((p) => p.kind === "foreign_key");
      expect(fks).toHaveLength(1);
      expect(fks[0]!.tables).toContain("customers");
      expect(fks[0]!.columns).toContain("customer_id");
    });
  });

  describe("GROUP BY extraction", () => {
    it("extracts GROUP BY columns", () => {
      const sql = "SELECT customer_id, COUNT(*) FROM orders GROUP BY customer_id";
      const patterns = extractSqlPatterns(sql, "test.sql", 1);

      const groupBys = patterns.filter((p) => p.kind === "group_by");
      expect(groupBys).toHaveLength(1);
      expect(groupBys[0]!.columns).toContain("customer_id");
    });
  });

  describe("provenance tracking", () => {
    it("tracks file path and line numbers", () => {
      const sql = "SELECT * FROM orders WHERE status = 'active'";
      const patterns = extractSqlPatterns(sql, "models/orders.sql", 10);

      for (const p of patterns) {
        expect(p.filePath).toBe("models/orders.sql");
        expect(p.startLine).toBe(10);
        expect(p.parseLevel).toBe("regex");
      }
    });
  });
});

describe("splitSqlStatements", () => {
  it("splits statements by semicolons", () => {
    const sql = "SELECT 1; SELECT 2; SELECT 3";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(3);
  });

  it("handles last statement without semicolon", () => {
    const sql = "SELECT 1; SELECT 2";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
  });

  it("ignores semicolons in string literals", () => {
    const sql = "SELECT 'hello; world'; SELECT 2";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toContain("hello; world");
  });

  it("ignores semicolons in line comments", () => {
    const sql = "SELECT 1 -- comment; not a delimiter\n; SELECT 2";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
  });

  it("ignores semicolons in block comments", () => {
    const sql = "SELECT 1 /* comment; not a delimiter */; SELECT 2";
    const stmts = splitSqlStatements(sql);
    expect(stmts).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(splitSqlStatements("")).toEqual([]);
    expect(splitSqlStatements("  ")).toEqual([]);
  });

  it("handles single statement", () => {
    const stmts = splitSqlStatements("SELECT 1");
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toBe("SELECT 1");
  });
});
