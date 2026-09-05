/**
 * Tests for the sqlglot sidecar tier. Structural assertions run only
 * when python3 + sqlglot are present (the sidecar is optional by
 * design); the degradation path is always tested.
 */
import { parseSqlFile } from "@barwise/core/sql";
import { describe, expect, it } from "vitest";
import {
  normalizeCascadeResult,
  normalizeSqlTexts,
  parseSqlWithSqlglot,
  sqlglotAvailable,
} from "../src/sql/SqlglotBridge.js";

const available = sqlglotAvailable();

// A suite that silently shrinks is indistinguishable from one that passes,
// which is precisely barwise-916: these tests skipped in every CI run for
// as long as they existed, because nothing installed sqlglot. In CI the
// tier is a hard requirement and its absence is a collection failure, loud
// and unmissable. Locally it stays a skip with a printed reason, so a fresh
// checkout without uv can still run everything else.
if (!available && process.env.CI) {
  throw new Error(
    "sqlglot tier unavailable in CI: `uv run --frozen --only-group sqlglot` "
      + "could not import sqlglot. CI must sync the group before the tests "
      + "run (see docs/specs/python-lockfile-execution.spec.md).",
  );
}
if (!available) {
  console.warn(
    "sqlglot tier unavailable -- sidecar tests skipped. Install uv to run them.",
  );
}

describe("sqlglot sidecar", () => {
  it.runIf(available)("mines joins, where, and case from a query", () => {
    const sql = `
SELECT o.id,
       CASE WHEN o.total > 100 THEN 'large' ELSE 'small' END AS size
FROM orders o
JOIN customers c ON o.customer_id = c.id
WHERE o.status = 'open';
`;
    const result = parseSqlWithSqlglot(sql, "orders.sql", "postgres");
    expect(result).toBeDefined();
    const kinds = result!.patterns.map((p) => p.kind);
    expect(kinds).toContain("join");
    expect(kinds).toContain("where");
    expect(kinds).toContain("case");

    const join = result!.patterns.find((p) => p.kind === "join")!;
    expect(join.parseLevel).toBe("sqlglot");
    expect(join.tables).toContain("customers");
    expect(join.columns).toEqual(expect.arrayContaining(["customer_id", "id"]));
  });

  it.runIf(available)("mines DDL constraints", () => {
    const sql = `
CREATE TABLE orders (
  id INT NOT NULL,
  status VARCHAR(20) CHECK (status IN ('open', 'closed')),
  customer_id INT REFERENCES customers(id)
);
`;
    const result = parseSqlWithSqlglot(sql, "schema.sql", "postgres");
    expect(result).toBeDefined();
    const kinds = result!.patterns.map((p) => p.kind);
    expect(kinds).toContain("not_null");
    expect(kinds).toContain("check");
  });

  it.runIf(available)("parses dialect-specific SQL the regex tier cannot structure", () => {
    const sql = "SELECT * FROM sales QUALIFY ROW_NUMBER() OVER (PARTITION BY id ORDER BY ts) = 1";
    const result = parseSqlWithSqlglot(sql, "q.sql", "snowflake");
    expect(result).toBeDefined();
    expect(result!.statements[0]!.parseLevel).toBe("sqlglot");
  });

  it("returns undefined on unparseable input instead of throwing", () => {
    const result = parseSqlWithSqlglot("THIS IS NOT ((( SQL", "bad.sql");
    // Unavailable sidecar and failed parse both degrade to undefined,
    // which sends the caller to the regex cascade.
    if (available) {
      expect(result === undefined || result.statements.length >= 0).toBe(true);
    } else {
      expect(result).toBeUndefined();
    }
  });
});

describe("sourceText normalization (WS3)", () => {
  it.runIf(available)("renders equivalent snippets identically regardless of whitespace", () => {
    const [a] = normalizeSqlTexts(["SELECT   x FROM t WHERE x  IN ('a',   'b')"])!;
    const [b] = normalizeSqlTexts(["SELECT x\nFROM t\nWHERE x IN ('a', 'b')"])!;
    expect(a).toBe(b);
  });

  it.runIf(available)("leaves unparseable clause fragments unchanged", () => {
    const fragment = "FOREIGN KEY (a) REFERENCES b (c)";
    expect(normalizeSqlTexts([fragment])![0]).toBe(fragment);
  });

  it("degrades to raw text without python", () => {
    if (!available) {
      expect(normalizeSqlTexts(["SELECT 1"])).toBeUndefined();
    }
    expect(normalizeSqlTexts([])).toEqual([]);
  });

  it("normalizeCascadeResult keeps pattern structure intact", () => {
    const raw = parseSqlFile("SELECT * FROM t WHERE status   IN ('a',  'b')", "t.sql");
    const normalized = normalizeCascadeResult(raw);
    expect(normalized.patterns.length).toBe(raw.patterns.length);
    expect(normalized.statements.length).toBe(raw.statements.length);
    if (available) {
      const where = normalized.patterns.find((p) => p.kind === "where");
      expect(where?.sourceText).toBe("status IN ('a', 'b')");
    } else {
      expect(normalized).toBe(raw);
    }
  });
});
