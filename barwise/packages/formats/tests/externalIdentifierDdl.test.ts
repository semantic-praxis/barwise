/**
 * DDL export of an externally identified entity
 * (external-preferred-identifier.spec.md, WS1): its key is the identifier,
 * so the router does not route the identifier again as a UNIQUE clause,
 * reads every column of a composite foreign key, and the annotation names
 * the key columns' fact types.
 */
import { OrmYamlSerializer } from "@barwise/core";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DdlExportFormat } from "../src/ddl/DdlExportFormat.js";
import { DdlImportFormat } from "../src/ddl/DdlImportFormat.js";

const ddlFormat = new DdlExportFormat();
const roomYaml = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "fixtures/externalIdentifier.orm.yaml"),
  "utf8",
);
const load = (yaml: string) => new OrmYamlSerializer().deserialize(yaml);
const table = (ddl: string, name: string) =>
  new RegExp(`CREATE TABLE ${name} \\(([^;]*)\\);`).exec(ddl)![1]!;

/** Desk identified by the Room it is in and its DeskNr: a scheme over a scheme. */
const deskYaml = roomYaml
  .replace(
    "  fact_types:",
    `    - { id: ot-desk, name: Desk, kind: entity, reference_mode: desk_id, preferred_identifier: c-desk-id }
    - { id: ot-desknr, name: DeskNr, kind: value, data_type: { name: integer } }
  fact_types:
    - id: ft-desk-in-room
      name: Desk is in Room
      roles:
        - { id: r-dir-desk, player: ot-desk, role_name: is in }
        - { id: r-dir-room, player: ot-room, role_name: holds }
      readings: ["{0} is in {1}"]
      constraints:
        - { id: c-dir-u, type: internal_uniqueness, roles: [r-dir-desk] }
    - id: ft-desk-has-nr
      name: Desk has DeskNr
      roles:
        - { id: r-dhn-desk, player: ot-desk, role_name: has }
        - { id: r-dhn-nr, player: ot-desknr, role_name: is of }
      readings: ["{0} has {1}"]
      constraints:
        - { id: c-dhn-u, type: internal_uniqueness, roles: [r-dhn-desk] }`,
  )
  .concat("    - { id: c-desk-id, type: external_uniqueness, roles: [r-dir-room, r-dhn-nr] }\n");

describe("DDL export of an externally identified entity", () => {
  it("keys room on building and room number, with no separate UNIQUE", () => {
    const room = table(ddlFormat.export(load(roomYaml), { annotate: false }).text, "room");
    expect(room).toContain("PRIMARY KEY (building_code, room_nr)");
    expect(room).not.toContain("UNIQUE");
    expect(room).not.toContain("room_id");
  });

  it("keys a scheme over a scheme on every column, with no UNIQUE over part of it", () => {
    // The router read only the first column of the room foreign key, and
    // wrote UNIQUE (building_code, desk_nr): desk 1 in two rooms of one
    // building would be refused.
    const desk = table(ddlFormat.export(load(deskYaml), { annotate: false }).text, "desk");
    expect(desk).toContain("PRIMARY KEY (building_code, room_nr, desk_nr)");
    expect(desk).not.toContain("UNIQUE");
  });

  it("keeps a uniqueness on a component's far value role", () => {
    // Each RoomNr in at most one Room: the key columns carried the far role,
    // so the router looked under the near one, found nothing, and dropped it.
    const yaml = roomYaml.replace(
      "        - { id: c-rhn-m, type: mandatory, role: r-rhn-room }",
      "        - { id: c-rhn-m, type: mandatory, role: r-rhn-room }\n        - { id: c-rhn-nr-u, type: internal_uniqueness, roles: [r-rhn-nr] }",
    );
    const room = table(ddlFormat.export(load(yaml), { annotate: false }).text, "room");
    expect(room).toContain("UNIQUE (room_nr)");
  });

  it("annotates the key columns, so a re-import names their fact types", () => {
    const ddl = ddlFormat.export(load(roomYaml), {}).text;
    const back = new DdlImportFormat().parse(ddl);
    const names = back.model.factTypes.map((ft) => ft.name);
    expect(names).toContain("Room is in Building");
    expect(names).toContain("Room has RoomNr");
  });
});
