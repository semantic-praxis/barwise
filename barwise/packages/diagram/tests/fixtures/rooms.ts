/**
 * A model with a constraint across fact types, shared by the graph and
 * summary tests (orm-format-3, WS3b): built in memory, and read from a 2.0
 * file whose nesting fact type for that constraint is a parameter.
 */
import type { ExternalConstraint } from "@barwise/core";
import { OrmModel, OrmYamlSerializer } from "@barwise/core";

export type Host = "ft-id" | "ft-in" | "ft-nr";

/**
 * Room (identified by RoomId through the absorbed "Room has RoomId") is in
 * Building and has RoomNumber, with a composite key over Building and
 * RoomNumber. `extra` goes into the model before the key, where a 2.0 file
 * listing it under "Room has RoomId" puts it.
 */
export function rooms(extra: ExternalConstraint[] = []): OrmModel {
  const model = new OrmModel({ name: "Facilities" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-rid", name: "RoomId", kind: "value" });
  model.addObjectType({ id: "ot-b", name: "Building", kind: "entity", referenceMode: "code" });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  model.addFactType({
    id: "ft-id",
    name: "Room has RoomId",
    roles: [
      { id: "r-room-id", name: "has", playerId: "ot-room" },
      { id: "r-rid", name: "identifies", playerId: "ot-rid" },
    ],
    readings: ["{0} has {1}"],
    constraints: [
      { id: "c-pref", type: "internal_uniqueness", roleIds: ["r-rid"] },
    ],
  });
  model.setPreferredIdentifier("ot-room", "c-pref");
  model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-room-in", name: "is in", playerId: "ot-room" },
      { id: "r-b", name: "houses", playerId: "ot-b" },
    ],
    readings: ["{0} is in {1}"],
  });
  model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-room-nr", name: "has", playerId: "ot-room" },
      { id: "r-n", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
  });
  for (const c of extra) model.addConstraint(c);
  model.addConstraint({ id: "c-key", type: "external_uniqueness", roleIds: ["r-b", "r-n"] });
  return model;
}

/**
 * `rooms()` as a 2.0 file states it with the key nested under `host`,
 * read back. Nesting exists only in the file: in memory the key belongs to
 * the model (WS3c). The document is JSON, which is YAML.
 */
export function roomsFile(host: Host): OrmModel {
  const key = { id: "c-key", type: "external_uniqueness", roles: ["r-b", "r-n"] };
  const nest = (id: Host) => (host === id ? [key] : []);
  const binary = (
    id: Host,
    name: string,
    roles: [string, string, string][],
    own: object[] = [],
  ) => {
    const constraints = [...own, ...nest(id)];
    return {
      id,
      name,
      roles: roles.map(([rid, role_name, player]) => ({ id: rid, player, role_name })),
      readings: ["{0} " + name.split(" ").slice(1, -1).join(" ") + " {1}"],
      ...(constraints.length > 0 ? { constraints } : {}),
    };
  };
  const doc = {
    orm_version: "2.0",
    model: {
      name: "Facilities",
      object_types: [
        { id: "ot-room", name: "Room", kind: "entity", reference_mode: "id" },
        { id: "ot-rid", name: "RoomId", kind: "value" },
        { id: "ot-b", name: "Building", kind: "entity", reference_mode: "code" },
        { id: "ot-nr", name: "RoomNumber", kind: "value" },
      ],
      fact_types: [
        binary("ft-id", "Room has RoomId", [
          ["r-room-id", "has", "ot-room"],
          ["r-rid", "identifies", "ot-rid"],
        ], [{ id: "c-pref", type: "internal_uniqueness", roles: ["r-rid"], is_preferred: true }]),
        binary("ft-in", "Room is in Building", [
          ["r-room-in", "is in", "ot-room"],
          ["r-b", "houses", "ot-b"],
        ]),
        binary("ft-nr", "Room has RoomNumber", [
          ["r-room-nr", "has", "ot-room"],
          ["r-n", "is of", "ot-nr"],
        ]),
      ],
    },
  };
  return new OrmYamlSerializer().deserialize(JSON.stringify(doc));
}
