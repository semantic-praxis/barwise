/**
 * The DDL and dbt importers read a composite-key table the same way
 * (composite-key-tables.spec.md). Each package keeps its own code -- the
 * rule lives in `DdlImportFormat` and in `dbtMapping/compositeKeys.ts` --
 * so this is the test that fails when the two copies diverge, as
 * CLAUDE.md requires of code that must agree (PR #620 review). It lives
 * here because cli is the one package that depends on both.
 */
import type { OrmModel } from "@barwise/core";
import { importDbtProject } from "@barwise/dbt";
import { DdlImportFormat } from "@barwise/formats";
import { describe, expect, it } from "vitest";

/** The relationships a composite key reads as, and what objectifies them. */
function composite(model: OrmModel) {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  // The fact types the rule builds, by the reading both importers give
  // them ("{0} and {1} have <table>"). The references built beside them
  // are named differently by each importer (from the column, or "X has
  // Y"), which this rule does not decide.
  const relationships = model.factTypes.filter((f) => / have /.test(f.readings[0]?.template ?? ""));
  return {
    relationships: relationships.map((f) => {
      const index = new Map(f.roles.map((r, i) => [r.id, i]));
      return {
        players: f.roles.map((r) => name(r.playerId)),
        uniques: f.constraints.filter((c) => c.type === "internal_uniqueness")
          .map((c) => c.roleIds.map((id) => index.get(id)).sort()),
        mandatory: f.constraints.filter((c) => c.type === "mandatory")
          .map((c) => index.get(c.roleId)).sort(),
      };
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    objectified: model.objectifiedFactTypes.map((o) => name(o.objectTypeId)).sort(),
  };
}

const dbtModel = (name: string, key: string, columns: string) =>
  `  - name: ${name}\n    columns:\n      - name: ${key}\n        data_tests: [unique, not_null]\n${columns}`;
const ref = (col: string, to: string, field: string, notNull = true) =>
  `      - name: ${col}\n        data_tests:\n${
    notNull ? "          - not_null\n" : ""
  }          - relationships:\n              to: ref('${to}')\n              field: ${field}\n`;
const plain = (col: string, notNull = true, unique = false) =>
  `      - name: ${col}\n${notNull || unique ? "        data_tests:\n" : ""}${
    notNull ? "          - not_null\n" : ""
  }${unique ? "          - unique\n" : ""}`;
const keyed = (name: string, key: string[], columns: string) =>
  `  - name: ${name}\n    data_tests:\n      - dbt_utils.unique_combination_of_columns:\n          combination_of_columns: [${
    key.join(", ")
  }]\n    columns:\n${columns}`;

const cases: { name: string; ddl: string; dbt: string; }[] = [
  {
    name: "one NOT NULL column beside the key",
    ddl: `CREATE TABLE coverage (coverage_id INT PRIMARY KEY);
      CREATE TABLE risk (risk_id INT PRIMARY KEY);
      CREATE TABLE policy_period (policy_period_id INT PRIMARY KEY);
      CREATE TABLE coverage_applies (
        coverage_id INT NOT NULL REFERENCES coverage (coverage_id),
        risk_id INT NOT NULL REFERENCES risk (risk_id),
        policy_period_id INT NOT NULL REFERENCES policy_period (policy_period_id),
        PRIMARY KEY (coverage_id, risk_id));`,
    dbt: `models:\n${dbtModel("coverage", "coverage_id", "")}${dbtModel("risk", "risk_id", "")}${
      dbtModel("policy_period", "policy_period_id", "")
    }${
      keyed(
        "coverage_applies",
        ["coverage_id", "risk_id"],
        ref("coverage_id", "coverage", "coverage_id") + ref("risk_id", "risk", "risk_id")
          + ref("policy_period_id", "policy_period", "policy_period_id"),
      )
    }`,
  },
  {
    // The extra column is nullable, so it cannot widen the fact type.
    name: "a nullable column beside the key",
    ddl: `CREATE TABLE coverage (coverage_id INT PRIMARY KEY);
      CREATE TABLE risk (risk_id INT PRIMARY KEY);
      CREATE TABLE policy_period (policy_period_id INT PRIMARY KEY);
      CREATE TABLE coverage_applies (
        coverage_id INT NOT NULL REFERENCES coverage (coverage_id),
        risk_id INT NOT NULL REFERENCES risk (risk_id),
        policy_period_id INT REFERENCES policy_period (policy_period_id),
        PRIMARY KEY (coverage_id, risk_id));`,
    dbt: `models:\n${dbtModel("coverage", "coverage_id", "")}${dbtModel("risk", "risk_id", "")}${
      dbtModel("policy_period", "policy_period_id", "")
    }${
      keyed(
        "coverage_applies",
        ["coverage_id", "risk_id"],
        ref("coverage_id", "coverage", "coverage_id") + ref("risk_id", "risk", "risk_id")
          + ref("policy_period_id", "policy_period", "policy_period_id", false),
      )
    }`,
  },
  {
    name: "several columns beside the key",
    ddl: `CREATE TABLE student (student_id INT PRIMARY KEY);
      CREATE TABLE section (crn INT PRIMARY KEY);
      CREATE TABLE enrollment (
        student_id INT NOT NULL REFERENCES student (student_id),
        crn INT NOT NULL REFERENCES section (crn),
        status_code VARCHAR(2) NOT NULL,
        credit_hours DECIMAL(5,2) NOT NULL,
        PRIMARY KEY (student_id, crn));`,
    dbt: `models:\n${dbtModel("student", "student_id", "")}${dbtModel("section", "crn", "")}${
      keyed(
        "enrollment",
        ["student_id", "crn"],
        ref("student_id", "student", "student_id") + ref("crn", "section", "crn")
          + plain("status_code") + plain("credit_hours"),
      )
    }`,
  },
  {
    name: "a column unique by itself beside the key",
    ddl: `CREATE TABLE orders (order_id INT PRIMARY KEY);
      CREATE TABLE product_variant (variant_id INT PRIMARY KEY);
      CREATE TABLE order_line (
        order_id INT NOT NULL REFERENCES orders (order_id),
        variant_id INT NOT NULL REFERENCES product_variant (variant_id),
        quantity INT NOT NULL,
        line_id INT NOT NULL UNIQUE,
        PRIMARY KEY (order_id, variant_id));`,
    dbt: `models:\n${dbtModel("orders", "order_id", "")}${
      dbtModel("product_variant", "variant_id", "")
    }${
      keyed(
        "order_line",
        ["order_id", "variant_id"],
        ref("order_id", "orders", "order_id") + ref("variant_id", "product_variant", "variant_id")
          // In dbt a column with both unique and not_null IS the model's key
          // by convention (composite-key-tables.spec.md, decision 3), so the
          // equivalent of a UNIQUE beside a composite PRIMARY KEY is unique
          // alone; with not_null too, line_id would be the key.
          + plain("quantity") + plain("line_id", false, true),
      )
    }`,
  },
  {
    name: "a key of one reference and one value",
    ddl: `CREATE TABLE meter (meter_id INT PRIMARY KEY);
      CREATE TABLE meter_reading_time (
        meter_id INT NOT NULL REFERENCES meter (meter_id),
        read_at TIMESTAMP NOT NULL,
        PRIMARY KEY (meter_id, read_at));`,
    dbt: `models:\n${dbtModel("meter", "meter_id", "")}${
      keyed(
        "meter_reading_time",
        ["meter_id", "read_at"],
        ref("meter_id", "meter", "meter_id") + plain("read_at"),
      )
    }`,
  },
];

describe("the DDL and dbt importers agree on a composite-key table", () => {
  for (const c of cases) {
    it(c.name, () => {
      const fromDdl = composite(new DdlImportFormat().parse(c.ddl).model);
      const fromDbt = composite(importDbtProject([c.dbt]).model);
      expect(fromDbt).toEqual(fromDdl);
      // Not vacuous: each case states a relationship.
      expect(fromDdl.relationships.length).toBeGreaterThan(0);
    });
  }
});
