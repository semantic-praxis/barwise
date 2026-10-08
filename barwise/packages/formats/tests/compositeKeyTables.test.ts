/**
 * An unannotated table keyed on several columns imports as the fact type
 * it states (composite-key-tables.spec.md, barwise-2z1): one test per row
 * of the spec's table, each also exported and read back -- with the
 * export's annotations and without them -- so a shape the relational
 * mapper cannot write fails here rather than in a user's round trip.
 */
import type { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();

/** What a reader of the model sees: object types, fact types with players, objectifications, uniquenesses. */
function shape(model: OrmModel) {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  return {
    entities: model.objectTypes.filter((o) => o.kind === "entity").map((o) => o.name).sort(),
    factTypes: model.factTypes.map((f) => {
      const index = new Map(f.roles.map((r, i) => [r.id, i]));
      return {
        players: f.roles.map((r) => name(r.playerId)),
        uniques: f.constraints.filter((c) => c.type === "internal_uniqueness")
          .map((c) => c.roleIds.map((id) => index.get(id)).sort()),
      };
    }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    objectified: model.objectifiedFactTypes.map((o) => name(o.objectTypeId)).sort(),
  };
}

function roundTrips(sql: string) {
  const first = ddl.parse(sql).model;
  for (const annotate of [true, false]) {
    const { text } = new DdlExportFormat().export(first, { annotate });
    expect(shape(ddl.parse(text).model), `annotate: ${annotate}`).toEqual(shape(first));
  }
  return first;
}

const parents = `
  CREATE TABLE coverage (coverage_id INT PRIMARY KEY);
  CREATE TABLE risk (risk_id INT PRIMARY KEY);
  CREATE TABLE policy_period (policy_period_id INT PRIMARY KEY);`;

describe("a composite-key table imports as the fact type it states", () => {
  it("no other column: a fact type over the key, nothing objectified", () => {
    const sql = `CREATE TABLE course (course_id INT PRIMARY KEY);
      CREATE TABLE course_prerequisite (
        course_id INT NOT NULL REFERENCES course (course_id),
        requires_course_id INT NOT NULL REFERENCES course (course_id),
        PRIMARY KEY (course_id, requires_course_id));`;
    const { model, warnings } = ddl.parse(sql);
    expect(warnings).toEqual([]);
    expect(model.objectifiedFactTypes).toEqual([]);
    expect(shape(model).factTypes).toContainEqual({
      players: ["Course", "Course"],
      uniques: [[0, 1]],
    });
    roundTrips(sql);
  });

  it("one NOT NULL column beside the key: a fact type over the key and it, unique on the key", () => {
    // C03's "For each Coverage and Risk combination, at most one
    // PolicyPeriod applies" needs the ternary.
    const sql = `${parents}
      CREATE TABLE coverage_applies (
        coverage_id INT NOT NULL REFERENCES coverage (coverage_id),
        risk_id INT NOT NULL REFERENCES risk (risk_id),
        policy_period_id INT NOT NULL REFERENCES policy_period (policy_period_id),
        PRIMARY KEY (coverage_id, risk_id));`;
    const model = roundTrips(sql);
    expect(model.objectifiedFactTypes).toEqual([]);
    expect(shape(model).factTypes).toContainEqual({
      players: ["Coverage", "Risk", "PolicyPeriod"],
      uniques: [[0, 1]],
    });
  });

  it("a nullable column beside the key cannot widen the fact: objectified, the column an attribute", () => {
    // A row with no policy period still states its coverage and risk
    // (PR #620 review).
    const sql = `${parents}
      CREATE TABLE coverage_applies (
        coverage_id INT NOT NULL REFERENCES coverage (coverage_id),
        risk_id INT NOT NULL REFERENCES risk (risk_id),
        policy_period_id INT REFERENCES policy_period (policy_period_id),
        PRIMARY KEY (coverage_id, risk_id));`;
    const model = roundTrips(sql);
    expect(shape(model).objectified).toEqual(["CoverageApplies"]);
    expect(shape(model).factTypes).toContainEqual({
      players: ["Coverage", "Risk"],
      uniques: [[0, 1]],
    });
  });

  it("several columns beside the key: objectified, the columns attributes", () => {
    const sql = `CREATE TABLE student (student_id INT PRIMARY KEY);
      CREATE TABLE section (crn INT PRIMARY KEY);
      CREATE TABLE enrollment (
        student_id INT NOT NULL REFERENCES student (student_id),
        crn INT NOT NULL REFERENCES section (crn),
        status_code VARCHAR(2) NOT NULL,
        credit_hours DECIMAL(5,2) NOT NULL,
        PRIMARY KEY (student_id, crn));`;
    const model = roundTrips(sql);
    expect(shape(model).objectified).toEqual(["Enrollment"]);
    expect(model.factTypes.map((f) => f.name)).toContain("Enrollment has StatusCode");
  });

  it("a column unique by itself identifies the objectifier and is never the extra role", () => {
    // C04's OrderLine: line_id is the entity's own identifier, quantity the
    // ternary's third role.
    const sql = `CREATE TABLE orders (order_id INT PRIMARY KEY);
      CREATE TABLE product_variant (variant_id INT PRIMARY KEY);
      CREATE TABLE order_line (
        order_id INT NOT NULL REFERENCES orders (order_id),
        variant_id INT NOT NULL REFERENCES product_variant (variant_id),
        quantity INT NOT NULL,
        line_id INT NOT NULL UNIQUE,
        PRIMARY KEY (order_id, variant_id));`;
    const model = roundTrips(sql);
    expect(shape(model).objectified).toEqual(["OrderLine"]);
    expect(shape(model).factTypes).toContainEqual({
      players: ["Orders", "ProductVariant", "Quantity"],
      uniques: [[0, 1]],
    });
    expect(model.factTypes.map((f) => f.name)).toContain("OrderLine has LineId");
  });

  it("a table another table references is objectified, so the reference has a player", () => {
    const sql = `CREATE TABLE course (course_id INT PRIMARY KEY);
      CREATE TABLE section (crn INT PRIMARY KEY);
      CREATE TABLE offering (
        course_id INT NOT NULL REFERENCES course (course_id),
        crn INT NOT NULL REFERENCES section (crn),
        PRIMARY KEY (course_id, crn));
      CREATE TABLE waitlist (
        waitlist_id INT PRIMARY KEY,
        course_id INT NOT NULL,
        crn INT NOT NULL,
        FOREIGN KEY (course_id, crn) REFERENCES offering (course_id, crn));`;
    // Not round-tripped: the composite foreign key in waitlist imports as
    // one reference per column, and each export adds another (barwise-f2n),
    // which is the importer's step 3 and not this rule.
    const { model, warnings } = ddl.parse(sql);
    expect(warnings).toEqual([]);
    expect(shape(model).objectified).toEqual(["Offering"]);
  });

  it("a key of one foreign key and one value is objectified, since the mapper could not write the binary", () => {
    const sql = `CREATE TABLE meter (meter_id INT PRIMARY KEY);
      CREATE TABLE meter_reading_time (
        meter_id INT NOT NULL REFERENCES meter (meter_id),
        read_at TIMESTAMP NOT NULL,
        PRIMARY KEY (meter_id, read_at));`;
    const model = roundTrips(sql);
    expect(shape(model).objectified).toEqual(["MeterReadingTime"]);
    expect(shape(model).factTypes).toContainEqual({
      players: ["Meter", "ReadAt"],
      uniques: [[0, 1]],
    });
  });

  it("a key of values alone keeps today's reading: an entity with an external uniqueness", () => {
    const { model } = ddl.parse(`CREATE TABLE exchange_rate (
      currency VARCHAR(3) NOT NULL, rate_date DATE NOT NULL, rate DECIMAL(12,6) NOT NULL,
      PRIMARY KEY (currency, rate_date));`);
    expect(model.objectifiedFactTypes).toEqual([]);
    expect(
      model.factTypes.flatMap((f) => f.constraints).some((c) => c.type === "external_uniqueness"),
    )
      .toBe(true);
  });
});
