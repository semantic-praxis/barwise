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

describe("a kept constraint id", () => {
  it("is not taken where the incoming model gives it to another element", () => {
    // The base's uniqueness id is, in the incoming model, a constraint
    // across fact types; the internal one the diff pairs by content keeps
    // its own id, so the merge does not hold one id twice.
    const base = owns("Person_owns_Car", "{0} owns {1}", "u1");
    const incoming = owns("Ownership", "{0} has {1}", "u2");
    incoming.addFactType({
      id: "Car_is_red",
      name: "Car is red",
      roles: [{ name: "is red", playerId: "Car" }],
      readings: ["{0} is red"],
    });
    incoming.addConstraint({
      type: "external_uniqueness",
      id: "u1",
      roleIds: ["Ownership.is_owned_by", "Car_is_red.is_red"],
    });
    const merged = takeAll(base, incoming);
    const ids = merged.everyConstraint().map(([c]) => c.id);
    expect(ids.filter((id) => id === "u1")).toHaveLength(1);
    expect(merged.getFactType("Person_owns_Car")!.internalConstraints[0]!.id).toBe("u2");
  });
});

describe("an object type's owner", () => {
  /** Customer, owned in one model and crm's shadow in the other. */
  const withCustomer = (id: string) => {
    const m = new OrmModel({ name: "M", ...(id.includes(":") ? { imports: { crm: "crm" } } : {}) });
    m.addObjectType({ id, name: "Customer", kind: "entity", referenceMode: "nr" });
    return m;
  };

  it("is the base's after an accepted modification: a fragment does not take a shadow over", () => {
    const base = withCustomer("crm:Customer");
    const fragment = withCustomer("Customer");
    const diff = diffModels(base, fragment, MERGE_DIFF_OPTIONS);
    const i = diff.deltas.findIndex((d) => d.elementType === "object_type");
    expect(diff.deltas[i]!.changeDescriptions).toEqual(['source context: "crm" -> "(none)"']);
    const merged = mergeModels(base, fragment, diff, new Set([i]));
    expect(merged.objectTypes.map((o) => o.id)).toEqual(["crm:Customer"]);
  });

  it("is no change for one id under imports that differ: the header says that", () => {
    // Bound to CRM here, unbound (so the alias itself) there.
    const base = new OrmModel({ name: "M", imports: { crm: "CRM" } });
    base.addObjectType({
      id: "crm:Customer",
      name: "Customer",
      kind: "entity",
      referenceMode: "nr",
    });
    const bare = new OrmModel({ name: "M" });
    bare.addObjectType({
      id: "crm:Customer",
      name: "Customer",
      kind: "entity",
      referenceMode: "nr",
    });
    const objectTypes = diffModels(base, bare).deltas.filter((d) =>
      d.elementType === "object_type"
    );
    expect(objectTypes.map((d) => d.kind)).toEqual(["unchanged"]);
  });
});

describe("a rebased role", () => {
  it("is read only where a constraint names a role, never in a literal (Copilot, on 6d)", () => {
    const base = owns("Person_owns_Car", "{0} owns {1}");
    const incoming = owns("Ownership", "{0} has {1}");
    // An allowed value spelled like the role id the merge rebases.
    incoming.getFactType("Ownership")!.addConstraint({
      type: "value_constraint",
      roleId: "Ownership.is_owned_by",
      values: ["Ownership.is_owned_by", "other"],
    });
    const vc = takeAll(base, incoming).getFactType("Person_owns_Car")!.internalConstraints
      .find((c) => c.type === "value_constraint")!;
    expect(vc).toMatchObject({
      roleId: "Person_owns_Car.is_owned_by",
      values: ["Ownership.is_owned_by", "other"],
    });
  });
});
