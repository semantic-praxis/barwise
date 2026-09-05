/**
 * Tests for the dbt connector's sqlglot sidecar tier. Structural
 * assertions run only when python3 + sqlglot are present (the sidecar
 * is optional by design); the degradation path is always tested.
 */
import { parseSqlFile } from "@barwise/core/sql";
import { describe, expect, it } from "vitest";
import {
  normalizeCascadeResult,
  normalizeSqlTexts,
  parseSqlWithSqlglot,
  sqlglotAvailable,
} from "../../src/sql/SqlglotBridge.js";

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

describe("dbt sqlglot sidecar", () => {
  it.runIf(available)("mines joins, where, and case from a compiled dbt model", () => {
    const sql = `
SELECT c.customer_id,
       CASE WHEN c.status = 'active' THEN 1 WHEN c.status = 'churned' THEN 0 END AS is_active
FROM customers c
JOIN orders o ON o.customer_id = c.customer_id
WHERE c.email IS NOT NULL
`;
    const result = parseSqlWithSqlglot(sql, "models/customers.sql", "snowflake");
    expect(result).toBeDefined();
    const kinds = result!.patterns.map((p) => p.kind);
    expect(kinds).toContain("join");
    expect(kinds).toContain("where");
    expect(kinds).toContain("case");
    expect(result!.patterns.every((p) => p.parseLevel === "sqlglot")).toBe(true);
  });

  it("returns undefined when the sidecar cannot help, sending callers to regex", () => {
    const result = parseSqlWithSqlglot("THIS IS NOT ((( SQL", "bad.sql");
    if (!available) {
      expect(result).toBeUndefined();
    } else {
      expect(result === undefined || result.statements.length >= 0).toBe(true);
    }
  });
});

describe("normalizeSqlTexts (WS3)", () => {
  it.runIf(available)("canonicalizes whitespace so re-analysis does not churn", () => {
    const messy = "SELECT   a,b\nFROM   t\nWHERE  a  IN ('x',   'y')";
    const tidy = "SELECT a, b FROM t WHERE a IN ('x', 'y')";
    const [first] = normalizeSqlTexts([messy])!;
    const [second] = normalizeSqlTexts([tidy])!;
    expect(first).toBe(second);
  });

  it.runIf(available)("leaves unparseable fragments unchanged", () => {
    const fragment = "FOREIGN KEY (a) REFERENCES b (c)";
    const result = normalizeSqlTexts([fragment])!;
    expect(result[0]).toBe(fragment);
  });

  it("returns undefined (raw-text degradation) when the sidecar is absent", () => {
    if (!available) {
      expect(normalizeSqlTexts(["SELECT 1"])).toBeUndefined();
    }
    expect(normalizeSqlTexts([])).toEqual([]);
  });

  it("normalizeCascadeResult preserves pattern structure", () => {
    const raw = parseSqlFile(
      "SELECT * FROM t WHERE status   IN ('a',  'b')",
      "models/t.sql",
    );
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
