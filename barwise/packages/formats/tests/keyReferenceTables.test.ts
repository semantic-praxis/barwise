/**
 * A table keyed on one column that also references another table imports
 * as a subtype of it when its name ends in the other's head noun and it
 * repeats none of the other's columns; any other such table keeps the
 * reading it had (key-reference-tables.spec.md, requirements 1-3 and 5).
 */
import { completenessWarnings, type OrmModel, ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddl = new DdlImportFormat();

/** Each subtype fact as "Sub < Super", with whether it identifies. */
function subtypes(model: OrmModel): string[] {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  return model.subtypeFacts
    .map((sf) =>
      `${name(sf.subtypeId)} < ${name(sf.supertypeId)}${
        sf.providesIdentification ? "" : " (not identifying)"
      }`
    )
    .sort();
}

const subject = `CREATE TABLE subject (subject_id INT PRIMARY KEY, birth_date DATE NOT NULL);`;

describe("a key that is also a reference to a table its name declares a kind of", () => {
  it("imports as an identifying subtype, reported, with no identifier of its own", () => {
    const sql = `${subject}
      CREATE TABLE enrolled_subject (
        subject_id INT PRIMARY KEY REFERENCES subject (subject_id),
        enrolled_on DATE NOT NULL);`;
    const { model, warnings } = ddl.parse(sql);
    expect(subtypes(model)).toEqual(["EnrolledSubject < Subject"]);
    expect(warnings.some((w) => /"enrolled_subject": imported as a subtype of "subject"/.test(w)))
      .toBe(true);
    expect(warnings.some((w) => /barwise-1078/.test(w))).toBe(false);
    // One identity source, not two (PR #620 review).
    expect(
      completenessWarnings(model).filter((d) =>
        d.ruleId === "completeness/conflicting-identification"
      ),
    ).toEqual([]);
    expect(new ValidationEngine().validate(model).filter((d) => d.severity === "error")).toEqual(
      [],
    );
  });

  it("chains: a subtype of a subtype", () => {
    const sql = `${subject}
      CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY REFERENCES subject (subject_id),
        enrolled_on DATE NOT NULL);
      CREATE TABLE randomized_subject (subject_id INT PRIMARY KEY
        REFERENCES enrolled_subject (subject_id), arm_code VARCHAR(4) NOT NULL);`;
    expect(subtypes(ddl.parse(sql).model)).toEqual([
      "EnrolledSubject < Subject",
      "RandomizedSubject < EnrolledSubject",
    ]);
  });

  it("matches the head noun up to number and case", () => {
    for (const child of ["enrolled_subjects", "ENROLLED_SUBJECT"]) {
      const sql = `CREATE TABLE SUBJECT (subject_id INT PRIMARY KEY);
        CREATE TABLE ${child} (subject_id INT PRIMARY KEY REFERENCES SUBJECT (subject_id),
          enrolled_on DATE NOT NULL);`;
      expect(ddl.parse(sql).model.subtypeFacts, child).toHaveLength(1);
    }
  });

  it("keeps a re-exported subtype, with and without annotations", () => {
    const sql = `${subject}
      CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY REFERENCES subject (subject_id),
        enrolled_on DATE NOT NULL);`;
    const first = ddl.parse(sql).model;
    for (const annotate of [true, false]) {
      const { text } = new DdlExportFormat().export(first, { annotate });
      // One column that is both key and foreign key.
      expect(text, `annotate: ${annotate}`).toMatch(
        /FOREIGN KEY \(subject_id\) REFERENCES subject/,
      );
      expect(subtypes(ddl.parse(text).model), `annotate: ${annotate}`).toEqual(subtypes(first));
    }
  });
});

describe("a key that is also a reference keeps today's reading", () => {
  const today = (sql: string, table: string) => {
    const { model, warnings } = ddl.parse(sql);
    expect(model.subtypeFacts).toEqual([]);
    expect(warnings.some((w) => w.includes(`"${table}": key column`) && /barwise-1078/.test(w)))
      .toBe(true);
  };

  it("when no name carries the parent's noun (C10's coded tables)", () => {
    today(
      `CREATE TABLE spriden (pidm INT PRIMARY KEY, last_name VARCHAR(60) NOT NULL);
       CREATE TABLE sgbstdn (pidm INT PRIMARY KEY REFERENCES spriden (pidm), levl_code CHAR(2));`,
      "sgbstdn",
    );
  });

  it("for an extension table and a one-to-one extension", () => {
    today(
      `CREATE TABLE pat (pat_id INT PRIMARY KEY, name VARCHAR(60));
       CREATE TABLE pat_2 (pat_id INT PRIMARY KEY REFERENCES pat (pat_id), x2_0 VARCHAR(20));`,
      "pat_2",
    );
    today(
      `CREATE TABLE users (id INT PRIMARY KEY, email VARCHAR(80));
       CREATE TABLE user_profiles (id INT PRIMARY KEY REFERENCES users (id), bio VARCHAR(400));`,
      "user_profiles",
    );
  });

  it("for a copy that repeats the parent's columns, one repeated column being enough", () => {
    const order =
      `CREATE TABLE "order" (order_id INT PRIMARY KEY, placed_on DATE, total DECIMAL(10,2));`;
    today(
      `${order} CREATE TABLE legacy_order (order_id INT PRIMARY KEY REFERENCES "order" (order_id),
         placed_on DATE, total DECIMAL(10,2));`,
      "legacy_order",
    );
    today(
      `${order} CREATE TABLE closed_order (order_id INT PRIMARY KEY REFERENCES "order" (order_id),
         total DECIMAL(10,2), closed_on DATE);`,
      "closed_order",
    );
  });

  it("for a name that ends in another word (SUBJECTIVE is not SUBJECT)", () => {
    today(
      `${subject} CREATE TABLE subjective (subject_id INT PRIMARY KEY
         REFERENCES subject (subject_id), score INT);`,
      "subjective",
    );
  });

  it("for a composite foreign key containing the key, and a reference to an alternate key", () => {
    today(
      `CREATE TABLE orders (tenant_id INT, order_id INT, code VARCHAR(10) UNIQUE,
         PRIMARY KEY (tenant_id, order_id));
       CREATE TABLE rush_orders (order_id INT PRIMARY KEY, tenant_id INT,
         FOREIGN KEY (tenant_id, order_id) REFERENCES orders (tenant_id, order_id));`,
      "rush_orders",
    );
    today(
      `CREATE TABLE orders (order_id INT PRIMARY KEY, code VARCHAR(10) UNIQUE);
       CREATE TABLE rush_orders (code VARCHAR(10) PRIMARY KEY REFERENCES orders (code),
         due_by DATE);`,
      "rush_orders",
    );
  });

  it("when the key column carries a second foreign key (mixed control)", () => {
    today(
      `${subject} CREATE TABLE audit (audit_id INT PRIMARY KEY);
       CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY, enrolled_on DATE,
         FOREIGN KEY (subject_id) REFERENCES subject (subject_id),
         FOREIGN KEY (subject_id) REFERENCES audit (audit_id));`,
      "enrolled_subject",
    );
  });

  it("when two parents qualify, importing neither and naming both", () => {
    const { model, warnings } = ddl.parse(
      `${subject} CREATE TABLE trial_subject (subject_id INT PRIMARY KEY);
       CREATE TABLE enrolled_subject (subject_id INT PRIMARY KEY, enrolled_on DATE,
         FOREIGN KEY (subject_id) REFERENCES subject (subject_id),
         FOREIGN KEY (subject_id) REFERENCES trial_subject (subject_id));`,
    );
    expect(model.subtypeFacts).toEqual([]);
    expect(warnings.some((w) => /references "subject", "trial_subject"/.test(w))).toBe(true);
  });
});

describe("the documented limit", () => {
  it("reads a same-noun table with facts of its own as a subtype, partition or not", () => {
    // ARCHIVED_ORDER: an archived order is an order with an archived-at, and
    // the DDL cannot say whether every order has a row here (a vertical
    // partition) or only some (a subtype). Read as a subtype either way;
    // key-reference-tables.spec.md records it as the residual false positive.
    const { model } = ddl.parse(
      `CREATE TABLE "order" (order_id INT PRIMARY KEY, placed_on DATE);
       CREATE TABLE archived_order (order_id INT PRIMARY KEY REFERENCES "order" (order_id),
         archived_at TIMESTAMP NOT NULL);`,
    );
    expect(subtypes(model)).toEqual(["ArchivedOrder < Order"]);
  });
});
