/**
 * What the DDL export writes, the DDL import reads back
 * (ddl-round-trip-fixed-point.spec.md, R2, barwise-dnm).
 */
import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();
const valueType = (model: OrmModel, name: string) => {
  const ot = model.getObjectTypeByName(name);
  return ot?.kind === "value" ? ot : undefined;
};

describe("a comment inside a column list", () => {
  it("does not take the column after it", () => {
    // The export writes this line above a constrained column. Split on
    // commas, it glued itself to the column, which was then rejected along
    // with its value type and fact type.
    const { model } = ddl.parse(`CREATE TABLE doctor (
      provider_id VARCHAR(20) NOT NULL,
      -- NOTE(barwise): Value constraint available: ['a', 'b']. Consider adding a test.
      specialty VARCHAR(30) NOT NULL,
      PRIMARY KEY (provider_id)
    );`);
    expect(valueType(model, "Specialty")).toBeDefined();
    expect(model.factTypes.map((f) => f.name)).toContain("Doctor has Specialty");
  });
});

describe("a CHECK reads back as a value constraint", () => {
  it("from a table-level CHECK, before or after the column", () => {
    const { model } = ddl.parse(`CREATE TABLE doctor (
      provider_id VARCHAR(20) NOT NULL,
      CHECK (specialty IN ('cardiology', 'pediatrics')),
      specialty VARCHAR(30) NOT NULL,
      rank INTEGER,
      PRIMARY KEY (provider_id),
      CHECK ((rank >= 1 AND rank <= 5))
    );`);
    expect(valueType(model, "Specialty")?.valueConstraint).toEqual({
      values: ["cardiology", "pediatrics"],
    });
    expect(valueType(model, "Rank")?.valueConstraint).toEqual({
      values: [],
      ranges: [{ min: "1", max: "5" }],
    });
  });

  it("from an inline CHECK", () => {
    const { model } = ddl.parse(
      "CREATE TABLE t (id INT PRIMARY KEY, status VARCHAR(9) NOT NULL CHECK (status IN ('open', 'shut')));",
    );
    expect(valueType(model, "Status")?.valueConstraint).toEqual({ values: ["open", "shut"] });
  });

  it("keeps a constrained column apart from an unconstrained one of the same name", () => {
    // PR #580 review: the shared authority decides sharing from the
    // constraint too, so the importer passes it in rather than overriding.
    const { model } = ddl.parse(`
      CREATE TABLE a (id INT PRIMARY KEY, status VARCHAR(9));
      CREATE TABLE b (id INT PRIMARY KEY, status VARCHAR(9) CHECK (status IN ('open', 'shut')));`);
    const constrained = model.objectTypes.filter((o) => o.kind === "value" && o.valueConstraint);
    expect(constrained.map((o) => o.kind === "value" && o.valueConstraint)).toEqual([
      { values: ["open", "shut"] },
    ]);
  });

  it("shares a value type between two columns with the same CHECK", () => {
    const { model } = ddl.parse(`
      CREATE TABLE a (id INT PRIMARY KEY, status VARCHAR(9) CHECK (status IN ('open', 'shut')));
      CREATE TABLE b (id INT PRIMARY KEY, status VARCHAR(9) CHECK (status IN ('open', 'shut')));`);
    expect(model.objectTypes.filter((o) => /Status/.test(o.name)).map((o) => o.name)).toEqual([
      "Status",
    ]);
  });

  it("names a CHECK outside the grammar instead of reading it", () => {
    const { model, warnings } = ddl.parse(
      "CREATE TABLE t (id INT PRIMARY KEY, code VARCHAR(3), CHECK (LENGTH(code) = 3));",
    );
    expect(valueType(model, "Code")?.valueConstraint).toBeUndefined();
    expect(warnings.some((w) => w.includes("CHECK (LENGTH(code) = 3)") && /not imported/.test(w)))
      .toBe(true);
  });
});

describe("the export's own output", () => {
  it("reads back every column and value constraint of the clinic example", () => {
    const source = new URL(
      "../../../examples/transcripts/clinic-appointments.orm.yaml",
      import.meta.url,
    );
    const original = new OrmYamlSerializer().deserialize(readFileSync(source, "utf8"));
    const { text } = new DdlExportFormat().export(original);
    const { model } = ddl.parse(text);
    // TimeSlot and AppointmentDate play roles of an n-ary fact type, whose
    // columns the export only writes since barwise-kgh (PR #580 review).
    for (const name of ["Specialty", "AppointmentStatus", "TimeSlot", "AppointmentDate"]) {
      const before = original.getObjectTypeByName(name);
      expect(valueType(model, name), name).toBeDefined();
      expect(valueType(model, name)!.valueConstraint, name).toEqual(
        before?.kind === "value" ? before.valueConstraint : undefined,
      );
    }
  });
});

describe("an identity clause reads back as auto_counter", () => {
  // Each spelling used to be reported as "not imported" and ended clause
  // parsing, so the column read back as a plain integer and a NOT NULL
  // after the clause was lost (barwise-hgr, ddl-type-round-trip.spec.md R4).
  const counters = (sql: string) => {
    const { model, warnings } = ddl.parse(sql);
    const auto = model.objectTypes
      .filter((o) => o.kind === "value" && o.dataType?.name === "auto_counter")
      .map((o) => o.name);
    return { model, warnings, auto };
  };

  it.each([
    ["the export's own spelling", "INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL"],
    [
      "GENERATED ALWAYS with options",
      "BIGINT GENERATED ALWAYS AS IDENTITY (START WITH 1) NOT NULL",
    ],
    ["MySQL", "INT AUTO_INCREMENT NOT NULL"],
    ["Snowflake", "NUMBER(38,0) AUTOINCREMENT START 1 INCREMENT 1 NOT NULL"],
    ["Redshift", "INTEGER IDENTITY(1,1) NOT NULL"],
  ])("%s", (_label, column) => {
    // On a non-key column, so the NOT NULL after the clause is what makes
    // the role mandatory; a key is mandatory either way.
    const { model, warnings, auto } = counters(
      `CREATE TABLE movement (code VARCHAR(9) PRIMARY KEY, seq_no ${column}, qty INTEGER);`,
    );
    expect(warnings).toEqual([]);
    expect(auto).toEqual(["SeqNo"]);
    const ft = model.factTypes.find((f) =>
      f.roles.some((r) => model.getObjectType(r.playerId)?.name === "SeqNo")
    );
    expect(ft?.constraints.some((c) => c.type === "mandatory"), "NOT NULL read").toBe(true);
    expect(valueType(model, "Qty")?.dataType).toEqual({ name: "integer" });
  });

  it("leaves a computed column alone", () => {
    const { warnings, auto } = counters(
      "CREATE TABLE t (id INTEGER PRIMARY KEY, twice INTEGER GENERATED ALWAYS AS (id * 2) STORED);",
    );
    expect(auto).toEqual([]);
    expect(warnings).toEqual([
      `Table "t", column "twice": "GENERATED ALWAYS AS (id * 2) STORED" is not imported.`,
    ]);
  });
});

describe("data types the export writes read back", () => {
  it("auto_counter and a scale-only decimal", () => {
    // barwise-hgr and barwise-e5n: INTEGER read back as integer, and bare
    // DECIMAL read back with no scale. The precision 38 is the one loss
    // left, because SQL cannot state a scale without a precision.
    const original = new OrmYamlSerializer().deserialize(`
orm_version: "1.0"
model:
  name: Stock
  object_types:
    - id: ot-movement
      name: Movement
      kind: entity
      reference_mode: movement_id
    - id: ot-movement-id
      name: MovementId
      kind: value
      data_type: { name: auto_counter }
    - id: ot-dose
      name: DoseAmount
      kind: value
      data_type: { name: decimal, scale: 3 }
  fact_types:
    - id: ft-id
      name: Movement has MovementId
      roles:
        - { id: r1, player: ot-movement, role_name: has }
        - { id: r2, player: ot-movement-id, role_name: identifies }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r1] }
        - { type: internal_uniqueness, roles: [r2], is_preferred: true }
        - { type: mandatory, role: r1 }
    - id: ft-dose
      name: Movement has DoseAmount
      roles:
        - { id: r3, player: ot-movement, role_name: has }
        - { id: r4, player: ot-dose, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r3] }
`);
    const { text } = new DdlExportFormat().export(original, { annotate: false });
    expect(text).toContain("movement_id INTEGER GENERATED BY DEFAULT AS IDENTITY NOT NULL");
    expect(text).toContain("dose_amount DECIMAL(38,3)");
    const { model } = ddl.parse(text);
    expect(valueType(model, "MovementId")?.dataType).toEqual({ name: "auto_counter" });
    expect(valueType(model, "DoseAmount")?.dataType).toEqual({
      name: "decimal",
      length: 38,
      scale: 3,
    });
  });
});

describe("a table keyed on its foreign keys is an objectified relationship", () => {
  // Without an annotation (ddl-round-trip-fixed-point.spec.md, workstream 5;
  // the shape decided with the requester on 2026-10-07). It used to import
  // as an entity keyed on an invented `enrollment_id`, its key columns lost
  // (barwise-1077).
  const schema = `
    CREATE TABLE student (student_id INT PRIMARY KEY);
    CREATE TABLE course (course_id INT PRIMARY KEY);
    CREATE TABLE enrollment (
      student_id INT NOT NULL REFERENCES student (student_id),
      course_id INT NOT NULL REFERENCES course (course_id),
      grade VARCHAR(2),
      PRIMARY KEY (student_id, course_id)
    );`;

  it("the table is the entity, its key the relationship, its other columns attributes", () => {
    const { model, warnings } = ddl.parse(schema);
    expect(warnings).toEqual([]);
    const ft = model.getFactTypeByName("Student and Course enrollment");
    expect(ft?.readings.map((r) => r.template)).toEqual(["{0} and {1} have enrollment"]);
    expect(ft?.roles.map((r) => model.getObjectType(r.playerId)?.name)).toEqual([
      "Student",
      "Course",
    ]);
    expect(ft?.constraints.map((c) => [c.type, "roleIds" in c ? c.roleIds.length : 0])).toEqual([
      ["internal_uniqueness", 2],
    ]);
    const enrollment = model.getObjectTypeByName("Enrollment");
    expect(model.objectifiedFactTypes).toEqual([
      expect.objectContaining({ factTypeId: ft?.id, objectTypeId: enrollment?.id }),
    ]);
    expect(model.getFactTypeByName("Enrollment has Grade")).toBeDefined();
    // The key columns are roles of the relationship, not attributes.
    expect(model.getObjectTypeByName("StudentId")).toBeDefined(); // student's own key
    expect(
      model.factTypes.filter((f) => f.roles.some((r) => r.playerId === enrollment?.id)).map((f) =>
        f.name
      ),
    )
      .toEqual(["Enrollment has Grade"]);
  });

  it("three foreign keys name three roles", () => {
    const { model } = ddl.parse(`
      CREATE TABLE a (a_id INT PRIMARY KEY);
      CREATE TABLE b (b_id INT PRIMARY KEY);
      CREATE TABLE c (c_id INT PRIMARY KEY);
      CREATE TABLE booking (a_id INT REFERENCES a (a_id), b_id INT REFERENCES b (b_id),
        c_id INT REFERENCES c (c_id), PRIMARY KEY (a_id, b_id, c_id));`);
    expect(model.getFactTypeByName("A, B and C booking")?.readings.map((r) => r.template))
      .toEqual(["{0}, {1} and {2} have booking"]);
  });

  it("a key with a plain column is no relationship: an external uniqueness over its columns", () => {
    const { model, warnings } = ddl.parse(`
      CREATE TABLE student (student_id INT PRIMARY KEY);
      CREATE TABLE enrollment (student_id INT REFERENCES student (student_id), term VARCHAR(6),
        PRIMARY KEY (student_id, term));`);
    expect(model.objectifiedFactTypes).toEqual([]);
    expect(
      warnings.some((w) =>
        /composite PRIMARY KEY \(student_id, term\) is imported as an external uniqueness/.test(w)
      ),
    ).toBe(true);
    const external = model.factTypes.flatMap((f) => f.constraints)
      .filter((c) => c.type === "external_uniqueness");
    expect(external).toHaveLength(1);
  });

  it("a UNIQUE over a relationship column and an attribute spans the relationship's role", () => {
    // C03's policy_period: the policy number is unique within a term, and
    // the term is a role of the relationship the period objectifies, not a
    // binary of the period. It was dropped with a warning.
    const { model, warnings } = ddl.parse(`
      CREATE TABLE policy (policy_id INT PRIMARY KEY);
      CREATE TABLE term (term_number INT PRIMARY KEY);
      CREATE TABLE policy_period (
        policy_id INT NOT NULL REFERENCES policy (policy_id),
        term_number INT NOT NULL REFERENCES term (term_number),
        policy_number VARCHAR(20) NOT NULL,
        PRIMARY KEY (policy_id, term_number),
        UNIQUE (policy_number, term_number));`);
    expect(warnings).toEqual([]);
    const where = new Map(
      model.factTypes.flatMap((f) => f.roles.map((r, i) => [r.id, `${f.name}#${i}`] as const)),
    );
    const external = model.factTypes.flatMap((f) => f.constraints)
      .filter((c) => c.type === "external_uniqueness")
      .map((c) => c.roleIds.map((id) => where.get(id)));
    expect(external).toEqual([[
      "PolicyPeriod has PolicyNumber#1",
      "Policy and Term policy period#1",
    ]]);
  });

  it("reads a key over a quoted name with parentheses in it", () => {
    // The column list was read up to the first `)`, inside the quotes.
    const { model, warnings } = ddl.parse(`
      CREATE TABLE scan (scan_version TEXT PRIMARY KEY);
      CREATE TABLE finding ("(ambiguous)" TEXT PRIMARY KEY);
      CREATE TABLE scan_found (
        scan_version TEXT NOT NULL,
        "(ambiguous)" TEXT NOT NULL,
        PRIMARY KEY (scan_version, "(ambiguous)"),
        FOREIGN KEY (scan_version) REFERENCES scan (scan_version),
        FOREIGN KEY ("(ambiguous)") REFERENCES finding ("(ambiguous)"));`);
    expect(warnings).toEqual([]);
    expect(model.getFactTypeByName("Scan and Finding scan found")).toBeDefined();
  });
});
