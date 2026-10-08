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

/**
 * What the rule decides, compared without names or readings, which the two
 * importers word differently: the fact types it builds (found by the
 * "{0} and {1} have <table>" reading both give them) and every fact type
 * an objectifier plays in -- its attributes, alternate identifier and
 * remaining foreign keys' relationships (PR #620 review: a column one side
 * dropped would otherwise pass) -- each by players, internal uniquenesses
 * and mandatory roles; external uniquenesses over them; and what is
 * objectified.
 */
function composite(model: OrmModel) {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  const objectifiers = new Set(model.objectifiedFactTypes.map((o) => o.objectTypeId));
  const facts = model.factTypes.filter((f) =>
    / have /.test(f.readings[0]?.template ?? "")
    || f.roles.some((r) => objectifiers.has(r.playerId))
  );
  const playerOf = new Map(facts.flatMap((f) => f.roles.map((r) => [r.id, name(r.playerId)])));
  const sorted = <T>(xs: T[]) =>
    xs.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return {
    factTypes: sorted(facts.map((f) => {
      const index = new Map(f.roles.map((r, i) => [r.id, i]));
      return {
        players: f.roles.map((r) => name(r.playerId)),
        uniques: f.constraints.filter((c) => c.type === "internal_uniqueness")
          .map((c) => c.roleIds.map((id) => index.get(id)).sort()),
        mandatory: f.constraints.filter((c) => c.type === "mandatory")
          .map((c) => index.get(c.roleId)).sort(),
      };
    })),
    externalUniques: sorted(
      facts.flatMap((f) => f.constraints).filter((c) => c.type === "external_uniqueness")
        .map((c) => c.roleIds.map((id) => playerOf.get(id) ?? "?").sort()),
    ),
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
    // The first shape of the spec: nothing beside the key, nothing
    // referencing it, so an unobjectified many-to-many (PR #621 review).
    name: "nothing beside the key, nothing referencing it",
    ddl: `CREATE TABLE course (course_id INT PRIMARY KEY);
      CREATE TABLE course_prerequisite (
        course_id INT NOT NULL REFERENCES course (course_id),
        requires_course_id INT NOT NULL REFERENCES course (course_id),
        PRIMARY KEY (course_id, requires_course_id));`,
    dbt: `models:\n${dbtModel("course", "course_id", "")}${
      keyed(
        "course_prerequisite",
        ["course_id", "requires_course_id"],
        ref("course_id", "course", "course_id") + ref("requires_course_id", "course", "course_id"),
      )
    }`,
  },
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
    // Referenced, so objectified; the NOT NULL column stays an attribute
    // rather than widening a fact type that is then objectified with a
    // uniqueness over only some of its roles (PR #620 review).
    name: "one NOT NULL column beside a key another table references",
    ddl: `CREATE TABLE course (course_id INT PRIMARY KEY);
      CREATE TABLE section (crn INT PRIMARY KEY);
      CREATE TABLE offering (
        course_id INT NOT NULL REFERENCES course (course_id),
        crn INT NOT NULL REFERENCES section (crn),
        room_code VARCHAR(8) NOT NULL,
        PRIMARY KEY (course_id, crn));
      CREATE TABLE waitlist (
        waitlist_id INT PRIMARY KEY,
        course_id INT NOT NULL REFERENCES offering (course_id));`,
    dbt: `models:\n${dbtModel("course", "course_id", "")}${dbtModel("section", "crn", "")}${
      keyed(
        "offering",
        ["course_id", "crn"],
        ref("course_id", "course", "course_id") + ref("crn", "section", "crn") + plain("room_code"),
      )
    }${dbtModel("waitlist", "waitlist_id", ref("course_id", "offering", "course_id"))}`,
  },
  {
    // A remaining foreign key is a relationship of the objectifier on both
    // sides (PR #620 review: the comparison must see it).
    name: "a remaining foreign key beside the key",
    ddl: `CREATE TABLE orders (order_id INT PRIMARY KEY);
      CREATE TABLE item (item_id INT PRIMARY KEY);
      CREATE TABLE supplier (supplier_id INT PRIMARY KEY);
      CREATE TABLE order_item (
        order_id INT NOT NULL REFERENCES orders (order_id),
        item_id INT NOT NULL REFERENCES item (item_id),
        supplier_id INT NOT NULL REFERENCES supplier (supplier_id),
        quantity INT NOT NULL,
        PRIMARY KEY (order_id, item_id));`,
    dbt: `models:\n${dbtModel("orders", "order_id", "")}${dbtModel("item", "item_id", "")}${
      dbtModel("supplier", "supplier_id", "")
    }${
      keyed(
        "order_item",
        ["order_id", "item_id"],
        ref("order_id", "orders", "order_id") + ref("item_id", "item", "item_id")
          + ref("supplier_id", "supplier", "supplier_id") + plain("quantity"),
      )
    }`,
  },
  {
    // A plain key column whose name an entity already holds: both importers
    // take a renamed value type for the role, as for any column (PR #621
    // review). The DDL side used to refuse the reading here.
    name: "a value role whose name an entity holds",
    ddl: `CREATE TABLE meter (meter_id INT PRIMARY KEY);
      CREATE TABLE channel (channel_id INT PRIMARY KEY);
      CREATE TABLE meter_reading (
        meter_id INT NOT NULL REFERENCES meter (meter_id),
        channel VARCHAR(4) NOT NULL,
        reading_value DECIMAL(12,3) NOT NULL,
        PRIMARY KEY (meter_id, channel));`,
    dbt: `models:\n${dbtModel("meter", "meter_id", "")}${dbtModel("channel", "channel_id", "")}${
      keyed(
        "meter_reading",
        ["meter_id", "channel"],
        ref("meter_id", "meter", "meter_id") + plain("channel") + plain("reading_value"),
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
        line_id INT UNIQUE,
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
          // So the DDL side declares it nullable too: the wider comparison
          // caught the NOT NULL it once had as a mandatory role dbt lacked.
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
  {
    // The DDL side once put every foreign key first, so a key naming its
    // value column first read in a different role order (PR #621 review).
    name: "a key naming its value column before its reference",
    ddl: `CREATE TABLE meter (meter_id INT PRIMARY KEY);
      CREATE TABLE meter_reading_time (
        meter_id INT NOT NULL REFERENCES meter (meter_id),
        read_at TIMESTAMP NOT NULL,
        PRIMARY KEY (read_at, meter_id));`,
    dbt: `models:\n${dbtModel("meter", "meter_id", "")}${
      keyed(
        "meter_reading_time",
        ["read_at", "meter_id"],
        ref("meter_id", "meter", "meter_id") + plain("read_at"),
      )
    }`,
  },
  {
    // A composite value role and another model's attribute share a name
    // but not a type, so one keeps the plain name and the other is
    // prefixed. dbt once claimed composite roles after ordinary columns and
    // DDL before them, so they gave the plain name to different columns
    // (PR #621 review).
    name: "a value role whose name another model's column of another type also uses",
    ddl: `CREATE TABLE meter (meter_id INT PRIMARY KEY);
      CREATE TABLE device (device_id INT PRIMARY KEY, channel INT NOT NULL);
      CREATE TABLE meter_reading (
        meter_id INT NOT NULL REFERENCES meter (meter_id),
        channel VARCHAR(10) NOT NULL,
        PRIMARY KEY (meter_id, channel));`,
    dbt: `models:\n${dbtModel("meter", "meter_id", "")}${
      dbtModel("device", "device_id", "        data_type: int\n")
    }      - name: channel\n        data_type: int\n        data_tests: [not_null]\n${
      keyed(
        "meter_reading",
        ["meter_id", "channel"],
        ref("meter_id", "meter", "meter_id")
          + "      - name: channel\n        data_type: varchar(10)\n        data_tests: [not_null]\n",
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
      expect(fromDdl.factTypes.length).toBeGreaterThan(0);
    });
  }
});
