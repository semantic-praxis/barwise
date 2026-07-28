/**
 * Tests for dialect-targeted DDL export (sql-dialect-capability spec,
 * WS2): the capability profile routes each constraint to a native
 * clause, an informational clause, or the ConstraintSpec spillway with
 * a SQL comment.
 */
import { describe, expect, it } from "vitest";
import { routeConstraints } from "../src/ddl/constraintRouting.js";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DIALECT_PROFILES, resolveDialectProfile } from "../src/ddl/dialectCapabilities.js";
import { ModelBuilder } from "./helpers/ModelBuilder.js";

const ddlFormat = new DdlExportFormat();

/** Customer with an enumerated Status value and an Order relationship. */
function orderModel() {
  return new ModelBuilder("Test")
    .withEntityType("Customer", { referenceMode: "customer_id" })
    .withEntityType("Order", { referenceMode: "order_number" })
    .withValueType("Status", {
      valueConstraint: { values: ["active", "inactive"] },
    })
    .withBinaryFactType("Customer has Status", {
      role1: { player: "Customer", name: "has" },
      role2: { player: "Status", name: "is of" },
      uniqueness: "role1",
    })
    .withBinaryFactType("Customer places Order", {
      role1: { player: "Customer", name: "places" },
      role2: { player: "Order", name: "is placed by" },
      uniqueness: "role2",
      mandatory: "role2",
    })
    .build();
}

/** A model with a ring constraint no SQL dialect can express. */
function ringModel() {
  const model = new ModelBuilder("Test")
    .withEntityType("Employee", { referenceMode: "employee_id" })
    .withBinaryFactType("Employee manages Employee", {
      role1: { player: "Employee", name: "manages" },
      role2: { player: "Employee", name: "is managed by" },
      uniqueness: "role2",
    })
    .build();
  model.getFactTypeByName("Employee manages Employee")!.addConstraint({
    type: "ring",
    roleId1: "Employee manages Employee::role1",
    roleId2: "Employee manages Employee::role2",
    ringType: "acyclic",
  });
  return model;
}

describe("dialect capability profiles", () => {
  it("covers every dialect the SQL cascade knows", () => {
    expect(Object.keys(DIALECT_PROFILES).sort()).toEqual([
      "ansi",
      "bigquery",
      "databricks",
      "mysql",
      "postgres",
      "redshift",
      "snowflake",
    ]);
  });

  it("rejects unknown dialects with the supported list", () => {
    expect(() => resolveDialectProfile("oracle")).toThrow(/Unknown SQL dialect "oracle"/);
    expect(() => resolveDialectProfile("oracle")).toThrow(/postgres/);
  });

  it("is reachable through the export adapter", () => {
    expect(() => ddlFormat.export(orderModel(), { dialect: "oracle" })).toThrow(
      /Unknown SQL dialect/,
    );
  });
});

describe("native constraint rendering (postgres / default)", () => {
  it("renders value constraints as CHECK clauses", () => {
    const result = ddlFormat.export(orderModel(), { dialect: "postgres", annotate: false });

    expect(result.text).toContain("CHECK (status IN ('active', 'inactive'))");
    expect(result.text).not.toContain("NOT ENFORCED");
    expect(result.constraintSpecs).toBeUndefined();
  });

  it("keeps the default (no dialect) output on the ansi profile", () => {
    const result = ddlFormat.export(orderModel(), { annotate: false });

    expect(result.text).toContain("CHECK (status IN ('active', 'inactive'))");
    expect(result.text).toContain("FOREIGN KEY");
    expect(result.text).not.toContain("NOT ENFORCED");
  });

  it("produces well-formed comma-separated table bodies after clause injection", () => {
    const result = ddlFormat.export(orderModel(), { dialect: "postgres", annotate: false });

    // The clause before an injected CHECK must gain a comma, and the
    // last clause must not have one.
    const customerTable = /CREATE TABLE customer \(([^;]*)\);/.exec(result.text)![1]!;
    const clauseLines = customerTable.split("\n").filter((l) => l.trim().length > 0);
    for (const line of clauseLines.slice(0, -1)) {
      expect(line.trimEnd().endsWith(",")).toBe(true);
    }
    expect(clauseLines.at(-1)!.trimEnd().endsWith(",")).toBe(false);
  });

  it("renders a secondary unique value column as a UNIQUE clause", () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("Email")
      .withBinaryFactType("Customer has Email", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Email", name: "belongs to" },
        uniqueness: "both",
      })
      .build();

    const result = ddlFormat.export(model, { dialect: "postgres", annotate: false });

    expect(result.text).toContain("UNIQUE (email)");
  });
});

describe("informational constraint rendering", () => {
  it("marks snowflake PK/FK as NOT ENFORCED and spills CHECK", () => {
    const result = ddlFormat.export(orderModel(), { dialect: "snowflake", annotate: false });

    expect(result.text).toMatch(/PRIMARY KEY \([^)]*\) NOT ENFORCED/);
    expect(result.text).toMatch(/REFERENCES [^(]+\([^)]*\) NOT ENFORCED/);
    // CHECK is absent in Snowflake: comment + spec instead of a clause.
    expect(result.text).not.toContain("CHECK (");
    expect(result.text).toContain("-- Constraint (CHECK is not supported by snowflake):");
    expect(result.constraintSpecs).toBeDefined();
    expect(result.constraintSpecs!.length).toBe(1);
    expect(result.constraintSpecs![0]!.verbalization.length).toBeGreaterThan(0);
    expect(result.constraintSpecs![0]!.pseudocode).toContain("active");
  });

  it("marks redshift informational clauses with a comment (no NOT ENFORCED syntax)", () => {
    const result = ddlFormat.export(orderModel(), { dialect: "redshift", annotate: false });

    expect(result.text).not.toContain("NOT ENFORCED");
    expect(result.text).toMatch(
      /PRIMARY KEY \([^)]*\),? -- informational: not enforced by redshift/,
    );
  });

  it("keeps databricks CHECK native while PK/FK are informational", () => {
    const result = ddlFormat.export(orderModel(), { dialect: "databricks", annotate: false });

    expect(result.text).toContain("CHECK (status IN ('active', 'inactive'))");
    expect(result.text).toMatch(/PRIMARY KEY \([^)]*\) NOT ENFORCED/);
  });
});

describe("the ConstraintSpec spillway", () => {
  it("spills constraints no dialect can express, on every dialect", () => {
    for (const dialect of ["ansi", "postgres", "snowflake"]) {
      const result = ddlFormat.export(ringModel(), { dialect, annotate: false });

      expect(result.constraintSpecs).toBeDefined();
      const spec = result.constraintSpecs![0]!;
      expect(spec.pseudocode).toContain("no cycle");
      expect(result.text).toContain("-- Constraint (not expressible in SQL DDL):");
    }
  });

  it("provides verbalization, pseudocode, and example in each spec", () => {
    const result = ddlFormat.export(ringModel(), { dialect: "postgres" });

    const spec = result.constraintSpecs![0]!;
    expect(spec.verbalization.length).toBeGreaterThan(0);
    expect(spec.pseudocode.length).toBeGreaterThan(0);
    expect(spec.example.length).toBeGreaterThan(0);
  });

  it("places the spillway comment next to the involved table", () => {
    const result = ddlFormat.export(ringModel(), { dialect: "postgres", annotate: false });

    const commentIdx = result.text.indexOf("-- Constraint (not expressible in SQL DDL):");
    const tableIdx = result.text.indexOf("CREATE TABLE employee");
    expect(commentIdx).toBeGreaterThanOrEqual(0);
    expect(commentIdx).toBeLessThan(tableIdx);
  });
});

describe("constraint routing (unit)", () => {
  it("does not route constraints the mapping already realizes", async () => {
    const model = orderModel();
    const { RelationalMapper } = await import("@barwise/core/mapping");
    const schema = new RelationalMapper().map(model);

    const routing = routeConstraints(
      model,
      schema,
      resolveDialectProfile("postgres"),
      "postgres",
    );

    // The mandatory + uniqueness constraints on Customer places Order
    // become FK/NOT NULL; only the Status value constraint routes.
    expect(routing.clauses).toHaveLength(1);
    expect(routing.clauses[0]!.sql).toContain("CHECK");
    expect(routing.spilled).toHaveLength(0);
  });

  it("deduplicates object-type and role-level value constraints", async () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Customer", { referenceMode: "customer_id" })
      .withValueType("Status", {
        valueConstraint: { values: ["a", "b"] },
      })
      .withBinaryFactType("Customer has Status", {
        role1: { player: "Customer", name: "has" },
        role2: { player: "Status", name: "is of" },
        uniqueness: "role1",
      })
      .build();
    // The same rule again, as a role-level constraint.
    model.getFactTypeByName("Customer has Status")!.addConstraint({
      type: "value_constraint",
      roleId: "Customer has Status::role2",
      values: ["a", "b"],
    });

    const { RelationalMapper } = await import("@barwise/core/mapping");
    const schema = new RelationalMapper().map(model);
    const routing = routeConstraints(
      model,
      schema,
      resolveDialectProfile("postgres"),
      "postgres",
    );

    expect(routing.clauses).toHaveLength(1);
  });

  it("routes range value constraints as comparison predicates", async () => {
    const model = new ModelBuilder("Test")
      .withEntityType("Person", { referenceMode: "person_id" })
      .withValueType("Age", {
        dataType: { name: "integer" },
        valueConstraint: { values: [], ranges: [{ min: "0", max: "150" }] },
      })
      .withBinaryFactType("Person has Age", {
        role1: { player: "Person", name: "has" },
        role2: { player: "Age", name: "is of" },
        uniqueness: "role1",
      })
      .build();

    const result = ddlFormat.export(model, { dialect: "postgres", annotate: false });

    expect(result.text).toContain("CHECK ((age >= 0 AND age <= 150))");
  });
});
