/**
 * An annotated table line is the export's statement of what the table is:
 * the DDL import reads a table as objectifying exactly when its line says
 * so, and takes the line's reference mode whatever the key's width
 * (import-key-identifier-follow-ups.spec.md, barwise-xgu, barwise-9zm).
 */
import { resolvePreferredIdentifier } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { renderAnnotation, type TableAnnotation } from "../src/ddl/barwiseAnnotation.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

/** A table keyed on two whole foreign keys, under the given line. */
function keyedOnTwoReferences(line: Omit<TableAnnotation, "kind" | "table" | "entity">): string {
  return `CREATE TABLE person (person_id INT PRIMARY KEY);
CREATE TABLE course (course_id INT PRIMARY KEY);
${renderAnnotation({ kind: "table", table: "seat", entity: "Seat", ...line })}
CREATE TABLE seat (
  person_id INT NOT NULL REFERENCES person (person_id),
  course_id INT NOT NULL REFERENCES course (course_id),
  PRIMARY KEY (person_id, course_id));`;
}

const seatOf = (ddl: string) => {
  const model = new DdlImportFormat().parse(ddl).model;
  const seat = model.getObjectTypeByName("Seat")!;
  return { model, seat };
};

describe("an annotated table line", () => {
  it("that names no objectifies reads a table keyed on two references as an entity", () => {
    const { model, seat } = seatOf(
      keyedOnTwoReferences({ referenceMode: "seat_id", supertypes: [] }),
    );
    expect(model.objectifiedFactTypes).toEqual([]);
    const resolved = resolvePreferredIdentifier(model, seat.id);
    expect(resolved.ok && resolved.at.constraint.type).toBe("external_uniqueness");
  });

  it("from before supertypes keeps reading a table keyed on references as an objectifier", () => {
    const { model, seat } = seatOf(keyedOnTwoReferences({ referenceMode: "seat_id" }));
    expect(model.objectifiedFactTypes.map((o) => o.objectTypeId)).toEqual([seat.id]);
  });

  it("names the reference mode of a table keyed on several columns", () => {
    const line = renderAnnotation({
      kind: "table",
      table: "room",
      entity: "Room",
      referenceMode: "room_code",
      supertypes: [],
    });
    const model = new DdlImportFormat().parse(`${line}
CREATE TABLE room (building VARCHAR(10) NOT NULL, room_nr INT NOT NULL,
  PRIMARY KEY (building, room_nr));`).model;
    const room = model.getObjectTypeByName("Room")!;
    expect(room.kind === "entity" && room.referenceMode).toBe("room_code");
  });
});
