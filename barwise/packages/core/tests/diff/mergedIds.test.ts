/**
 * The id a merged element takes when its own is already held: the model's
 * suffix rule on it (iri-identity 6d, decision 5), the same on every merge
 * (barwise-yg5, when it came from the installed generator). One case per
 * kind, so the rule does not rest only on the merge law drawing colliding
 * ids by chance; a clash across kinds; and the case where a constraint
 * names the second of two repeated facts that both took suffixed ids.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeAndValidate } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";

function entities(m: OrmModel, ...ids: string[]): OrmModel {
  for (const id of ids) {
    m.addObjectType({ id, name: id.toUpperCase(), kind: "entity", referenceMode: `${id}_id` });
  }
  return m;
}

function factType(m: OrmModel, id: string, player: string): void {
  m.addFactType({
    id,
    name: `${player.toUpperCase()} is ${id}`,
    roles: [{ id: `${id}r`, name: "is", playerId: player }],
    readings: [`{0} is ${id}`],
  });
}

/** Keep the existing side and take the incoming additions. */
function mergeKeeping(existing: OrmModel, incoming: OrmModel): OrmModel {
  const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
  const policy = new Set(deltas.flatMap((d, i) => (d.kind === "removed" ? [] : [i])));
  const result = mergeAndValidate(existing, incoming, {
    deltas,
    matching: "id-first",
    recognizeRenames: false,
  }, policy);
  expect(result.model).not.toBeNull();
  return result.model!;
}

describe("a held id takes the suffix rule, the same on every merge", () => {
  it("subtype facts", () => {
    const existing = entities(new OrmModel({ name: "M" }), "a", "b", "c");
    existing.addSubtypeFact({ id: "sf1", subtypeId: "b", supertypeId: "a" });
    const incoming = entities(new OrmModel({ name: "M" }), "a", "b", "c");
    incoming.addSubtypeFact({ id: "sf1", subtypeId: "c", supertypeId: "a" });
    const ids = () => mergeKeeping(existing, incoming).subtypeFacts.map((sf) => sf.id);
    const once = ids();
    expect(once).toEqual(["sf1", "sf1_2"]);
    expect(ids()).toEqual(once);
  });

  it("objectifications", () => {
    const build = (ft: string, ot: string) => {
      const m = entities(new OrmModel({ name: "M" }), "a", "c", "d");
      factType(m, "f1", "a");
      factType(m, "f2", "a");
      m.addObjectifiedFactType({ id: "of1", factTypeId: ft, objectTypeId: ot });
      return m;
    };
    const existing = build("f1", "c");
    const incoming = build("f2", "d");
    const ids = () => mergeKeeping(existing, incoming).objectifiedFactTypes.map((o) => o.id);
    const once = ids();
    expect(once).toEqual(["of1", "of1_2"]);
    expect(ids()).toEqual(once);
  });

  it("populations", () => {
    const build = (ft: string) => {
      const m = entities(new OrmModel({ name: "M" }), "a");
      factType(m, "f1", "a");
      factType(m, "f2", "a");
      m.addPopulation({ id: "pop1", factTypeId: ft, instances: [] });
      return m;
    };
    const existing = build("f1");
    const incoming = build("f2");
    const ids = () => mergeKeeping(existing, incoming).populations.map((p) => p.id);
    const once = ids();
    expect(once).toEqual(["pop1", "pop1_2"]);
    expect(ids()).toEqual(once);
  });
});

describe("an id held by another kind", () => {
  it("is suffixed too, since a 4.0 model gives one id one element", () => {
    const existing = entities(new OrmModel({ name: "M" }), "a");
    factType(existing, "f1", "a");
    const incoming = entities(new OrmModel({ name: "M" }), "a");
    factType(incoming, "f1", "a");
    // The incoming population states the id the base's object type holds.
    incoming.addPopulation({ id: "a", factTypeId: "f1", instances: [] });
    expect(mergeKeeping(existing, incoming).populations.map((p) => p.id)).toEqual(["a_2"]);
  });
});

describe("a constraint follows a subtype fact to its suffixed id", () => {
  it("names both of two repeated incoming facts, not the first twice", () => {
    const existing = entities(new OrmModel({ name: "M" }), "a", "b", "c", "d");
    existing.addSubtypeFact({ id: "sf1", subtypeId: "b", supertypeId: "a" });
    existing.addSubtypeFact({ id: "sf2", subtypeId: "c", supertypeId: "a" });
    // The incoming model, loaded leniently, repeats one pair under the ids
    // the existing model already holds, and constrains both.
    const incoming = entities(new OrmModel({ name: "M" }), "a", "b", "c", "d");
    for (const id of ["sf1", "sf2"]) {
      incoming.addSubtypeFact({ id, subtypeId: "d", supertypeId: "a" }, {
        skipPlayerValidation: true,
      });
    }
    incoming.addConstraint({ type: "exclusion", id: "x", subtypeFactIds: ["sf1", "sf2"] });

    const merged = mergeKeeping(existing, incoming);
    const overD = merged.subtypeFacts.filter((sf) => sf.subtypeId === "d").map((sf) => sf.id);
    expect(overD).toHaveLength(2);
    expect(merged.getConstraint("x")).toMatchObject({ subtypeFactIds: overD });
  });
});

describe("re-merging an earlier merge's output", () => {
  // That output holds the first suffix, so a further collision on the same
  // preferred id has to walk to the next (from the retroactive review of
  // #734: no test reached it, and dropping the walk passed every test).
  it("walks past a suffixed id the input already holds", () => {
    const existing = entities(new OrmModel({ name: "M" }), "a", "b", "c", "d");
    existing.addSubtypeFact({ id: "s", subtypeId: "b", supertypeId: "a" });
    existing.addSubtypeFact({ id: "s_2", subtypeId: "c", supertypeId: "a" });
    const incoming = entities(new OrmModel({ name: "M" }), "a", "b", "c", "d");
    incoming.addSubtypeFact({ id: "s", subtypeId: "d", supertypeId: "a" });
    const ids = () => mergeKeeping(existing, incoming).subtypeFacts.map((sf) => sf.id);
    const once = ids();
    expect(once).toEqual(["s", "s_2", "s_3"]);
    expect(ids()).toEqual(once);
  });
});
