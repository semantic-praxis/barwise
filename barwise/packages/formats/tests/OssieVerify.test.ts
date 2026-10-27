/**
 * The Ossie export's read-back check
 * (`docs/specs/ossie-export-verified-by-reimport.spec.md`, WS1): an element
 * that comes back different with no loss line naming it gets one, and the
 * writer's deliberate changes -- role order, names -- add none.
 */
import { type InternalConstraint, OrmModel } from "@barwise/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OssieExportFormat } from "../src/ossie/OssieExportFormat.js";
import { OssieImportFormat } from "../src/ossie/OssieImportFormat.js";

const exporter = new OssieExportFormat();

function losses(model: OrmModel): string[] {
  const header = "# barwise: what this document could not carry from the model:";
  return exporter.export(model).text.split("\n")
    .filter((l) => l.startsWith("# barwise: ") && l !== header)
    .map((l) => l.slice("# barwise: ".length));
}

/** The lines only the read-back adds: every one names how its element comes back. */
const verified = (model: OrmModel) =>
  losses(model).filter((l) => /: (comes back|does not come back)/.test(l));

let seq = 0;
let id = (tag: string) => `${tag}-${++seq}`;

/** Person, identified by a PersonId it references, and a Name it has. */
function people(opts: { nameMandatory?: InternalConstraint["modality"] | false; } = {}) {
  const m = new OrmModel({ name: "M" });
  const person = m.addObjectType({
    id: id("ot"),
    name: "Person",
    kind: "entity",
    referenceMode: "person_id",
  });
  const pid = m.addObjectType({
    id: id("ot"),
    name: "PersonId",
    kind: "value",
    dataType: { name: "integer" },
  });
  const name = m.addObjectType({
    id: id("ot"),
    name: "Name",
    kind: "value",
    dataType: { name: "text" },
  });
  const r = (playerId: string, roleName: string) => ({ id: id("r"), name: roleName, playerId });
  const idRoles = [r(person.id, "Person"), r(pid.id, "PersonId")];
  const pidUc = id("uc");
  m.addFactType({
    id: id("ft"),
    name: "Person.person_id",
    roles: idRoles,
    readings: ["{0} has {1}"],
    constraints: [
      { type: "internal_uniqueness", id: id("uc"), roleIds: [idRoles[0]!.id] },
      { type: "internal_uniqueness", id: pidUc, roleIds: [idRoles[1]!.id] },
      { type: "mandatory", id: id("m"), roleId: idRoles[0]!.id },
    ],
  });
  m.setPreferredIdentifier(person.id, pidUc);
  const nameRoles = [r(person.id, "Person"), r(name.id, "Name")];
  m.addFactType({
    id: id("ft"),
    name: "Person.name",
    roles: nameRoles,
    readings: ["{0} has {1}"],
    constraints: [
      { type: "internal_uniqueness", id: id("uc"), roleIds: [nameRoles[0]!.id] },
      ...(opts.nameMandatory === false ? [] : [{
        type: "mandatory" as const,
        id: id("m"),
        roleId: nameRoles[0]!.id,
        ...(opts.nameMandatory ? { modality: opts.nameMandatory } : {}),
      }]),
    ],
  });
  return { m, person, name };
}

describe("Ossie export: the read-back check", () => {
  afterEach(() => vi.restoreAllMocks());

  it("names a deontic mandatory that comes back alethic", () => {
    expect(verified(people({ nameMandatory: "deontic" }).m)).toEqual([
      "Fact type: Person.name: comes back changed: constraints added: mandatory; constraints removed: mandatory (deontic)",
    ]);
    expect(verified(people({ nameMandatory: "alethic" }).m)).toEqual([]);
    expect(verified(people().m)).toEqual([]);
  });

  it("names an entity that comes back with a preferred identifier the model does not store", () => {
    const m = new OrmModel({ name: "M" });
    const room = m.addObjectType({
      id: id("ot"),
      name: "Room",
      kind: "entity",
      referenceMode: "room_id",
    });
    const num = m.addObjectType({
      id: id("ot"),
      name: "RoomNumber",
      kind: "value",
      dataType: { name: "integer" },
    });
    const bld = m.addObjectType({
      id: id("ot"),
      name: "Building",
      kind: "value",
      dataType: { name: "text" },
    });
    const binary = (name: string, player: string) => {
      const roles = [
        { id: id("r"), name: "Room", playerId: room.id },
        { id: id("r"), name: m.getObjectType(player)!.name, playerId: player },
      ];
      m.addFactType({
        id: id("ft"),
        name,
        roles,
        readings: ["{0} has {1}"],
        constraints: [
          { type: "internal_uniqueness", id: id("uc"), roleIds: [roles[0]!.id] },
          { type: "mandatory", id: id("m"), roleId: roles[0]!.id },
        ],
      });
      return roles[1]!.id;
    };
    m.addConstraint({
      type: "external_uniqueness",
      id: id("eu"),
      roleIds: [binary("Room.number", num.id), binary("Room.building", bld.id)],
    });
    const lines = verified(m);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^Object type: Room: comes back changed: preferred identifier: \(none\) -> external/,
    );
  });

  it("adds no line for a role order or names the writer changes on purpose", () => {
    const { m: model, person, name } = people({ nameMandatory: false });
    // Name first, Person second, uniqueness on Person: the writer moves
    // Person first (rule 3), and renames the fact type and both roles.
    const roles = [
      { id: id("r"), name: "is of", playerId: name.id },
      { id: id("r"), name: "has", playerId: person.id },
    ];
    model.addFactType({
      id: id("ft"),
      name: "Name is the nickname of Person",
      roles,
      readings: ["{0} is the nickname of {1}"],
      constraints: [{ type: "internal_uniqueness", id: id("uc"), roleIds: [roles[1]!.id] }],
    });
    const text = exporter.export(model).text;
    expect(text).toContain("name: name_is_the_nickname_of_person");
    expect(verified(model)).toEqual([]);
  });

  it("adds no second line for an element the writer already names", () => {
    const { m } = people();
    m.addObjectType({ id: id("ot"), name: "Price", kind: "value", dataType: { name: "money" } });
    const all = losses(m);
    expect(all).toContain("Price: data type money written as Decimal");
    expect(verified(m)).toEqual([]);
  });

  it("returns a document the importer refuses, with a line saying so", () => {
    vi.spyOn(OssieImportFormat.prototype, "parse").mockImplementation(() => {
      throw new Error("refused for the test");
    });
    const { m } = people();
    const result = exporter.export(m);
    expect(result.text).toContain("concept: Person");
    expect(losses(m)).toContain("model: the document does not read back: refused for the test");
  });

  it("writes no id the read-back minted, and the same text twice", () => {
    const { m } = people({ nameMandatory: "deontic" });
    const minted: string[] = [];
    const parse = OssieImportFormat.prototype.parse;
    vi.spyOn(OssieImportFormat.prototype, "parse").mockImplementation(
      function(this: OssieImportFormat, input, options) {
        const result = parse.call(this, input, options);
        const { model } = result;
        minted.push(
          ...model.objectTypes.map((o) => o.id),
          ...model.factTypes.flatMap((f) => [
            f.id,
            ...f.roles.map((r) => r.id),
            ...f.internalConstraints.map((c) => c.id!),
          ]),
          ...model.constraints.map((c) => c.id!),
        );
        return result;
      },
    );
    const first = exporter.export(m).text;
    expect(minted.length).toBeGreaterThan(0);
    for (const mintedId of minted) expect(first).not.toContain(mintedId);
    expect(exporter.export(m).text).toBe(first);
  });

  it("keeps source ids YAML would read as another type, or as a mapping", () => {
    const tags = ["1", "true", "a: b", "2", "null", "3", "4", "5", "6", "7", "8", "9", "10"];
    const plain = id;
    let next = 0;
    id = () => tags[next++] ?? plain("x");
    try {
      const { m } = people({ nameMandatory: "deontic" });
      expect(m.objectTypes.map((o) => o.id)).toEqual(["1", "true", "a: b"]);
      expect(verified(m)).toEqual([
        "Fact type: Person.name: comes back changed: constraints added: mandatory; constraints removed: mandatory (deontic)",
      ]);
    } finally {
      id = plain;
    }
  });

  it("keeps an importer message with a code frame on one comment line", () => {
    vi.spyOn(OssieImportFormat.prototype, "parse").mockImplementation(() => {
      throw new Error("Not a readable Ossie document: bad at line 5:\n\n    - id: x\n          ^");
    });
    const text = exporter.export(people().m).text;
    expect(text).toContain(
      "# barwise: model: the document does not read back: Not a readable Ossie document: bad at line 5: - id: x ^",
    );
    expect(text.split("\n").filter((l) => l.trim() === "^")).toEqual([]);
  });
});
