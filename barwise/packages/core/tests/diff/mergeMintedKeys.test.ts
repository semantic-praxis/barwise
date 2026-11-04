/**
 * Merge carries the key each minted id was minted from (iri-identity
 * decision 14; the part of 6d the switch to format 4.0 needs at once): the
 * base's for an id the base holds, none when the base's id was a person's,
 * and the incoming side's for an element the merge added.
 */
import { describe, expect, it } from "vitest";
import { diffModels, MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/index.js";
import { OrmModel } from "../../src/model/OrmModel.js";

/** Person smokes and runs; `smokes` states its constraint's id or not. */
function people(stated: string | undefined, runs = false): OrmModel {
  const m = new OrmModel({ name: "M", idsAcrossKinds: true });
  m.addObjectType({ id: "Person", name: "Person", kind: "entity", referenceMode: "nr" });
  m.addFactType({
    id: "Person_smokes",
    name: "Person smokes",
    roles: [{ id: "Person_smokes.smokes", name: "smokes", playerId: "Person" }],
    readings: ["{0} smokes"],
    constraints: [{
      ...(stated !== undefined ? { id: stated } : {}),
      type: "mandatory",
      roleId: "Person_smokes.smokes",
    }],
  });
  if (runs) {
    m.addFactType({
      id: "Person_runs",
      name: "Person runs",
      roles: [{ id: "Person_runs.runs", name: "runs", playerId: "Person" }],
      readings: ["{0} runs"],
      constraints: [{ type: "mandatory", roleId: "Person_runs.runs" }],
    });
  }
  return m;
}

const mergeAll = (base: OrmModel, incoming: OrmModel) => {
  const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
  return mergeModels(base, incoming, diff, new Set(diff.deltas.map((_, i) => i)));
};

describe("merge and the keys minted ids were minted from", () => {
  it("keeps the base's key for an id the base minted", () => {
    const base = people(undefined);
    expect(base.mintedFromOf("Each_Person_smokes")).toBeDefined();
    const merged = mergeAll(base, people(undefined));
    expect(merged.mintedFromOf("Each_Person_smokes")).toBe(base.mintedFromOf("Each_Person_smokes"));
  });

  it("gives no key to an id a person chose in the base, though the draft minted it", () => {
    const base = people("Each_Person_smokes");
    const incoming = people(undefined);
    expect(base.mintedFromOf("Each_Person_smokes")).toBeUndefined();
    expect(incoming.mintedFromOf("Each_Person_smokes")).toBeDefined();
    expect(mergeAll(base, incoming).mintedFromOf("Each_Person_smokes")).toBeUndefined();
  });

  it("takes the incoming side's key for an element the merge adds", () => {
    const incoming = people(undefined, true);
    const merged = mergeAll(people(undefined), incoming);
    expect(merged.mintedFromOf("Each_Person_runs")).toBe(incoming.mintedFromOf("Each_Person_runs"));
  });
});
