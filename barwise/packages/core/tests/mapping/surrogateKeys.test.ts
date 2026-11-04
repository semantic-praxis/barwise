/**
 * `withSurrogateKeys`: every table keyed on several columns gets one
 * generated key, and every reference to one becomes one column hashed from
 * the natural columns it keeps (surrogate-key-export.spec.md, barwise-td6).
 */
import { describe, expect, it } from "vitest";
import { routeUniqueOnly } from "../../src/mapping/constraintRouting.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import type {
  Column,
  ForeignKey,
  RelationalSchema,
  Table,
} from "../../src/mapping/RelationalSchema.js";
import { withSurrogateKeys } from "../../src/mapping/surrogateKeys.js";
import { OrmModel } from "../../src/model/OrmModel.js";

const col = (name: string, nullable = false): Column => ({
  name,
  dataType: "TEXT",
  dataTypeDefaulted: false,
  nullable,
  sourceRoleId: `role-${name}`,
});
function table(
  name: string,
  columns: string[],
  key: string[],
  foreignKeys: ForeignKey[] = [],
): Table {
  return {
    name,
    columns: columns.map((c) => col(c)),
    primaryKey: { columnNames: key },
    foreignKeys,
    sourceElementId: `ot-${name}`,
  };
}
const schemaOf = (...tables: Table[]): RelationalSchema => ({ tables, sourceModelId: "test" });
const fk = (columnNames: string[], referencedTable: string, referencedColumns: string[]) => ({
  columnNames,
  referencedTable,
  referencedColumns,
});
const get = (s: RelationalSchema, name: string) => s.tables.find((t) => t.name === name)!;
const shape = (t: Table) => ({
  columns: t.columns.map((c) =>
    c.generatedFrom ? `${c.name}<-${c.generatedFrom.join("+")}` : c.name
  ),
  key: t.primaryKey.columnNames,
  foreignKeys: t.foreignKeys.map((f) =>
    `${f.columnNames.join(",")}->${f.referencedTable}(${f.referencedColumns.join(",")})`
  ),
  naturalKey: t.naturalKey,
});

const room = () =>
  table("room", ["building_code", "room_nr", "seats"], ["building_code", "room_nr"]);

describe("withSurrogateKeys", () => {
  it("gives a table keyed on several columns a generated key, and a reference to it one column", () => {
    const booking = table("booking", ["booking_id", "building_code", "room_nr"], ["booking_id"], [
      fk(["building_code", "room_nr"], "room", ["building_code", "room_nr"]),
    ]);
    const out = withSurrogateKeys(schemaOf(room(), booking));
    expect(shape(get(out, "room"))).toEqual({
      columns: ["room_key<-building_code+room_nr", "building_code", "room_nr", "seats"],
      key: ["room_key"],
      foreignKeys: [],
      naturalKey: ["building_code", "room_nr"],
    });
    expect(shape(get(out, "booking"))).toEqual({
      columns: ["booking_id", "room_key<-building_code+room_nr", "building_code", "room_nr"],
      key: ["booking_id"],
      foreignKeys: ["room_key->room(room_key)"],
      naturalKey: undefined,
    });
  });

  it("names a reference after the role prefix its columns carry, so two references differ", () => {
    const lecture = table(
      "lecture",
      ["lecture_id", "home_building_code", "home_room_nr", "away_building_code", "away_room_nr"],
      ["lecture_id"],
      [
        fk(["home_building_code", "home_room_nr"], "room", ["building_code", "room_nr"]),
        fk(["away_building_code", "away_room_nr"], "room", ["building_code", "room_nr"]),
      ],
    );
    const out = withSurrogateKeys(schemaOf(room(), lecture));
    expect(get(out, "lecture").foreignKeys.map((f) => f.columnNames[0])).toEqual([
      "home_room_key",
      "away_room_key",
    ]);
  });

  it("keeps a self-reference off the table's own generated key name", () => {
    const node = table("node", ["a", "b", "a2", "b2"], ["a", "b"], [
      fk(["a2", "b2"], "node", ["a", "b"]),
    ]);
    const out = get(withSurrogateKeys(schemaOf(node)), "node");
    expect(out.primaryKey.columnNames).toEqual(["node_key"]);
    expect(out.foreignKeys.map((f) => `${f.columnNames[0]}->${f.referencedColumns[0]}`)).toEqual([
      "node_key_2->node_key",
    ]);
  });

  it("collapses a key that is one reference, so a shared-key subtype stays one", () => {
    const lab = table("lab", ["building_code", "room_nr", "hazard"], ["building_code", "room_nr"], [
      fk(["building_code", "room_nr"], "room", ["building_code", "room_nr"]),
    ]);
    const out = get(withSurrogateKeys(schemaOf(lab, room())), "lab");
    expect(shape(out)).toEqual({
      columns: ["room_key<-building_code+room_nr", "building_code", "room_nr", "hazard"],
      key: ["room_key"],
      foreignKeys: ["room_key->room(room_key)"],
      naturalKey: undefined,
    });
  });

  it("rewrites a reference to a shared-key subtype whose key collapsed, to its new key", () => {
    const lab = table("lab", ["building_code", "room_nr", "hazard"], ["building_code", "room_nr"], [
      fk(["building_code", "room_nr"], "room", ["building_code", "room_nr"]),
    ]);
    const experiment = table("experiment", ["experiment_id", "building_code", "room_nr"], [
      "experiment_id",
    ], [fk(["building_code", "room_nr"], "lab", ["building_code", "room_nr"])]);
    const out = withSurrogateKeys(schemaOf(experiment, lab, room()));
    expect(shape(get(out, "experiment")).foreignKeys).toEqual(["lab_key->lab(room_key)"]);
  });

  it("hashes a reference in its target's key order, whatever order it lists its columns in", () => {
    const visit = table("visit", ["visit_id", "nr", "code"], ["visit_id"], [
      fk(["nr", "code"], "room", ["room_nr", "building_code"]),
    ]);
    const out = withSurrogateKeys(schemaOf(room(), visit));
    expect(get(out, "visit").columns.find((c) => c.name === "room_key")?.generatedFrom).toEqual([
      "code",
      "nr",
    ]);
  });

  it("hashes a reference to a collapsed key in the order that key hashes", () => {
    const lab = table("lab", ["building_code", "room_nr"], ["room_nr", "building_code"], [
      fk(["building_code", "room_nr"], "room", ["building_code", "room_nr"]),
    ]);
    const use = table("use", ["use_id", "r", "b"], ["use_id"], [
      fk(["r", "b"], "lab", ["room_nr", "building_code"]),
    ]);
    const out = withSurrogateKeys(schemaOf(room(), lab, use));
    expect(get(out, "use").columns.find((c) => c.name === "lab_key")?.generatedFrom).toEqual([
      "b",
      "r",
    ]);
  });

  it("settles a chain, hashing a key from source columns only", () => {
    const seat = table(
      "seat",
      ["building_code", "room_nr", "seat_nr"],
      ["building_code", "room_nr", "seat_nr"],
      [fk(["building_code", "room_nr"], "room", ["building_code", "room_nr"])],
    );
    const out = get(withSurrogateKeys(schemaOf(seat, room())), "seat");
    expect(shape(out)).toEqual({
      columns: [
        "seat_key<-building_code+room_nr+seat_nr",
        "room_key<-building_code+room_nr",
        "building_code",
        "room_nr",
        "seat_nr",
      ],
      key: ["seat_key"],
      foreignKeys: ["room_key->room(room_key)"],
      naturalKey: ["building_code", "room_nr", "seat_nr"],
    });
  });

  it("leaves its input as it was, and a schema with no wide key unchanged", () => {
    const input = schemaOf(room());
    const before = JSON.stringify(input);
    withSurrogateKeys(input);
    expect(JSON.stringify(input)).toBe(before);
    const narrow = schemaOf(table("a", ["a_id"], ["a_id"]));
    expect(withSurrogateKeys(narrow)).toBe(narrow);
  });

  it("stays total on a cycle of key references", () => {
    const a = table("a", ["x", "y"], ["x", "y"], [fk(["x", "y"], "b", ["x", "y"])]);
    const b = table("b", ["x", "y"], ["x", "y"], [fk(["x", "y"], "a", ["x", "y"])]);
    const out = withSurrogateKeys(schemaOf(a, b));
    for (const t of out.tables) expect(t.primaryKey.columnNames.length).toBe(1);
  });

  it("takes a free name when the table already has a column named for the key", () => {
    const t = table("room", ["room_key", "building_code", "room_nr"], ["building_code", "room_nr"]);
    expect(get(withSurrogateKeys(schemaOf(t)), "room").primaryKey.columnNames).toEqual([
      "room_key_2",
    ]);
  });
});

describe("a natural key a generated key replaced is still written as a uniqueness", () => {
  it("routes a many-to-many table's key, which no constraint is routed for", () => {
    const model = new OrmModel({ name: "Enrolment" });
    const student = model.addObjectType({
      name: "Student",
      kind: "entity",
      referenceMode: "student_id",
    });
    const course = model.addObjectType({
      name: "Course",
      kind: "entity",
      referenceMode: "course_id",
    });
    model.addFactType({
      name: "Student enrolls in Course",
      roles: [
        { id: "r1", name: "enrolls in", playerId: student.id },
        { id: "r2", name: "has", playerId: course.id },
      ],
      readings: ["{0} enrolls in {1}"],
      constraints: [{ type: "internal_uniqueness", roleIds: ["r1", "r2"] }],
    });
    const schema = new RelationalMapper().map(model, { surrogateKeys: true });
    const assoc = schema.tables.find((t) => t.naturalKey)!;
    expect(assoc.primaryKey.columnNames).toHaveLength(1);
    expect(routeUniqueOnly(model, schema).uniques).toContainEqual({
      tableName: assoc.name,
      columns: assoc.naturalKey,
    });
  });
});
