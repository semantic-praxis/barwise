/**
 * An external uniqueness as an entity's preferred identifier
 * (external-preferred-identifier.spec.md, barwise-alg): Room identified by
 * the Building it is in and its RoomNr. Before this, validation refused the
 * reference and the mapper keyed Room on its reference mode, demoting the
 * real identifier to a UNIQUE clause.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { mergeModels } from "../../src/diff/ModelMerge.js";
import { renderPopulationAsOpenApiExamples } from "../../src/export/populationRenderer.js";
import { RelationalMapper } from "../../src/mapping/RelationalMapper.js";
import {
  externallyIdentifiedEntity,
  identificationGraph,
  preferredIdentifiers,
  resolvePreferredIdentifier,
} from "../../src/model/identification.js";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { runQuery } from "../../src/query/index.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { ValidationEngine } from "../../src/validation/ValidationEngine.js";

/** The Room model, every id prefixed, so two copies share content and no ids. */
function roomYaml(p = "", opts: { preferred?: boolean; extra?: string; } = {}): string {
  const preferred = opts.preferred ?? true;
  return `orm_version: "3.0"
model:
  name: Rooms
  object_types:
    - { id: ${p}ot-building, name: Building, kind: entity, reference_mode: building_code }
    - id: ${p}ot-room
      name: Room
      kind: entity
      reference_mode: room_id${preferred ? `\n      preferred_identifier: ${p}c-room-id` : ""}
    - { id: ${p}ot-roomnr, name: RoomNr, kind: value, data_type: { name: integer } }
    - { id: ${p}ot-seats, name: SeatCount, kind: value, data_type: { name: integer } }
  fact_types:
    - id: ${p}ft-room-in-building
      name: Room is in Building
      roles:
        - { id: ${p}r-rib-room, player: ${p}ot-room, role_name: is in }
        - { id: ${p}r-rib-building, player: ${p}ot-building, role_name: houses }
      readings: ["{0} is in {1}"]
      constraints:
        - { id: ${p}c-rib-u, type: internal_uniqueness, roles: [${p}r-rib-room] }
        - { id: ${p}c-rib-m, type: mandatory, role: ${p}r-rib-room }
    - id: ${p}ft-room-has-nr
      name: Room has RoomNr
      roles:
        - { id: ${p}r-rhn-room, player: ${p}ot-room, role_name: has }
        - { id: ${p}r-rhn-nr, player: ${p}ot-roomnr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: ${p}c-rhn-u, type: internal_uniqueness, roles: [${p}r-rhn-room] }
        - { id: ${p}c-rhn-m, type: mandatory, role: ${p}r-rhn-room }
    - id: ${p}ft-room-seats
      name: Room has SeatCount
      roles:
        - { id: ${p}r-rs-room, player: ${p}ot-room, role_name: has }
        - { id: ${p}r-rs-seats, player: ${p}ot-seats, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: ${p}c-rs-u, type: internal_uniqueness, roles: [${p}r-rs-room] }
${opts.extra ?? ""}  constraints:
    - { id: ${p}c-room-id, type: external_uniqueness, roles: [${p}r-rib-building, ${p}r-rhn-nr] }
`;
}

const load = (yaml: string): OrmModel => new OrmYamlSerializer().deserialize(yaml);
const errors = (m: OrmModel) =>
  new ValidationEngine().validate(m).filter((d) => d.severity === "error");
const tableOf = (m: OrmModel, name: string) =>
  new RelationalMapper().map(m).tables.find((t) => t.name === name)!;

describe("resolving an external preferred identifier", () => {
  it("resolves Room's to its two components, near and far roles in place", () => {
    const resolved = resolvePreferredIdentifier(load(roomYaml()), "ot-room");
    expect(resolved.ok).toBe(true);
    if (!resolved.ok || resolved.at.kind !== "external") throw new Error("not external");
    expect(resolved.at.components.map((c) => [c.factType.id, c.nearRole.id, c.farRole.id]))
      .toEqual([
        ["ft-room-in-building", "r-rib-room", "r-rib-building"],
        ["ft-room-has-nr", "r-rhn-room", "r-rhn-nr"],
      ]);
    expect(errors(load(roomYaml()))).toEqual([]);
  });

  it("names no identified entity when the roles join on a value type", () => {
    // RoomNr joins "Room has RoomNr" and "RoomNr is shown on Sign": a value
    // type has no identifier, and an importer storing one would throw.
    const yaml = roomYaml("", { preferred: false }).replace(
      "  fact_types:",
      `    - { id: ot-sign, name: Sign, kind: entity, reference_mode: sign_id }
  fact_types:
    - id: ft-nr-on-sign
      name: RoomNr is shown on Sign
      roles:
        - { id: r-nos-nr, player: ot-roomnr, role_name: is shown on }
        - { id: r-nos-sign, player: ot-sign, role_name: shows }
      readings: ["{0} is shown on {1}"]
      constraints:
        - { id: c-nos-u, type: internal_uniqueness, roles: [r-nos-nr] }`,
    ).replace(
      "roles: [r-rib-building, r-rhn-nr]",
      "roles: [r-rhn-room, r-nos-sign]",
    ).replace(
      "- { id: c-rhn-u, type: internal_uniqueness, roles: [r-rhn-room] }",
      "- { id: c-rhn-u, type: internal_uniqueness, roles: [r-rhn-nr] }",
    );
    const model = load(yaml);
    const c = model.getConstraint("c-room-id")!;
    if (c.type !== "external_uniqueness") throw new Error(c.type);
    expect(externallyIdentifiedEntity(model, c)).toBeUndefined();
  });

  it("makes Room depend on Building in the identification graph", () => {
    expect(identificationGraph(load(roomYaml())).get("ot-room")).toEqual(["ot-building"]);
  });

  // One test per shape rule, each naming the rule in the message.
  it("refuses a constraint whose roles join on no one object", () => {
    // Both roles in one fact type: the join helper wants one per fact type.
    const yaml = roomYaml().replace(
      "roles: [r-rib-building, r-rhn-nr]",
      "roles: [r-rib-building, r-rib-room]",
    );
    expect(resolvePreferredIdentifier(load(yaml), "ot-room"))
      .toEqual({ ok: false, reason: "external-no-common-object" });
    expect(errors(load(yaml)).map((d) => d.message).join("\n")).toMatch(/do not join on one/);
  });

  it("refuses a constraint that identifies another entity", () => {
    // Building names Room's scheme.
    const yaml = roomYaml("", { preferred: false }).replace(
      "reference_mode: building_code }",
      "reference_mode: building_code, preferred_identifier: c-room-id }",
    );
    expect(resolvePreferredIdentifier(load(yaml), "ot-building"))
      .toEqual({ ok: false, reason: "external-other-entity", identifies: "ot-room" });
    expect(errors(load(yaml)).map((d) => d.message).join("\n"))
      .toContain('but that constraint identifies "Room"');
  });

  it("refuses a component that is not binary", () => {
    const yaml = roomYaml().replace(
      `        - { id: r-rhn-nr, player: ot-roomnr, role_name: is of }
      readings: ["{0} has {1}"]`,
      `        - { id: r-rhn-nr, player: ot-roomnr, role_name: is of }
        - { id: r-rhn-seats, player: ot-seats, role_name: with }
      readings: ["{0} has {1} with {2}"]`,
    );
    expect(resolvePreferredIdentifier(load(yaml), "ot-room"))
      .toEqual({ ok: false, reason: "external-not-binary" });
    expect(errors(load(yaml)).map((d) => d.message).join("\n")).toMatch(/is not binary/);
  });

  it("refuses a near role whose only uniqueness is deontic", () => {
    // "Ought to be in one building" does not make building_code single-valued.
    const yaml = roomYaml().replace(
      "- { id: c-rib-u, type: internal_uniqueness, roles: [r-rib-room] }",
      "- { id: c-rib-u, type: internal_uniqueness, roles: [r-rib-room], modality: deontic }",
    );
    expect(resolvePreferredIdentifier(load(yaml), "ot-room"))
      .toEqual({ ok: false, reason: "external-near-not-unique" });
  });

  it("refuses a near role with no uniqueness of its own", () => {
    const yaml = roomYaml().replace(
      "- { id: c-rhn-u, type: internal_uniqueness, roles: [r-rhn-room] }",
      "- { id: c-rhn-u, type: internal_uniqueness, roles: [r-rhn-room, r-rhn-nr] }",
    );
    expect(resolvePreferredIdentifier(load(yaml), "ot-room"))
      .toEqual({ ok: false, reason: "external-near-not-unique" });
    expect(errors(load(yaml)).map((d) => d.message).join("\n")).toMatch(/no uniqueness of its own/);
  });
});

describe("mapping an externally identified entity", () => {
  it("keys Room on Building's key and RoomNr, with no reference-mode column", () => {
    const room = tableOf(load(roomYaml()), "room");
    expect(room.primaryKey.columnNames).toEqual(["building_code", "room_nr"]);
    expect(room.columns.map((c) => c.name)).toEqual(["building_code", "room_nr", "seat_count"]);
    expect(room.foreignKeys).toEqual([{
      columnNames: ["building_code"],
      referencedTable: "building",
      referencedColumns: ["building_code"],
      sourceConstraintId: "ft-room-in-building",
    }]);
    // Each key column carries the role Room plays, as every column of an
    // entity table does, so the router and the annotation read it.
    expect(room.columns.slice(0, 2).map((c) => c.sourceRoleId)).toEqual([
      "r-rib-room",
      "r-rhn-room",
    ]);
  });

  it("gives a referencing table a two-column foreign key", () => {
    const yaml = roomYaml("", {
      extra: `    - id: ft-meeting-in-room
      name: Meeting is held in Room
      roles:
        - { id: r-mir-meeting, player: ot-meeting, role_name: is held in }
        - { id: r-mir-room, player: ot-room, role_name: hosts }
      readings: ["{0} is held in {1}"]
      constraints:
        - { id: c-mir-u, type: internal_uniqueness, roles: [r-mir-meeting] }
`,
    }).replace(
      "  fact_types:",
      "    - { id: ot-meeting, name: Meeting, kind: entity, reference_mode: meeting_id }\n  fact_types:",
    );
    const meeting = tableOf(load(yaml), "meeting");
    const fk = meeting.foreignKeys.find((f) => f.referencedTable === "room");
    expect(fk?.referencedColumns).toEqual(["building_code", "room_nr"]);
    expect(fk?.columnNames).toHaveLength(2);
  });

  it("reports a cycle through two external identifiers and stays total", () => {
    // Building identified through Room, Room through Building.
    const yaml = roomYaml("", {
      extra: `    - id: ft-building-has-room
      name: Building has head Room
      roles:
        - { id: r-bhr-building, player: ot-building, role_name: has head }
        - { id: r-bhr-room, player: ot-room, role_name: heads }
      readings: ["{0} has head {1}"]
      constraints:
        - { id: c-bhr-u, type: internal_uniqueness, roles: [r-bhr-building] }
    - id: ft-building-has-nr
      name: Building has RoomNr
      roles:
        - { id: r-bhn-building, player: ot-building, role_name: has }
        - { id: r-bhn-nr, player: ot-roomnr, role_name: numbers }
      readings: ["{0} has {1}"]
      constraints:
        - { id: c-bhn-u, type: internal_uniqueness, roles: [r-bhn-building] }
`,
    }).replace(
      "reference_mode: building_code }",
      "reference_mode: building_code, preferred_identifier: c-building-id }",
    ) + "    - { id: c-building-id, type: external_uniqueness, roles: [r-bhr-room, r-bhn-nr] }\n";
    const model = load(yaml);
    expect(new ValidationEngine().validate(model).map((d) => d.ruleId))
      .toContain("structural/identification-cycle");
    expect(() => new RelationalMapper().map(model)).not.toThrow();
  });
});

describe("the other readers of an external identifier", () => {
  it("query anchors list both component fact types and no single one", () => {
    const result = runQuery(load(roomYaml()), "anchors Room");
    if (result.kind !== "anchors") throw new Error(result.kind);
    expect(result.anchors[0]!.preferredIdentifier).toEqual({
      factTypes: ["Room is in Building", "Room has RoomNr"],
      identifierTypes: ["Building", "RoomNr"],
    });
  });

  it("content-only diff sees no identifier change between two separately built Rooms", () => {
    const changed = (a: OrmModel, b: OrmModel) =>
      diffModels(a, b, { matching: "content" }).deltas
        .flatMap((d) => d.kind === "modified" ? d.changes : [])
        .filter((c) => c.change === "preferredIdentifier");
    expect(changed(load(roomYaml("a-")), load(roomYaml("b-")))).toEqual([]);
    // Listing the constraint's roles the other way round is not a change.
    const swapped = roomYaml("b-").replace(
      "roles: [b-r-rib-building, b-r-rhn-nr]",
      "roles: [b-r-rhn-nr, b-r-rib-building]",
    );
    expect(changed(load(roomYaml("a-")), load(swapped))).toEqual([]);
    // An identifier that is no longer stored is.
    expect(changed(load(roomYaml("a-")), load(roomYaml("b-", { preferred: false }))))
      .toHaveLength(1);
  });

  it("an OpenAPI example joins the components on the entity", () => {
    const yaml = roomYaml() + `  populations:
    - id: p-rib
      fact_type: ft-room-in-building
      instances:
        - { id: i1, role_values: { r-rib-room: "R1", r-rib-building: "HQ" } }
    - id: p-rhn
      fact_type: ft-room-has-nr
      instances:
        - { id: i2, role_values: { r-rhn-room: "R2", r-rhn-nr: "7" } }
        - { id: i3, role_values: { r-rhn-room: "R1", r-rhn-nr: "101" } }
`;
    expect(renderPopulationAsOpenApiExamples(load(yaml)).get("Room"))
      .toEqual({ Building: "HQ", RoomNr: "101" });
  });

  it("merge follows an external identifier to the other side's copy", () => {
    // The base never named one; the incoming side, under other ids, does.
    const existing = load(roomYaml("e-", { preferred: false }));
    const incoming = load(roomYaml("i-"));
    const { deltas } = diffModels(existing, incoming);
    const room = deltas.findIndex((d) =>
      d.kind === "modified" && d.elementType === "object_type" && d.incoming?.name === "Room"
    );
    expect(room).toBeGreaterThanOrEqual(0);
    const merged = mergeModels(existing, incoming, deltas, new Set([room]));
    expect(merged.preferredIdentifierOf("e-ot-room")).toBe("e-c-room-id");
    expect(preferredIdentifiers(merged).byEntity.get("e-ot-room")?.kind).toBe("external");
  });
});
