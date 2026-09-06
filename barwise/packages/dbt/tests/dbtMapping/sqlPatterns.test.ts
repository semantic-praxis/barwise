/**
 * Tests for the SQL pattern merge (sql-dialect-capability spec, WS1).
 *
 * The merge is pure: it takes mined SqlPatternContext values and folds
 * them into the model the YAML mapping produced, so these tests need
 * no python and no filesystem.
 */
import type { SqlPatternContext } from "@barwise/core/sql";
import { describe, expect, it } from "vitest";
import { ReportBuilder } from "../../src/DbtImportReport.js";
import { mergeSqlPatterns } from "../../src/dbtMapping/sqlPatterns.js";
import { importDbtProject } from "../../src/DbtProjectImporter.js";

const CUSTOMERS_YAML = `
models:
  - name: customers
    columns:
      - name: customer_id
        tests: [not_null, unique]
      - name: status
      - name: email
      - name: segment
        tests:
          - accepted_values:
              values: ["smb", "enterprise"]
`;

const ORDERS_YAML = `
models:
  - name: orders
    columns:
      - name: order_id
        tests: [not_null, unique]
`;

function pattern(
  overrides: Partial<SqlPatternContext> & { kind: SqlPatternContext["kind"]; },
): SqlPatternContext {
  return {
    filePath: "models/customers.sql",
    startLine: 1,
    endLine: 1,
    sourceText: "",
    parseLevel: "regex",
    ...overrides,
  };
}

function setup() {
  const { model } = importDbtProject([CUSTOMERS_YAML, ORDERS_YAML]);
  const report = new ReportBuilder();
  return { model, report };
}

function constraintsOf(model: ReturnType<typeof setup>["model"], factName: string) {
  const ft = model.factTypes.find((f) => f.name === factName);
  expect(ft).toBeDefined();
  return ft!.constraints;
}

describe("mergeSqlPatterns", () => {
  it("merges an IN enumeration in a WHERE guard as a value constraint", () => {
    const { model, report } = setup();
    const stats = mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({
          kind: "where",
          sourceText: "status IN ('active', 'churned')",
          columns: ["status"],
        }),
      ],
    }], report);

    expect(stats.constraintsAdded).toBe(1);
    const constraints = constraintsOf(model, "Customers has Status");
    const vc = constraints.find((c) => c.type === "value_constraint");
    expect(vc).toBeDefined();
    expect((vc as { values: string[]; }).values).toEqual(["active", "churned"]);

    const entries = report.build().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.severity).toBe("warning");
    expect(entries[0]!.category).toBe("constraint");
    expect(entries[0]!.message).toContain("value constraint");
  });

  it("merges IS NOT NULL guards as mandatory constraints (both raw and canonical forms)", () => {
    const { model, report } = setup();
    mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({ kind: "where", sourceText: "email IS NOT NULL", columns: ["email"] }),
        // sqlglot renders IS NOT NULL as NOT ... IS NULL.
        pattern({ kind: "where", sourceText: "NOT status IS NULL", columns: ["status"] }),
      ],
    }], report);

    const emailConstraints = constraintsOf(model, "Customers has Email");
    expect(emailConstraints.some((c) => c.type === "mandatory")).toBe(true);
    const statusConstraints = constraintsOf(model, "Customers has Status");
    expect(statusConstraints.some((c) => c.type === "mandatory")).toBe(true);
  });

  it("merges CASE branch enumerations of two or more values", () => {
    const { model, report } = setup();
    const stats = mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({
          kind: "case",
          sourceText: "CASE WHEN status = 'active' THEN 1 WHEN status = 'churned' THEN 0 END",
          columns: ["status"],
        }),
        // Single-value CASE stays out: too weak a signal.
        pattern({
          kind: "case",
          sourceText: "CASE WHEN email = 'x' THEN 1 ELSE 0 END",
          columns: ["email"],
        }),
      ],
    }], report);

    expect(stats.constraintsAdded).toBe(1);
    const constraints = constraintsOf(model, "Customers has Status");
    const vc = constraints.find((c) => c.type === "value_constraint");
    expect((vc as { values: string[]; }).values).toEqual(["active", "churned"]);
  });

  it("uses regex-tier details.values for CASE patterns when present", () => {
    const { model, report } = setup();
    mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({
          kind: "case",
          sourceText: "CASE WHEN status = 'a' THEN 1 WHEN status = 'b' THEN 2 END",
          columns: ["status"],
          details: { values: ["a", "b"] },
        }),
      ],
    }], report);

    const constraints = constraintsOf(model, "Customers has Status");
    const vc = constraints.find((c) => c.type === "value_constraint");
    expect((vc as { values: string[]; }).values).toEqual(["a", "b"]);
  });

  it("does not duplicate constraints the YAML tests already produced", () => {
    const { model, report } = setup();
    const before = constraintsOf(model, "Customers has Segment")
      .filter((c) => c.type === "value_constraint").length;
    expect(before).toBe(1);

    const stats = mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({
          kind: "where",
          sourceText: "segment IN ('smb', 'enterprise')",
          columns: ["segment"],
        }),
      ],
    }], report);

    expect(stats.constraintsAdded).toBe(0);
    const after = constraintsOf(model, "Customers has Segment")
      .filter((c) => c.type === "value_constraint").length;
    expect(after).toBe(1);
  });

  it("reports an undeclared JOIN relationship as a gap without mutating the model", () => {
    const { model, report } = setup();
    const factCount = model.factTypes.length;

    mergeSqlPatterns(model, [{
      modelName: "orders",
      sourcePath: "models/orders.sql",
      patterns: [
        pattern({
          kind: "join",
          filePath: "models/orders.sql",
          sourceText: "JOIN customers ON orders.customer_id = customers.customer_id",
          tables: ["orders", "customers"],
          columns: ["customer_id"],
        }),
      ],
    }], report);

    expect(model.factTypes.length).toBe(factCount);
    const entries = report.build().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]!.severity).toBe("gap");
    expect(entries[0]!.category).toBe("relationship");
    expect(entries[0]!.message).toContain("relationships test");
  });

  it("stays silent on a JOIN whose relationship the YAML already declares", () => {
    const yaml = `
models:
  - name: customers
    columns:
      - name: customer_id
        tests: [not_null, unique]
  - name: orders
    columns:
      - name: order_id
        tests: [not_null, unique]
      - name: customer_id
        tests:
          - relationships:
              to: ref('customers')
              field: customer_id
`;
    const { model } = importDbtProject([yaml]);
    const report = new ReportBuilder();

    mergeSqlPatterns(model, [{
      modelName: "orders",
      sourcePath: "models/orders.sql",
      patterns: [
        pattern({
          kind: "join",
          filePath: "models/orders.sql",
          sourceText: "JOIN customers ON orders.customer_id = customers.customer_id",
          tables: ["orders", "customers"],
          columns: ["customer_id"],
        }),
      ],
    }], report);

    expect(report.build().entries).toHaveLength(0);
  });

  it("ignores patterns for columns and models the YAML does not declare", () => {
    const { model, report } = setup();
    const stats = mergeSqlPatterns(model, [
      {
        modelName: "customers",
        sourcePath: "models/customers.sql",
        patterns: [
          pattern({ kind: "where", sourceText: "unknown_col IN ('x')", columns: ["unknown_col"] }),
        ],
      },
      {
        modelName: "not_in_yaml",
        sourcePath: "models/not_in_yaml.sql",
        patterns: [
          pattern({ kind: "where", sourceText: "status IN ('a', 'b')", columns: ["status"] }),
        ],
      },
    ], report);

    expect(stats.constraintsAdded).toBe(0);
  });

  it("merges a SQL UNIQUE constraint on a single column as internal uniqueness, without duplicating", () => {
    const { model, report } = setup();
    // "Customers has Email" already carries an internal_uniqueness
    // constraint on the entity role (single-valued attribute), so the
    // dedup check that matters is on the *value* role the SQL UNIQUE
    // pattern targets, not the constraint count overall.
    const before = constraintsOf(model, "Customers has Email")
      .filter((c) => c.type === "internal_uniqueness") as { roleIds: string[]; }[];
    const beforeRoleIdSets = new Set(before.map((c) => c.roleIds.join(",")));

    mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({ kind: "not_null", sourceText: "", columns: ["email"] }),
        pattern({ kind: "unique", sourceText: "", columns: ["email"] }),
      ],
    }], report);

    const constraints = constraintsOf(model, "Customers has Email");
    expect(constraints.some((c) => c.type === "mandatory")).toBe(true);
    const uniquenessConstraints = constraints.filter((c) => c.type === "internal_uniqueness") as {
      roleIds: string[];
    }[];
    expect(uniquenessConstraints).toHaveLength(before.length + 1);
    const newUc = uniquenessConstraints.find((c) => !beforeRoleIdSets.has(c.roleIds.join(",")));
    expect(newUc).toBeDefined();

    // A second UNIQUE pattern on the same column must not add a
    // duplicate constraint for that same role.
    const stats = mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [pattern({ kind: "unique", sourceText: "", columns: ["email"] })],
    }], report);
    expect(stats.constraintsAdded).toBe(0);
    expect(
      constraintsOf(model, "Customers has Email").filter(
        (c) =>
          c.type === "internal_uniqueness"
          && (c as { roleIds: string[]; }).roleIds[0] === newUc!.roleIds[0],
      ),
    ).toHaveLength(1);
  });

  it("ignores a SQL UNIQUE pattern spanning more than one column", () => {
    const { model, report } = setup();
    const stats = mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [pattern({ kind: "unique", sourceText: "", columns: ["email", "status"] })],
    }], report);

    expect(stats.constraintsAdded).toBe(0);
  });

  it("strips table qualifiers from mined column names", () => {
    const { model, report } = setup();
    mergeSqlPatterns(model, [{
      modelName: "customers",
      sourcePath: "models/customers.sql",
      patterns: [
        pattern({
          kind: "where",
          sourceText: "c.status IN ('active', 'churned')",
          columns: ["c.status"],
        }),
      ],
    }], report);

    const constraints = constraintsOf(model, "Customers has Status");
    expect(constraints.some((c) => c.type === "value_constraint")).toBe(true);
  });
});
