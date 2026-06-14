/**
 * Tests for the dbt SQL compiler (stub Jinja rendering).
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compileDbtSql, stubRenderJinja } from "../src/DbtSqlCompiler.js";

let testDir: string;

function createTestDir(): string {
  const dir = join(tmpdir(), `barwise-compiler-test-${randomUUID()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("stubRenderJinja", () => {
  it("replaces ref() with model name", () => {
    const result = stubRenderJinja("SELECT * FROM {{ ref('customers') }}");
    expect(result).toBe("SELECT * FROM customers");
  });

  it("replaces source() with schema.table", () => {
    const result = stubRenderJinja(
      "SELECT * FROM {{ source('raw', 'orders') }}",
    );
    expect(result).toBe("SELECT * FROM raw.orders");
  });

  it("removes config() calls", () => {
    const result = stubRenderJinja(
      "{{ config(materialized='table') }}\nSELECT 1",
    );
    expect(result).toBe("SELECT 1");
  });

  it("replaces var() with quoted name", () => {
    const result = stubRenderJinja(
      "SELECT * FROM table WHERE date > {{ var('start_date') }}",
    );
    expect(result).toBe("SELECT * FROM table WHERE date > 'start_date'");
  });

  it("replaces this with this_model", () => {
    const result = stubRenderJinja("SELECT * FROM {{ this }}");
    expect(result).toBe("SELECT * FROM this_model");
  });

  it("removes is_incremental() blocks keeping else content", () => {
    const result = stubRenderJinja(`
{% if is_incremental() %}
  SELECT * FROM stream
{% else %}
  SELECT * FROM full_table
{% endif %}
`);
    expect(result).toContain("SELECT * FROM full_table");
    expect(result).not.toContain("stream");
  });

  it("removes is_incremental() blocks without else", () => {
    const result = stubRenderJinja(`
SELECT * FROM table
{% if is_incremental() %}
  WHERE updated_at > (SELECT MAX(updated_at) FROM this)
{% endif %}
`);
    expect(result).toContain("SELECT * FROM table");
    expect(result).not.toContain("updated_at >");
  });

  it("removes remaining Jinja expressions", () => {
    const result = stubRenderJinja(
      "SELECT {{ dbt_utils.star(from=ref('model')) }}",
    );
    expect(result).not.toContain("{{");
    expect(result).not.toContain("}}");
  });

  it("removes remaining Jinja blocks", () => {
    const result = stubRenderJinja(
      "{% for item in items %}SELECT {{ item }}{% endfor %}",
    );
    expect(result).not.toContain("{%");
    expect(result).not.toContain("%}");
  });
});

describe("compileDbtSql", () => {
  beforeEach(() => {
    testDir = createTestDir();
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("reads pre-compiled SQL from target/compiled/", () => {
    const compiledDir = join(testDir, "target", "compiled", "project", "models");
    mkdirSync(compiledDir, { recursive: true });
    writeFileSync(
      join(compiledDir, "customers.sql"),
      "SELECT * FROM raw.customers",
    );

    const results = compileDbtSql(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.compilationMethod).toBe("dbt-compile");
    expect(results[0]!.sql).toBe("SELECT * FROM raw.customers");
  });

  it("falls back to stub rendering when no compiled output", () => {
    mkdirSync(join(testDir, "models"), { recursive: true });
    writeFileSync(
      join(testDir, "models", "customers.sql"),
      "SELECT * FROM {{ ref('raw_customers') }}",
    );

    const results = compileDbtSql(testDir);

    expect(results).toHaveLength(1);
    expect(results[0]!.compilationMethod).toBe("stub");
    expect(results[0]!.sql).toBe("SELECT * FROM raw_customers");
  });

  it("returns empty array when no SQL files found", () => {
    const results = compileDbtSql(testDir);
    expect(results).toHaveLength(0);
  });

  it("handles multiple SQL files", () => {
    mkdirSync(join(testDir, "models"), { recursive: true });
    writeFileSync(
      join(testDir, "models", "a.sql"),
      "SELECT 1",
    );
    writeFileSync(
      join(testDir, "models", "b.sql"),
      "SELECT 2",
    );

    const results = compileDbtSql(testDir);
    expect(results).toHaveLength(2);
  });
});
