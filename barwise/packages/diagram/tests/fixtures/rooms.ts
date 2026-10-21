/**
 * A model with a constraint across fact types whose nesting fact type is
 * a parameter, shared by the graph and summary tests (orm-format-3, WS3b).
 */
import type { Constraint } from "@barwise/core";
import { OrmModel } from "@barwise/core";

export type Host = "ft-id" | "ft-in" | "ft-nr";

/**
 * Room (identified by RoomId through the absorbed "Room has RoomId") is in
 * Building and has RoomNumber; the composite key over Building and
 * RoomNumber nests in `host`, and `extra` adds constraints to "Room has
 * RoomId".
 */
export function rooms(host: Host, extra: Constraint[] = []): OrmModel {
  const key: Constraint = { id: "c-key", type: "external_uniqueness", roleIds: ["r-b", "r-n"] };
  const nest = (id: Host) => (host === id ? [key] : []);
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
      { id: "c-pref", type: "internal_uniqueness", roleIds: ["r-rid"], isPreferred: true },
      ...nest("ft-id"),
      ...extra,
    ],
  });
  model.addFactType({
    id: "ft-in",
    name: "Room is in Building",
    roles: [
      { id: "r-room-in", name: "is in", playerId: "ot-room" },
      { id: "r-b", name: "houses", playerId: "ot-b" },
    ],
    readings: ["{0} is in {1}"],
    constraints: nest("ft-in"),
  });
  model.addFactType({
    id: "ft-nr",
    name: "Room has RoomNumber",
    roles: [
      { id: "r-room-nr", name: "has", playerId: "ot-room" },
      { id: "r-n", name: "is of", playerId: "ot-nr" },
    ],
    readings: ["{0} has {1}"],
    constraints: nest("ft-nr"),
  });
  return model;
}
