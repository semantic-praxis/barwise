/**
 * barwise's own DDL export keeps its subtypes through an annotated round
 * trip: the table line carries `supertypes`, the import reads it before
 * any naming rule, and checks each entry against the DDL
 * (key-reference-tables.spec.md, requirements 4, 4a, 4b and 5).
 */
import { completenessWarnings, OrmModel, OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();
const exportDdl = (model: OrmModel) => new DdlExportFormat().export(model, { annotate: true }).text;

/** Each subtype fact by names and every stored field. */
function subtypes(model: OrmModel) {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  return model.subtypeFacts.map((sf) => ({
    sub: name(sf.subtypeId),
    sup: name(sf.supertypeId),
    providesIdentification: sf.providesIdentification,
    isExclusive: sf.isExclusive,
    isExhaustive: sf.isExhaustive,
    definingRule: sf.definingRule,
  })).sort((a, b) => `${a.sub}<${a.sup}`.localeCompare(`${b.sub}<${b.sup}`));
}

const conflicts = (model: OrmModel) =>
  completenessWarnings(model).filter((d) => d.ruleId === "completeness/conflicting-identification");

function entity(model: OrmModel, name: string, referenceMode: string) {
  return model.addObjectType({ name, kind: "entity", referenceMode });
}

function attribute(model: OrmModel, owner: { id: string; name: string; }, value: string) {
  const v = model.addObjectType({
    name: value,
    kind: "value",
    dataType: { name: "text", length: 40 },
  });
  const a = `${owner.name}-${value}-a`;
  model.addFactType({
    name: `${owner.name} has ${value}`,
    roles: [{ id: a, name: "has", playerId: owner.id }, {
      id: `${a}-v`,
      name: "is of",
      playerId: v.id,
    }],
    readings: ["{0} has {1}"],
    constraints: [{ type: "internal_uniqueness", roleIds: [a] }],
  });
}

describe("barwise's own export keeps its subtypes, annotated", () => {
  it("identifying and non-identifying, whatever the table names say", () => {
    // Measured before this change: both subtype facts were lost (Employee's
    // person_id came back as a relationship, Manager's key warned as
    // barwise-1078). Neither name ends in its parent's noun.
    const path = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../examples/output/employee-hierarchy.orm.yaml",
    );
    const original = new OrmYamlSerializer().deserialize(readFileSync(path, "utf8"));
    const back = ddl.parse(exportDdl(original)).model;
    expect(subtypes(back)).toEqual(subtypes(original));
    expect(subtypes(back)).toHaveLength(2);
    expect(back.factTypes.some((f) => /Employee .* Person|Person .* Employee/.test(f.name)))
      .toBe(false);
    expect(conflicts(back)).toEqual([]);
  });

  it("every stored field, a two-column supertype key, and two supertypes", () => {
    const model = new OrmModel({ name: "m" });
    const person = entity(model, "Person", "person_id");
    const staff = entity(model, "Staff", "staff_id");
    const assistant = entity(model, "Assistant", "assistant_id");
    attribute(model, assistant, "Office");
    const policy = entity(model, "Policy", "policy_id");
    const term = entity(model, "Term", "term_id");
    const covers = model.addFactType({
      name: "Policy covers Term",
      roles: [{ id: "pc", name: "covers", playerId: policy.id }, {
        id: "pt",
        name: "is covered by",
        playerId: term.id,
      }],
      readings: ["{0} covers {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["pc", "pt"] }],
    });
    const period = entity(model, "PolicyPeriod", "policy_period_id");
    model.addObjectifiedFactType({ factTypeId: covers.id, objectTypeId: period.id });
    const lapsed = entity(model, "LapsedPeriod", "lapsed_period_id");
    attribute(model, lapsed, "LapsedOn");
    model.addSubtypeFact({
      subtypeId: lapsed.id,
      supertypeId: period.id,
      providesIdentification: true,
    });
    model.addSubtypeFact({
      subtypeId: assistant.id,
      supertypeId: person.id,
      providesIdentification: true,
      isExclusive: true,
      isExhaustive: true,
      definingRule: { kind: "derived", expression: "each Person who assists a course" },
    });
    model.addSubtypeFact({
      subtypeId: assistant.id,
      supertypeId: staff.id,
      providesIdentification: false,
    });

    const text = exportDdl(model);
    // The two-column key is referenced through both columns.
    expect(text).toMatch(
      /"supertypes":\[\{"entity":"PolicyPeriod","columns":\["[a-z_]+","[a-z_]+"\]/,
    );
    expect(subtypes(ddl.parse(text).model)).toEqual(subtypes(model));
  });

  it("an identifying subtype the mapper writes as a non-key foreign key comes back identifying", () => {
    // Objectification wins over an identifying subtype fact for the key
    // (RelationalMapper's precedence branch), so the link is a non-key
    // column; providesIdentification must be read, not derived (PR #620
    // review).
    const model = new OrmModel({ name: "m" });
    const student = entity(model, "Student", "student_id");
    const course = entity(model, "Course", "course_id");
    const registration = entity(model, "Registration", "registration_id");
    const takes = model.addFactType({
      name: "Student takes Course",
      roles: [{ id: "ts", name: "takes", playerId: student.id }, {
        id: "tc",
        name: "is taken by",
        playerId: course.id,
      }],
      readings: ["{0} takes {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["ts", "tc"] }],
    });
    const enrollment = entity(model, "Enrollment", "enrollment_id");
    model.addObjectifiedFactType({ factTypeId: takes.id, objectTypeId: enrollment.id });
    model.addSubtypeFact({
      subtypeId: enrollment.id,
      supertypeId: registration.id,
      providesIdentification: true,
    });
    const text = exportDdl(model);
    expect(text).toMatch(/"providesIdentification":true/);
    expect(subtypes(ddl.parse(text).model)).toEqual(subtypes(model));
  });
});

describe("an annotation is used only while it describes the DDL", () => {
  const original = () => {
    const model = new OrmModel({ name: "m" });
    const person = entity(model, "Person", "person_id");
    const staff = entity(model, "Staff", "staff_id");
    const assistant = entity(model, "Assistant", "assistant_id");
    attribute(model, assistant, "Office");
    model.addSubtypeFact({
      subtypeId: assistant.id,
      supertypeId: person.id,
      providesIdentification: false,
    });
    model.addSubtypeFact({
      subtypeId: assistant.id,
      supertypeId: staff.id,
      providesIdentification: false,
    });
    return model;
  };

  it("drops a stale entry alone, with a warning, and keeps the other", () => {
    const text = exportDdl(original());
    const fk = /,?\n\s*FOREIGN KEY \(person_id\) REFERENCES person \(person_id\)/;
    expect(text).toMatch(fk);
    const { model, warnings } = ddl.parse(text.replace(fk, ""));
    expect(subtypes(model).map((s) => `${s.sub}<${s.sup}`)).toEqual(["Assistant<Staff"]);
    expect(warnings.some((w) => /subtype of "Person" through \(person_id\)/.test(w))).toBe(true);
  });

  it("falls back to the naming rule when every entry is stale", () => {
    const sql = `CREATE TABLE subject (subject_id INT PRIMARY KEY);
-- barwise:v1 {"kind":"table","table":"enrolled_subject","entity":"EnrolledSubject","referenceMode":"subject_id","supertypes":[{"entity":"Trial","columns":["trial_id"],"providesIdentification":false,"isExclusive":false,"isExhaustive":false}]}
CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY REFERENCES subject (subject_id),
  enrolled_on DATE NOT NULL);`;
    const { model, warnings } = ddl.parse(sql);
    expect(subtypes(model).map((s) => `${s.sub}<${s.sup}`)).toEqual(["EnrolledSubject<Subject"]);
    expect(warnings.some((w) => /subtype of "Trial"/.test(w))).toBe(true);
  });

  it("a supertype named twice is imported once, with a warning, not an aborted import", () => {
    // The model refuses a second identical subtype fact (PR #623 review).
    const entry =
      `{"entity":"Subject","columns":["subject_id"],"providesIdentification":true,"isExclusive":false,"isExhaustive":false}`;
    const sql = `CREATE TABLE subject (subject_id INT PRIMARY KEY);
-- barwise:v1 {"kind":"table","table":"enrolled_subject","entity":"EnrolledSubject","referenceMode":"subject_id","supertypes":[${entry},${entry}]}
CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY REFERENCES subject (subject_id),
  enrolled_on DATE NOT NULL);`;
    const { model, warnings } = ddl.parse(sql);
    expect(subtypes(model).map((s) => `${s.sub}<${s.sup}`)).toEqual(["EnrolledSubject<Subject"]);
    expect(warnings.some((w) => /names "Subject" as a supertype more than once/.test(w))).toBe(
      true,
    );
  });

  it("a defining rule the model cannot hold makes the line unreadable", () => {
    // Only the expression was checked, so a rule with no kind was stored
    // and verbalized as derived (PR #623 review).
    const line = (rule: string) =>
      `CREATE TABLE subject (subject_id INT PRIMARY KEY);
-- barwise:v1 {"kind":"table","table":"enrolled_subject","entity":"EnrolledSubject","referenceMode":"subject_id","supertypes":[{"entity":"Subject","columns":["subject_id"],"providesIdentification":true,"isExclusive":false,"isExhaustive":false,"definingRule":${rule}}]}
CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY REFERENCES subject (subject_id),
  enrolled_on DATE NOT NULL);`;
    const good = ddl.parse(line(`{"kind":"derived","expression":"enrolled"}`));
    expect(subtypes(good.model)[0]?.definingRule).toEqual({
      kind: "derived",
      expression: "enrolled",
    });
    for (
      const bad of [
        `{"expression":"enrolled"}`,
        `{"kind":"maybe","expression":"enrolled"}`,
        `{"kind":"derived","storage":"sometimes","expression":"enrolled"}`,
        `{"kind":"derived","isFormal":"yes","expression":"enrolled"}`,
      ]
    ) {
      const { model, warnings } = ddl.parse(line(bad));
      expect(warnings.some((w) => /has an unknown shape; ignored/.test(w)), bad).toBe(true);
      // The naming rule reads the table instead, with no rule.
      expect(subtypes(model).map((s) => s.definingRule), bad).toEqual([undefined]);
    }
  });

  it("an empty list says no subtype, so the naming rule invents none", () => {
    // The same-noun vertical partition the naming rule would read as a
    // subtype, written by barwise with an explicit empty list.
    const table = (line: string) =>
      `CREATE TABLE "order" (order_id INT PRIMARY KEY, placed_on DATE);
${line}CREATE TABLE archived_order (order_id INT PRIMARY KEY REFERENCES "order" (order_id),
  archived_at TIMESTAMP NOT NULL);`;
    const line =
      `-- barwise:v1 {"kind":"table","table":"archived_order","entity":"ArchivedOrder","referenceMode":"order_id","supertypes":[]}\n`;
    expect(ddl.parse(table(line)).model.subtypeFacts).toEqual([]);
    // An older line, without the field, leaves the naming rule to decide.
    const older =
      `-- barwise:v1 {"kind":"table","table":"archived_order","entity":"ArchivedOrder","referenceMode":"order_id"}\n`;
    expect(ddl.parse(table(older)).model.subtypeFacts).toHaveLength(1);
  });
});
