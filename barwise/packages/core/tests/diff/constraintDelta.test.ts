/**
 * The model-level delta for constraints across fact types, and merge's
 * handling of it (orm-format-3 WS3c). Such a constraint lives in the
 * model, so it is diffed and merged on its own rather than as part of
 * whichever fact type a 2.0 file nested it under.
 */
import { describe, expect, it } from "vitest";
import type { ConstraintDelta, ModelDelta } from "../../src/diff/ModelDiff.js";
import { diffModels, elementName } from "../../src/diff/ModelDiff.js";
import { mergeModels } from "../../src/diff/ModelMerge.js";
import type { ExternalConstraint } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/**
 * Room is in Building and Room has RoomNumber, with `across` in the model.
 * `prefix` renames every role id, as a re-extraction mints them, and
 * `extra` adds Room has RoomName.
 */
function rooms(across: ExternalConstraint[], prefix = "r", extra = false): OrmModel {
  const model = new OrmModel({ name: "Rooms" });
  model.addObjectType({ id: "ot-room", name: "Room", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-b", name: "Building", kind: "entity", referenceMode: "code" });
  model.addObjectType({ id: "ot-nr", name: "RoomNumber", kind: "value" });
  model.addObjectType({ id: "ot-name", name: "RoomName", kind: "value" });
  const binary = (id: string, name: string, other: string, a: string, b: string) =>
    model.addFactType({
      id,
      name,
      roles: [
        { id: `${prefix}-${a}`, name: "of", playerId: "ot-room" },
        { id: `${prefix}-${b}`, name: "for", playerId: other },
      ],
      readings: ["{0} with {1}"],
    });
  binary("ft-in", "Room is in Building", "ot-b", "room-in", "b");
  binary("ft-nr", "Room has RoomNumber", "ot-nr", "room-nr", "n");
  if (extra) binary("ft-name", "Room has RoomName", "ot-name", "room-name", "name");
  for (const c of across) model.addConstraint(c);
  return model;
}

const key = (roles = ["r-b", "r-n"], id = "c-key"): ExternalConstraint => ({
  id,
  type: "external_uniqueness",
  roleIds: roles,
});

const constraintDeltas = (deltas: readonly ModelDelta[]) =>
  deltas.flatMap((d, i) => (d.elementType === "constraint" ? [[d, i] as const] : []));

function only(a: OrmModel, b: OrmModel): [ConstraintDelta, number] {
  const found = constraintDeltas(diffModels(a, b).deltas);
  expect(found).toHaveLength(1);
  return found[0]! as [ConstraintDelta, number];
}

/** Merge with every delta accepted except the constraint's, unless `take`. */
function merge(a: OrmModel, b: OrmModel, take: boolean): OrmModel {
  const { deltas } = diffModels(a, b);
  const accepted = new Set(
    deltas.flatMap((d, i) => (d.elementType !== "constraint" || take ? [i] : [])),
  );
  return mergeModels(a, b, deltas, accepted);
}

describe("the constraint delta", () => {
  it("is unchanged for the same constraint, named by its kind and the fact types it spans", () => {
    const [d] = only(rooms([key()]), rooms([key()]));
    expect(d.kind).toBe("unchanged");
    expect(d.breakingLevel).toBe("safe");
    expect(d.factTypes).toEqual(["Room is in Building", "Room has RoomNumber"]);
  });

  it("reads one added or removed as caution, as a fact type's constraint change did", () => {
    const [added] = only(rooms([]), rooms([key()]));
    expect([added.kind, added.breakingLevel]).toEqual(["added", "caution"]);
    const [removed] = only(rooms([key()]), rooms([]));
    expect([removed.kind, removed.breakingLevel]).toEqual(["removed", "caution"]);
  });

  it("pairs one with the same id and other roles as modified, with both versions", () => {
    const [d] = only(rooms([key()]), rooms([key(["r-room-in", "r-n"])]));
    expect(d.kind).toBe("modified");
    expect(d.changes).toEqual([{
      change: "constraintsModified",
      constraints: [{ from: key(), to: key(["r-room-in", "r-n"]) }],
    }]);
  });

  it("pairs by content one to one, so a second copy reads as removed", () => {
    // Ids that pair nothing, so content alone decides.
    const two = rooms([key(undefined, "c-a"), key(undefined, "c-b")]);
    const deltas = diffModels(two, rooms([key(undefined, "c-other")])).deltas;
    expect(constraintDeltas(deltas).map(([d]) => d.kind)).toEqual(["unchanged", "removed"]);
  });

  it("names two of one kind over the same fact types apart, by their roles", () => {
    const deltas = diffModels(
      rooms([]),
      rooms([
        { id: "x-1", type: "exclusion", roleIds: ["r-room-in", "r-room-nr"] },
        { id: "x-2", type: "exclusion", roleIds: ["r-b", "r-n"] },
      ]),
    ).deltas;
    const names = constraintDeltas(deltas).map(([d]) => elementName(d));
    expect(names).toEqual([
      "exclusion over Room is in Building (of), Room has RoomNumber (of)",
      "exclusion over Room is in Building (for), Room has RoomNumber (for)",
    ]);
  });

  it("reads a fragment's constraint against the full model it is diffed with", () => {
    // The fragment holds the constraint and no fact type; the roles it
    // names are the full model's.
    const fragment = new OrmModel({ name: "Rooms" });
    fragment.addConstraint(key());
    const [d] = only(rooms([]), fragment);
    expect(d.factTypes).toEqual(["Room is in Building", "Room has RoomNumber"]);
    expect(d.roles).toEqual(["Room is in Building (for)", "Room has RoomNumber (for)"]);
  });

  it("is unchanged when only the role ids differ, as an import mints them", () => {
    const [d] = only(rooms([key()]), rooms([key(["m-b", "m-n"], "other")], "m"));
    expect(d.kind).toBe("unchanged");
  });
});

describe("merging the constraint delta", () => {
  it("adds an accepted addition and leaves out a rejected one", () => {
    expect(merge(rooms([]), rooms([key()]), true).constraints).toEqual([key()]);
    expect(merge(rooms([]), rooms([key()]), false).constraints).toEqual([]);
  });

  it("drops an accepted removal and keeps a rejected one", () => {
    expect(merge(rooms([key()]), rooms([]), true).constraints).toEqual([]);
    expect(merge(rooms([key()]), rooms([]), false).constraints).toEqual([key()]);
  });

  it("takes an accepted modification's content under the existing id", () => {
    const incoming = { ...key(["r-room-in", "r-n"]) };
    const merged = merge(rooms([key()]), rooms([incoming]), true);
    expect(merged.constraints).toEqual([incoming]);
    expect(merge(rooms([key()]), rooms([incoming]), false).constraints).toEqual([key()]);
  });

  it("keeps the existing version when an accepted modification needs a fact type left out", () => {
    // The incoming version spans Room has RoomName, which only the
    // incoming model has; rejecting that fact type must not lose the key.
    const incoming = rooms([key(["r-b", "r-name"])], "r", true);
    const { deltas } = diffModels(rooms([key()]), incoming);
    const accepted = new Set(
      deltas.flatMap((d, i) => (d.elementType === "fact_type" && d.kind === "added" ? [] : [i])),
    );
    expect(mergeModels(rooms([key()]), incoming, deltas, accepted).constraints).toEqual([key()]);
  });

  it("names the merged model's roles when an incoming one was matched by name", () => {
    // The incoming roles have other ids; the fact types are unchanged, so
    // the merge keeps the existing roles, and the added key must name them.
    const merged = merge(rooms([]), rooms([key(["m-b", "m-n"])], "m"), true);
    expect(merged.constraints.map((c) => (c as { roleIds: string[]; }).roleIds)).toEqual([[
      "r-b",
      "r-n",
    ]]);
  });

  it("leaves out one whose fact type the merge left out", () => {
    // The key spans Room has RoomName, which only the incoming model has.
    const incoming = rooms([key(["r-b", "r-name"])], "r", true);
    const { deltas } = diffModels(rooms([]), incoming);
    const accepted = new Set(
      deltas.flatMap((d, i) => (d.elementType === "fact_type" && d.kind === "added" ? [] : [i])),
    );
    expect(mergeModels(rooms([]), incoming, deltas, accepted).constraints).toEqual([]);
  });

  it("carries one whose role no model holds, so validation reports it", () => {
    const dangling = key(["r-b", "r-ghost"]);
    expect(merge(rooms([dangling]), rooms([dangling]), true).constraints).toEqual([dangling]);
  });
});
