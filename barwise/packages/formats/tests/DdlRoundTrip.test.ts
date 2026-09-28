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
