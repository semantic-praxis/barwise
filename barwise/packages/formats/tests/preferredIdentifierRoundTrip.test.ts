/**
 * A DDL round trip keeps each entity's stored preferred identifier
 * (annotation-preferred-identifier.spec.md). Before, 42 entities in the
 * tracked models came back from an annotated round trip with none: the
 * import stored an identifier only for a one-column key, and nothing named
 * an identifier the key does not state.
 */
import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { readAnnotations } from "../src/ddl/barwiseAnnotation.js";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ROOT = resolve(import.meta.dirname, "../../..");

/**
 * Every tracked model. Asked of git, not the file tree: a checkout holds
 * hundreds of untracked trial outputs that CI never sees.
 */
function models(): string[] {
  return execFileSync("git", ["ls-files", "--", "*.orm.yaml"], { cwd: ROOT })
    .toString().trim().split("\n").map((f) => resolve(ROOT, f));
}

/**
 * Each entity's stored preferred identifier, without ids: per constrained
 * role, its fact type's players and its own player.
 */
function identifiers(model: OrmModel): Map<string, string> {
  const name = (id: string) => model.getObjectType(id)?.name ?? "?";
  const out = new Map<string, string>();
  for (const [entityId, constraintId] of model.preferredIdentifierRefs) {
    const c = model.getConstraint(constraintId);
    if (!c || !("roleIds" in c)) continue;
    const roles = c.roleIds.map((roleId) => {
      const ft = model.factTypes.find((f) => f.roles.some((r) => r.id === roleId))!;
      const role = ft.roles.find((r) => r.id === roleId)!;
      return `${ft.roles.map((r) => name(r.playerId)).join("/")}:${name(role.playerId)}`;
    }).sort();
    out.set(name(entityId), `${c.type} ${roles.join(", ")}`);
  }
  return out;
}

const load = (file: string): OrmModel | undefined => {
  try {
    return new OrmYamlSerializer().deserialize(readFileSync(file, "utf8"));
  } catch {
    // A fixture the serializer refuses has nothing to round-trip.
    return undefined;
  }
};

const ddl = (model: OrmModel, options?: Record<string, unknown>) =>
  new DdlExportFormat().export(model, options).text;
const parse = (text: string) => new DdlImportFormat().parse(text);

describe("an annotated DDL round trip keeps every stored preferred identifier", () => {
  const found = models().map((f) => [f, load(f)] as const).filter(([, m]) => m !== undefined);
  it("finds the corpus", () => expect(found.length).toBeGreaterThan(80));
  for (const [file, model] of found) {
    const before = identifiers(model!);
    if (before.size === 0) continue;
    it(file.slice(ROOT.length + 1), () => {
      const after = identifiers(parse(ddl(model!)).model);
      for (const [entity, identifier] of before) {
        expect([entity, after.get(entity)]).toEqual([entity, identifier]);
      }
    });
  }
});

const C05 = resolve(ROOT, "trial/customers/C05-manufacturer/kernel.orm.yaml");
const NQD = resolve(ROOT, "trial/findings/barwise-nqd/base.orm.yaml");
const tableLine = (text: string, table: string) =>
  readAnnotations(text, []).tables.get(table) as { identifiedBy?: readonly string[]; } | undefined;

describe("the table line names an identifier the key does not state", () => {
  it("names an objectifier's value identifier, written as a UNIQUE", () => {
    expect(tableLine(ddl(load(C05)!), "work_order")?.identifiedBy).toEqual(["work_order_number"]);
  });

  it("names a subtype's own identifier when its key is the identifying supertype link", () => {
    const text = ddl(load(NQD)!);
    expect(tableLine(text, "purchase_order_item")?.identifiedBy).toEqual([
      "purchase_order_item_id",
    ]);
    const { model: back, warnings } = parse(text);
    // The key's reference is the subtype fact, imported: nothing to say.
    expect(warnings.filter((w) => w.includes("purchase_order_item"))).toEqual([]);
    expect(identifiers(back).get("PurchaseOrderItem")).toBe(
      "internal_uniqueness PurchaseOrderItem/PurchaseOrderItemId:PurchaseOrderItemId",
    );
  });

  it("names nothing a plain key states", () => {
    const text = ddl(load(C05)!);
    const named = [...readAnnotations(text, []).tables.values()]
      .filter((l) => "identifiedBy" in l && l.identifiedBy !== undefined)
      .map((l) => l.table);
    // The one identifier in C05 that is not its table's key.
    expect(named).toEqual(["work_order"]);
  });

  it("names nothing on a dialect that writes no UNIQUE, which reports the uniqueness as spilled", () => {
    expect(tableLine(ddl(load(C05)!, { dialect: "bigquery" }), "work_order")?.identifiedBy)
      .toBeUndefined();
  });
});

describe("the import reads the key's uniqueness as the identifier", () => {
  it("leaves a key that is one composite foreign key unpreferred, as the export keys it apart", () => {
    const { model } = parse(`
      CREATE TABLE order_line (order_id INTEGER, line_nr INTEGER, PRIMARY KEY (order_id, line_nr));
      CREATE TABLE shipment (
        order_id INTEGER NOT NULL,
        line_nr INTEGER NOT NULL,
        shipped_on DATE,
        PRIMARY KEY (order_id, line_nr),
        FOREIGN KEY (order_id, line_nr) REFERENCES order_line (order_id, line_nr)
      );
    `);
    expect(identifiers(model).get("Shipment")).toBeUndefined();
  });

  it("says when the line names another identifier than a composite key's", () => {
    const line = `-- barwise:v1 ${
      JSON.stringify({
        kind: "table",
        table: "enrollment",
        entity: "Enrollment",
        referenceMode: "enrollment_id",
        supertypes: [],
        identifiedBy: ["code"],
      })
    }`;
    const { model, warnings } = parse(`${line}
      CREATE TABLE enrollment (
        student_nr INTEGER NOT NULL,
        course_nr INTEGER NOT NULL,
        code TEXT NOT NULL,
        PRIMARY KEY (student_nr, course_nr),
        UNIQUE (code)
      );`);
    expect(identifiers(model).get("Enrollment")).toBe("internal_uniqueness Enrollment/Code:Code");
    expect(warnings).toEqual([
      `Table "enrollment": composite PRIMARY KEY (student_nr, course_nr) is imported as an external `
      + `uniqueness over its columns, not its preferred identifier: the annotation names another.`,
    ]);
  });

  it("prefers an objectified relationship's uniqueness over its key, from plain DDL", () => {
    const { model } = parse(`
      CREATE TABLE student (student_id INTEGER PRIMARY KEY);
      CREATE TABLE course (course_id INTEGER PRIMARY KEY);
      CREATE TABLE enrollment (
        student_id INTEGER NOT NULL REFERENCES student (student_id),
        course_id INTEGER NOT NULL REFERENCES course (course_id),
        PRIMARY KEY (student_id, course_id)
      );
      -- Referenced, so the composite reading takes it as an objectified relationship.
      CREATE TABLE grade (
        grade_id INTEGER PRIMARY KEY,
        student_id INTEGER NOT NULL,
        course_id INTEGER NOT NULL,
        FOREIGN KEY (student_id, course_id) REFERENCES enrollment (student_id, course_id)
      );
    `);
    expect(model.objectifiedFactTypes).toHaveLength(1);
    const entity = model.getObjectType(model.objectifiedFactTypes[0]!.objectTypeId)!;
    expect(identifiers(model).get(entity.name)).toMatch(
      /^internal_uniqueness .*Student.*, .*Course/,
    );
  });
});

/** A person table whose line names `identifiedBy`, with the warnings the import gave. */
function person(identifiedBy: unknown, extra = "") {
  const line = `-- barwise:v1 ${
    JSON.stringify({
      kind: "table",
      table: "person",
      entity: "Person",
      referenceMode: "person_id",
      definition: "Someone.",
      supertypes: [],
      identifiedBy,
    })
  }`;
  return parse(`${line}
CREATE TABLE person (
  person_id INTEGER PRIMARY KEY,
  email TEXT NOT NULL,
  nickname TEXT NOT NULL,
  UNIQUE (email)${extra}
);`);
}

describe("the import reads identifiedBy", () => {
  it("makes the named uniqueness the identifier", () => {
    const { model, warnings } = person(["email"]);
    expect(identifiers(model).get("Person")).toBe("internal_uniqueness Person/Email:Email");
    expect(warnings).toEqual([]);
  });

  it.each([[[]], [["email", "email"]], [[3]], ["email"]])(
    "drops a malformed field (%j) and keeps the rest of the line",
    (bad) => {
      const { model, warnings } = person(bad);
      // The line's definition survives, and the key stays the identifier.
      expect(model.getObjectTypeByName("Person")?.definition).toBe("Someone.");
      expect(identifiers(model).get("Person")).toBe("internal_uniqueness Person/PersonId:PersonId");
      expect(warnings).toEqual([
        `Table "person": the annotation's identifiedBy is not a list of distinct column names; `
        + `ignored (annotation-preferred-identifier.spec.md).`,
      ]);
    },
  );

  it("warns and keeps the key when the columns read as no uniqueness", () => {
    const { model, warnings } = person(["nickname"]);
    expect(identifiers(model).get("Person")).toBe("internal_uniqueness Person/PersonId:PersonId");
    expect(warnings).toEqual([
      `Table "person": the annotation names the entity's identifier as (nickname), which reads as `
      + `no uniqueness that identifies it; the identifier is kept as imported `
      + `(annotation-preferred-identifier.spec.md).`,
    ]);
  });

  it("refuses part of a composite foreign key, as step 3b refuses it", () => {
    const line = `-- barwise:v1 ${
      JSON.stringify({
        kind: "table",
        table: "shipment",
        entity: "Shipment",
        referenceMode: "shipment_id",
        supertypes: [],
        identifiedBy: ["order_id"],
      })
    }`;
    const { warnings } = parse(`
      CREATE TABLE order_line (order_id INTEGER, line_nr INTEGER, PRIMARY KEY (order_id, line_nr));
      ${line}
      CREATE TABLE shipment (
        shipment_id INTEGER PRIMARY KEY,
        order_id INTEGER NOT NULL,
        line_nr INTEGER NOT NULL,
        FOREIGN KEY (order_id, line_nr) REFERENCES order_line (order_id, line_nr),
        UNIQUE (order_id, line_nr)
      );
    `);
    expect(warnings).toContain(
      `Table "shipment": the annotation names the entity's identifier as (order_id), which covers `
        + `only part of the composite foreign key (order_id, line_nr); the identifier is kept as `
        + `imported (annotation-preferred-identifier.spec.md).`,
    );
  });

  it("keeps out a uniqueness over the named roles that does not identify the entity", () => {
    // One role of an objectified ternary is unique, but a uniqueness over
    // one of three roles identifies no objectifier.
    const line = `-- barwise:v1 ${
      JSON.stringify({
        kind: "table",
        table: "booking",
        entity: "Booking",
        referenceMode: "booking_id",
        supertypes: [],
        identifiedBy: ["guest_id"],
        // Stated: an objectification the line does not name is no longer
        // guessed from the key on a line with supertypes (barwise-xgu).
        objectifies: {
          factType: "Guest books Room on Night",
          readings: ["{0} books {1} on {2}"],
          roles: [
            { name: "books", player: "Guest", columns: ["guest_id"] },
            { name: "is booked", player: "Room", columns: ["room_id"] },
            { name: "is on", player: "Night", columns: ["night_id"] },
          ],
        },
      })
    }`;
    const { model, warnings } = parse(`
      CREATE TABLE guest (guest_id INTEGER PRIMARY KEY);
      CREATE TABLE room (room_id INTEGER PRIMARY KEY);
      CREATE TABLE night (night_id INTEGER PRIMARY KEY);
      ${line}
      CREATE TABLE booking (
        guest_id INTEGER NOT NULL REFERENCES guest (guest_id),
        room_id INTEGER NOT NULL REFERENCES room (room_id),
        night_id INTEGER NOT NULL REFERENCES night (night_id),
        PRIMARY KEY (guest_id, room_id, night_id),
        UNIQUE (guest_id)
      );
    `);
    expect(identifiers(model).get("Booking")).not.toMatch(/^internal_uniqueness [^,]*$/);
    expect(warnings.some((w) => w.includes("(guest_id), which reads as no uniqueness"))).toBe(true);
  });
});
