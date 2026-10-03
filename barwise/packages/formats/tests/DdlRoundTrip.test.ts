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
