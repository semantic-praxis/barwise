/**
 * An accepted fact type modification keeps the base's ids (iri-identity
 * 6d): the fact type's, each role's as `<base>.<role>`, and each internal
 * constraint's the diff pairs with one of the base's, with its stored key.
 * Before, the merged fact type kept the base's id but took the incoming
 * roles and constraints under their own ids, which named another fact
 * type and lost the base's `minted_from`.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

/** Person owns Car, under `ftId`, with a uniqueness on the Car role. */
function owns(ftId: string, reading: string, uniquenessId?: string): OrmModel {
  const m = new OrmModel({ name: "M" });
  m.addObjectType({ id: "Person", name: "Person", kind: "entity", referenceMode: "nr" });
  m.addObjectType({ id: "Car", name: "Car", kind: "entity", referenceMode: "vin" });
  m.addFactType({
    id: ftId,
    name: "Person owns Car",
    roles: [{ name: "owns", playerId: "Person" }, { name: "is owned by", playerId: "Car" }],
    readings: [reading],
    constraints: [{
      type: "internal_uniqueness",
      ...(uniquenessId ? { id: uniquenessId } : {}),
      roleIds: [`${ftId}.is_owned_by`],
    }],
  });
  return m;
}

const takeAll = (base: OrmModel, incoming: OrmModel) => {
  const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
  return mergeModels(base, incoming, diff, new Set(diff.deltas.map((_, i) => i)));
};

describe("an accepted fact type modification", () => {
  // The diff pairs these by name: the incoming fact type's id differs.
  const base = owns("Person_owns_Car", "{0} owns {1}");
  const incoming = owns("Ownership", "{0} has {1}", "my-uniqueness");

  it("rebases the incoming roles onto the base's fact type id", () => {
    const ft = takeAll(base, incoming).getFactType("Person_owns_Car")!;
    expect(ft.readings.map((r) => r.template)).toEqual(["{0} has {1}"]);
    expect(ft.roles.map((r) => r.id)).toEqual([
      "Person_owns_Car.owns",
      "Person_owns_Car.is_owned_by",
    ]);
  });

  it("keeps the base's id for a constraint the diff pairs by content, and its roles follow", () => {
    const [uc] = takeAll(base, incoming).getFactType("Person_owns_Car")!.internalConstraints;
    const baseId = base.getFactType("Person_owns_Car")!.internalConstraints[0]!.id!;
    expect(uc).toMatchObject({ id: baseId, roleIds: ["Person_owns_Car.is_owned_by"] });
  });

  it("keeps the base's minted_from for that id when written as 4.0", () => {
    const merged = takeAll(base, incoming);
    const baseId = base.getFactType("Person_owns_Car")!.internalConstraints[0]!.id!;
    expect(base.mintedFromOf(baseId)).toBeDefined();
    expect(merged.mintedFromOf(baseId)).toBe(base.mintedFromOf(baseId));
    expect(new OrmYamlSerializer().serialize(merged)).toContain("minted_from:");
  });

  it("gives an incoming population the rebased role ids", () => {
    const withData = owns("Ownership", "{0} has {1}");
    withData.addPopulation({
      factTypeId: "Ownership",
      instances: [{ roleValues: { "Ownership.owns": "p1", "Ownership.is_owned_by": "c1" } }],
    });
    const [pop] = takeAll(base, withData).populations;
    expect(Object.keys(pop!.instances[0]!.roleValues).sort()).toEqual([
      "Person_owns_Car.is_owned_by",
      "Person_owns_Car.owns",
    ]);
  });
});
