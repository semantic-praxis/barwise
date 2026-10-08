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

  it("a remaining foreign key is a relationship of the objectifier, not an attribute", () => {
    const sql = `CREATE TABLE orders (order_id INT PRIMARY KEY);
      CREATE TABLE item (item_id INT PRIMARY KEY);
      CREATE TABLE supplier (supplier_id INT PRIMARY KEY);
      CREATE TABLE order_item (
        order_id INT NOT NULL REFERENCES orders (order_id),
        item_id INT NOT NULL REFERENCES item (item_id),
        supplier_id INT NOT NULL REFERENCES supplier (supplier_id),
        quantity INT NOT NULL,
        PRIMARY KEY (order_id, item_id));`;
    const model = roundTrips(sql);
    expect(shape(model).objectified).toEqual(["OrderItem"]);
    expect(
      shape(model).factTypes.some((f) =>
        f.players.includes("OrderItem") && f.players.includes("Supplier")
      ),
    ).toBe(true);
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
    // An alternate identifier: unique on its value role, while the
    // primary key stays the preferred identification (PR #620 review).
    const lineId = model.getFactTypeByName("OrderLine has LineId")!;
    const valueRole = lineId.roles.find((r) => model.getObjectType(r.playerId)?.name === "LineId")!;
    expect(
      lineId.constraints.some((c) =>
        c.type === "internal_uniqueness" && c.roleIds.length === 1 && c.roleIds[0] === valueRole.id
      ),
    ).toBe(true);
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

  it("a referenced table's one NOT NULL column stays an attribute, not a role", () => {
    // Objectified because waitlist references it, so the fact type stays
    // over the key: one unique over only some of its roles is not one to
    // objectify (PR #620 review).
    const sql = `CREATE TABLE course (course_id INT PRIMARY KEY);
      CREATE TABLE section (crn INT PRIMARY KEY);
      CREATE TABLE offering (
        course_id INT NOT NULL REFERENCES course (course_id),
        crn INT NOT NULL REFERENCES section (crn),
        room_code VARCHAR(8) NOT NULL,
        PRIMARY KEY (course_id, crn));
      CREATE TABLE waitlist (
        waitlist_id INT PRIMARY KEY,
        offering_course_id INT NOT NULL,
        offering_crn INT NOT NULL,
        FOREIGN KEY (offering_course_id, offering_crn) REFERENCES offering (course_id, crn));`;
    const { model } = ddl.parse(sql);
    expect(shape(model).objectified).toEqual(["Offering"]);
    expect(shape(model).factTypes).toContainEqual({
      players: ["Course", "Section"],
      uniques: [[0, 1]],
    });
    expect(model.factTypes.map((f) => f.name)).toContain("Offering has RoomCode");
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

  it("a key that is one composite foreign key is not this rule: it is one role, not several", () => {
    // (tenant_id, order_id) is one reference to orders; read as a fact type
    // it would have one role (PR #620 review). It is the key-is-reference
    // shape (key-reference-tables.spec.md).
    const { model } = ddl.parse(`CREATE TABLE orders (tenant_id INT, order_id INT,
        PRIMARY KEY (tenant_id, order_id));
      CREATE TABLE order_note (
        tenant_id INT NOT NULL, order_id INT NOT NULL, note VARCHAR(200) NOT NULL,
        PRIMARY KEY (tenant_id, order_id),
        FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, order_id));`);
    expect(model.objectifiedFactTypes).toEqual([]);
    expect(model.factTypes.every((f) => f.roles.length >= 2)).toBe(true);
  });

  it("two foreign keys in the key that share a column keep today's reading", () => {
    const { model, warnings } = ddl.parse(`CREATE TABLE tenant (tenant_id INT PRIMARY KEY);
      CREATE TABLE orders (tenant_id INT, order_id INT, PRIMARY KEY (tenant_id, order_id));
      CREATE TABLE order_flag (
        tenant_id INT NOT NULL, order_id INT NOT NULL,
        PRIMARY KEY (tenant_id, order_id),
        FOREIGN KEY (tenant_id) REFERENCES tenant (tenant_id),
        FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, order_id));`);
    expect(model.factTypes.some((f) => / order flag$/.test(f.name))).toBe(false);
    // Not even attempted: without the guard the rule tried two roles over
    // one column, failed, and fell back with a warning.
    expect(warnings.filter((w) => /reads as a fact type over its key/.test(w))).toEqual([]);
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
