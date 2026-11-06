/**
 * Tests for the SQL cascade parser.
 *
 * Verifies that the cascade orchestrator correctly splits SQL files
 * into statements and extracts patterns from each.
 */
import { describe, expect, it } from "vitest";
import {
  detectStatementType,
  parseSqlFile,
  parseSqlStatement,
} from "../src/sql/SqlCascadeParser.js";

describe("parseSqlFile", () => {
  it("parses a file with multiple CREATE TABLE statements", () => {
    const sql = `
CREATE TABLE customers (
  id INT NOT NULL,
  name VARCHAR(100),
  UNIQUE(id)
);

CREATE TABLE orders (
  id INT NOT NULL,
  customer_id INT,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);
`;
    const result = parseSqlFile(sql, "schema.sql");

    expect(result.filePath).toBe("schema.sql");
    expect(result.dialect).toBe("ansi");
    expect(result.statements.length).toBeGreaterThanOrEqual(2);
    expect(result.patterns.length).toBeGreaterThan(0);

    // Should find NOT NULL patterns
    const notNulls = result.patterns.filter((p) => p.kind === "not_null");
    expect(notNulls.length).toBeGreaterThanOrEqual(2);

    // Should find FOREIGN KEY
    const fks = result.patterns.filter((p) => p.kind === "foreign_key");
    expect(fks).toHaveLength(1);
  });

  it("parses a file with SELECT queries", () => {
    const sql = `
SELECT o.id, c.name
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status IN ('active', 'pending')
GROUP BY c.name;
`;
    const result = parseSqlFile(sql, "query.sql");

    expect(result.patterns.length).toBeGreaterThan(0);

    // Should find JOIN
    const joins = result.patterns.filter((p) => p.kind === "join");
    expect(joins.length).toBeGreaterThanOrEqual(1);

    // Should find WHERE with IN
    const wheres = result.patterns.filter(
      (p) => p.kind === "where" && p.details?.predicateType === "in",
    );
    expect(wheres).toHaveLength(1);
  });

  it("returns empty patterns for non-SQL content", () => {
    const result = parseSqlFile("-- just a comment", "empty.sql");
    expect(result.patterns).toHaveLength(0);
  });

  it("uses the specified dialect", () => {
    const result = parseSqlFile("SELECT 1", "test.sql", "snowflake");
    expect(result.dialect).toBe("snowflake");
  });
});

describe("parseSqlStatement", () => {
  it("extracts patterns from a single statement", () => {
    const sql =
      "SELECT * FROM orders JOIN customers ON orders.cid = customers.id WHERE orders.status = 'active'";
    const result = parseSqlStatement(sql, "test.sql", 1);

    expect(result.parseLevel).toBe("regex");
    expect(result.errors).toHaveLength(0);
    expect(result.patterns.length).toBeGreaterThan(0);
  });
});

describe("detectStatementType", () => {
  it("detects SELECT", () => {
    expect(detectStatementType("SELECT * FROM foo")).toBe("select");
  });

  it("detects WITH (CTE) as select", () => {
    expect(detectStatementType("WITH cte AS (SELECT 1) SELECT * FROM cte")).toBe("select");
  });

  it("detects CREATE", () => {
    expect(detectStatementType("CREATE TABLE foo (id INT)")).toBe("create");
  });

  it("detects ALTER", () => {
    expect(detectStatementType("ALTER TABLE foo ADD col INT")).toBe("alter");
  });

  it("detects INSERT", () => {
    expect(detectStatementType("INSERT INTO foo VALUES (1)")).toBe("insert");
  });

  it("detects UPDATE", () => {
    expect(detectStatementType("UPDATE foo SET col = 1")).toBe("update");
  });

  it("detects DELETE", () => {
    expect(detectStatementType("DELETE FROM foo")).toBe("delete");
  });

  it("returns other for unknown", () => {
    expect(detectStatementType("GRANT ALL ON foo")).toBe("other");
  });
});
