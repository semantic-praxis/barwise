/**
 * The machine-readable comment a DDL export writes and the DDL import reads
 * back (ddl-round-trip-fixed-point.spec.md, workstream 4).
 */
import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  type ColumnAnnotation,
  readAnnotations,
  type Relationship,
  renderAnnotation,
  type TableAnnotation,
} from "../src/ddl/barwiseAnnotation.js";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const repo = fileURLToPath(new URL("../../../", import.meta.url));

/** Every model the round trip is pinned over: the trial kernels and the examples. */
function corpus(): { name: string; model: OrmModel; }[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (entry.endsWith(".orm.yaml")) files.push(path);
    }
  };
  walk(join(repo, "examples"));
  for (const customer of readdirSync(join(repo, "trial/customers"))) {
    files.push(join(repo, "trial/customers", customer, "kernel.orm.yaml"));
  }
  const serializer = new OrmYamlSerializer();
  return files.map((path) => ({
    name: path.slice(repo.length),
    model: serializer.deserialize(readFileSync(path, "utf8")),
  }));
}

describe("the annotation line", () => {
  it("carries a definition with a quote, a colon and a newline on one line", () => {
    const table: TableAnnotation = {
      kind: "table",
      table: "patient",
      entity: "Patient",
      referenceMode: "mrn",
      definition: 'A person: "registered"\nat the clinic.',
    };
    const line = renderAnnotation(table);
    expect(line).not.toContain("\n");
    const warnings: string[] = [];
    expect(
      readAnnotations(`${line}\nCREATE TABLE patient (mrn TEXT);`, warnings).tables.get("patient"),
    )
      .toEqual(table);
    expect(warnings).toEqual([]);
  });

  it("names a line it cannot read, and reads the rest", () => {
    const column: ColumnAnnotation = {
      kind: "column",
      table: "t",
      column: "c",
      factType: "T has C",
      readings: ["{0} has {1}"],
      roles: [{ name: "has", player: "T" }, { name: "is of", player: "C" }],
      rowRole: 0,
    };
    const warnings: string[] = [];
    const read = readAnnotations(
      [
        "-- barwise:v1 {not json",
        '-- barwise:v1 {"kind":"column","table":"t"}',
        `  ${renderAnnotation(column)}`,
      ].join("\n"),
      warnings,
    );
    expect(read.columns.get("t.c")).toEqual(column);
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toMatch(/is not JSON/);
    expect(warnings[1]).toMatch(/unknown shape/);
  });

  it("names a version it does not read, rather than taking the line for plain DDL", () => {
    // PR #589 review: a v2 line missed the v1 prefix and was skipped in silence.
    const warnings: string[] = [];
    const read = readAnnotations('-- barwise:v2 {"kind":"table"}', warnings);
    expect(read.tables.size).toBe(0);
    expect(warnings).toEqual([
      `Annotation version v2 is not one this importer reads (v1); "-- barwise:v2 {"kind":"table"}" ignored.`,
    ]);
  });

  it("refuses a line the model could not build: an empty name, or a reading missing a role", () => {
    // PR #589 review: these passed the shape check, and the fact type's
    // constructor then threw and aborted the whole import.
    const base: ColumnAnnotation = {
      kind: "column",
      table: "t",
      column: "c",
      factType: "T has C",
      readings: ["{0} has {1}"],
      roles: [{ name: "has", player: "T" }, { name: "is of", player: "C" }],
      rowRole: 0,
    };
    for (
      const bad of [
        { ...base, factType: "" },
        { ...base, readings: ["{0} has"] },
        { ...base, roles: [{ name: "", player: "T" }, base.roles[1]] },
      ]
    ) {
      const warnings: string[] = [];
      expect(readAnnotations(renderAnnotation(bad as ColumnAnnotation), warnings).columns.size)
        .toBe(0);
      expect(warnings).toHaveLength(1);
    }
    // And end to end: the import finishes and guesses for the column.
    const { model, warnings } = new DdlImportFormat().parse(`
      CREATE TABLE t (t_id INT PRIMARY KEY,
        ${renderAnnotation({ ...base, readings: ["{0} has"] } as ColumnAnnotation)}
        c VARCHAR(9));`);
    expect(warnings.some((w) => /unknown shape/.test(w))).toBe(true);
    expect(model.getFactTypeByName("T has C")).toBeDefined();
  });
});

describe("the importer reads the export's annotations", () => {
  const source = `
orm_version: "1.0"
model:
  name: Clinic
  object_types:
    - id: ot-patient
      name: Patient
      kind: entity
      reference_mode: mrn
      definition: A person registered at the clinic.
    - id: ot-doctor
      name: Doctor
      kind: entity
      reference_mode: provider_id
    - id: ot-mrn
      name: MedicalRecordNumber
      kind: value
      data_type: { name: text, length: 20 }
      definition: The number assigned at registration.
    - id: ot-provider
      name: ProviderId
      kind: value
      data_type: { name: text, length: 20 }
    - id: ot-allergy
      name: AllergyNote
      kind: value
      data_type: { name: text }
  fact_types:
    - id: ft-mrn
      name: Patient is identified by MedicalRecordNumber
      roles:
        - { id: r1, player: ot-patient, role_name: is identified by }
        - { id: r2, player: ot-mrn, role_name: identifies }
      readings: ["{0} is identified by {1}", "{1} identifies {0}"]
      constraints:
        - { type: internal_uniqueness, roles: [r1] }
        - { type: internal_uniqueness, roles: [r2], is_preferred: true }
        - { type: mandatory, role: r1 }
    - id: ft-provider
      name: Doctor has ProviderId
      roles:
        - { id: r3, player: ot-doctor, role_name: has }
        - { id: r4, player: ot-provider, role_name: identifies }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r3] }
        - { type: internal_uniqueness, roles: [r4], is_preferred: true }
        - { type: mandatory, role: r3 }
    - id: ft-primary
      name: Doctor is primary for Patient
      definition: The doctor a patient sees first.
      roles:
        - { id: r5, player: ot-doctor, role_name: is primary for }
        - { id: r6, player: ot-patient, role_name: sees first }
      readings: ["{0} is primary for {1}", "{1} sees {0} first"]
      constraints:
        - { type: internal_uniqueness, roles: [r6] }
    - id: ft-allergy
      name: Patient reports AllergyNote
      roles:
        - { id: r7, player: ot-patient, role_name: reports }
        - { id: r8, player: ot-allergy, role_name: is reported by }
      readings: ["{0} reports {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r7] }
`;
  const original = new OrmYamlSerializer().deserialize(source);
  const ddl = new DdlImportFormat();

  it("names, readings, role names and definitions come back; without annotations they are guessed", () => {
    const annotated = new DdlExportFormat().export(original).text;
    const { model, warnings } = ddl.parse(annotated);
    expect(warnings).toEqual([]);
    const patient = model.getObjectTypeByName("Patient");
    expect(patient).toMatchObject({ kind: "entity", referenceMode: "mrn" });
    expect(patient?.definition).toBe("A person registered at the clinic.");
    expect(model.getObjectTypeByName("MedicalRecordNumber")?.definition)
      .toBe("The number assigned at registration.");

    // A foreign key whose fact type puts the referenced entity's role first.
    const primary = model.getFactTypeByName("Doctor is primary for Patient");
    expect(primary?.definition).toBe("The doctor a patient sees first.");
    expect(primary?.readings.map((r) => r.template)).toEqual([
      "{0} is primary for {1}",
      "{1} sees {0} first",
    ]);
    expect(primary?.roles.map((r) => [r.name, model.getObjectType(r.playerId)?.name])).toEqual([
      ["is primary for", "Doctor"],
      ["sees first", "Patient"],
    ]);
    // The uniqueness the DDL states sits on the patient's role, as before.
    expect(primary?.constraints.map(({ type, ...c }) => [type, "roleIds" in c ? c.roleIds : []]))
      .toEqual([["internal_uniqueness", [primary!.roles[1]!.id]]]);
    expect(model.getFactTypeByName("Patient reports AllergyNote")?.roles.map((r) => r.name))
      .toEqual(["reports", "is reported by"]);
    expect(model.getFactTypeByName("Patient is identified by MedicalRecordNumber")).toBeDefined();

    // The same file without annotations reads as before: names from columns.
    const plain = ddl.parse(new DdlExportFormat().export(original, { annotate: false }).text).model;
    expect(plain.getFactTypeByName("Doctor is primary for Patient")).toBeUndefined();
    expect(plain.getObjectTypeByName("Patient")?.definition).toBeUndefined();
  });

  it("names an annotation whose column a hand edit renamed, and guesses for the column", () => {
    const edited = new DdlExportFormat().export(original).text.replaceAll(
      "allergy_note",
      "allergy_text",
    )
      .replace('"column":"allergy_text"', '"column":"allergy_note"');
    const { model, warnings } = ddl.parse(edited);
    expect(warnings).toEqual([
      `The annotation for column "patient.allergy_note" matches nothing in the file; ignored.`,
    ]);
    expect(model.getFactTypeByName("Patient reports AllergyNote")).toBeUndefined();
    expect(model.getFactTypeByName("Patient has AllergyText")).toBeDefined();
  });

  it("sets aside a column annotation the table no longer matches, and says so", () => {
    // The foreign key was repointed by hand; the annotation still names B.
    const line = renderAnnotation({
      kind: "column",
      table: "a",
      column: "b_id",
      factType: "A belongs to B",
      readings: ["{0} belongs to {1}"],
      roles: [{ name: "belongs to", player: "A" }, { name: "has", player: "B" }],
      rowRole: 0,
    });
    const { model, warnings } = ddl.parse(`
      CREATE TABLE b (b_id INT PRIMARY KEY);
      CREATE TABLE c (b_id INT PRIMARY KEY);
      CREATE TABLE a (a_id INT PRIMARY KEY,
        ${line}
        b_id INT REFERENCES c (b_id));`);
    expect(warnings).toEqual([
      `Table "a", column "b_id": the annotation no longer matches (it references "B", not "C"); `
      + `names are guessed from the column instead.`,
    ]);
    expect(model.getFactTypeByName("A belongs to B")).toBeUndefined();
  });
});

describe("what the annotations do not trust", () => {
  it("annotates a table whose quoted name doubles a quote", () => {
    // PR #589 review: the exporter looked the table up by its quoted
    // spelling, so a name with a double quote got no annotations at all.
    const model = new OrmYamlSerializer().deserialize(`
orm_version: "1.0"
model:
  name: Q
  object_types:
    - { id: ot-a, name: 'Say"Hi', kind: entity, reference_mode: code }
    - { id: ot-code, name: Code, kind: value, data_type: { name: text, length: 9 } }
  fact_types:
    - id: ft-code
      name: Say"Hi has Code
      roles:
        - { id: r1, player: ot-a, role_name: has }
        - { id: r2, player: ot-code, role_name: identifies }
      readings: ["{0} has {1}"]
      constraints:
        - { type: internal_uniqueness, roles: [r1] }
        - { type: internal_uniqueness, roles: [r2], is_preferred: true }
        - { type: mandatory, role: r1 }
`);
    const text = new DdlExportFormat().export(model).text;
    const read = readAnnotations(text, []);
    expect([...read.tables.values()].map((t) => t.entity)).toEqual(['Say"Hi']);
    expect(read.columns.size).toBe(1);
  });

  it("sets aside an annotation whose value type name an entity holds", () => {
    // PR #589 review: the claim fell back to "TCode" while the fact type
    // kept the annotation's name and readings for "Code".
    const line = renderAnnotation({
      kind: "column",
      table: "t",
      column: "code",
      factType: "T has Code",
      readings: ["{0} has {1}"],
      roles: [{ name: "has", player: "T" }, { name: "is of", player: "Code" }],
      rowRole: 0,
    });
    const { model, warnings } = new DdlImportFormat().parse(`
      CREATE TABLE code (code_id INT PRIMARY KEY);
      CREATE TABLE t (t_id INT PRIMARY KEY,
        ${line}
        code VARCHAR(9));`);
    expect(warnings).toContain(
      `Table "t", column "code": the annotation no longer matches ("Code" is held by entity type "Code", `
        + `which it cannot share); names are guessed from the column instead.`,
    );
    expect(model.getFactTypeByName("T has Code")).toBeUndefined();
    expect(model.getFactTypeByName("T has TCode")).toBeDefined();
  });
});

describe("a fact-type table's line", () => {
  const ddl = new DdlImportFormat();
  const line = (players: [string, string]) =>
    renderAnnotation({
      kind: "factTable",
      table: "membership",
      factType: "Person belongs to Club",
      readings: ["{0} belongs to {1}"],
      roles: [
        { name: "belongs to", player: players[0], columns: ["person_id"] },
        { name: "has member", player: players[1], columns: ["club_id"] },
      ],
    });
  const schema = (annotation: string) => `
    CREATE TABLE person (person_id INT PRIMARY KEY);
    CREATE TABLE club (club_id INT PRIMARY KEY);
    ${annotation}
    CREATE TABLE membership (person_id INT REFERENCES person (person_id),
      club_id INT REFERENCES club (club_id), PRIMARY KEY (person_id, club_id));`;

  it("makes the table its fact type, not an entity", () => {
    const { model, warnings } = ddl.parse(schema(line(["Person", "Club"])));
    expect(warnings).toEqual([]);
    expect(model.getObjectTypeByName("Membership")).toBeUndefined();
    const ft = model.getFactTypeByName("Person belongs to Club");
    expect(ft?.roles.map((r) => r.name)).toEqual(["belongs to", "has member"]);
    expect(model.objectifiedFactTypes).toEqual([]);
  });

  it("is set aside when its players no longer match the foreign keys, and says so", () => {
    const { model, warnings } = ddl.parse(schema(line(["Person", "Society"])));
    expect(warnings).toContain(
      `Table "membership": the annotation no longer matches (role "has member" references "Club", `
        + `not "Society"); it is imported as an entity.`,
    );
    expect(model.getFactTypeByName("Person belongs to Club")).toBeUndefined();
    // As an entity, it is then keyed on its foreign keys: a guessed relationship.
    expect(model.getFactTypeByName("Person and Club membership")).toBeDefined();
  });
});

describe("over the trial kernels and the examples", () => {
  it("every annotated element reads back as it was written", () => {
    let checked = 0;
    for (const { name, model: original } of corpus()) {
      const text = new DdlExportFormat().export(original).text;
      const { columns, tables } = readAnnotations(text, []);
      const { model, warnings } = new DdlImportFormat().parse(text);
      // No line the export wrote is stale against the file it wrote.
      expect(warnings.filter((w) => /no longer matches|matches nothing/.test(w)), name).toEqual([]);
      const relationshipBack = (r: Relationship, label: string) => {
        const ft = model.getFactTypeByName(r.factType);
        expect(ft, `${name}: ${label} ${r.factType}`).toBeDefined();
        expect(ft?.readings.map((x) => x.template), `${name}: ${r.factType}`).toEqual(r.readings);
        expect(ft?.roles.map((x) => [x.name, model.getObjectType(x.playerId)?.name]))
          .toEqual(r.roles.map((x) => [x.name, x.player]));
        expect(ft?.definition, `${name}: ${r.factType}`).toBe(r.definition);
        return ft;
      };
      for (const a of tables.values()) {
        if (a.kind === "factTable") {
          relationshipBack(a, "fact-type table");
          checked++;
          continue;
        }
        const entity = model.getObjectTypeByName(a.entity);
        expect(entity, `${name}: entity ${a.entity}`).toBeDefined();
        expect(entity?.definition, `${name}: ${a.entity}`).toBe(a.definition);
        if (a.objectifies) {
          const ft = relationshipBack(a.objectifies, "objectified");
          expect(
            model.objectifiedFactTypes.some((o) =>
              o.factTypeId === ft?.id && o.objectTypeId === entity?.id
            ),
            `${name}: ${a.entity} objectifies ${a.objectifies.factType}`,
          ).toBe(true);
        }
        checked++;
      }
      for (const a of columns.values()) {
        const ft = model.getFactTypeByName(a.factType);
        expect(ft, `${name}: fact type ${a.factType}`).toBeDefined();
        expect(ft?.readings.map((r) => r.template), `${name}: ${a.factType}`).toEqual(a.readings);
        expect(
          ft?.roles.map((r) => ({ name: r.name, player: model.getObjectType(r.playerId)?.name })),
        )
          .toEqual(a.roles);
        expect(ft?.definition, `${name}: ${a.factType}`).toBe(a.definition);
        if (a.valueDefinition !== undefined) {
          expect(model.getObjectTypeByName(a.roles[1 - a.rowRole]!.player)?.definition)
            .toBe(a.valueDefinition);
        }
        checked++;
      }
    }
    // The corpus must exercise the format, not pass by being empty.
    expect(checked).toBeGreaterThan(500);
  });
});
