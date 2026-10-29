/**
 * The id a merged element takes when its own is already held
 * (barwise-yg5). It used to come from the installed generator, so two
 * merges of the same inputs differed; it is derived now. One case per
 * kind, so the fix does not rest only on the merge law drawing colliding
 * ids by chance, and the case where a constraint names the second of two
 * repeated facts that both took derived ids.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeAndValidate } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { derivedId, MERGE_ID_TAG } from "../../src/serialization/derivedId.js";

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

describe("a held id is replaced by a derived one, the same on every merge", () => {
  it("subtype facts", () => {
    const existing = entities(new OrmModel({ name: "M" }), "a", "b", "c");
    existing.addSubtypeFact({ id: "sf1", subtypeId: "b", supertypeId: "a" });
    const incoming = entities(new OrmModel({ name: "M" }), "a", "b", "c");
    incoming.addSubtypeFact({ id: "sf1", subtypeId: "c", supertypeId: "a" });
    const ids = () => mergeKeeping(existing, incoming).subtypeFacts.map((sf) => sf.id);
    const once = ids();
    expect(once[0]).toBe("sf1");
    expect(once[1]).not.toBe("sf1");
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
    expect(once).toHaveLength(2);
    expect(once[1]).not.toBe("of1");
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
    expect(once).toHaveLength(2);
    expect(once[1]).not.toBe("pop1");
    expect(ids()).toEqual(once);
  });
});

describe("a constraint follows a subtype fact to its derived id", () => {
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
  // That output holds attempt 1's derived id, so a further collision on the
  // same preferred id has to walk to attempt 2 (from the retroactive review
  // of #734: no test reached it, and dropping the walk passed every test).
  it("walks past a derived id the input already holds", () => {
    const existing = entities(new OrmModel({ name: "M" }), "a", "b", "c", "d");
    existing.addSubtypeFact({ id: "s", subtypeId: "b", supertypeId: "a" });
    existing.addSubtypeFact({
      id: derivedId(`${MERGE_ID_TAG}.subtype-fact`, ["s", "1"]),
      subtypeId: "c",
      supertypeId: "a",
    });
    const incoming = entities(new OrmModel({ name: "M" }), "a", "b", "c", "d");
    incoming.addSubtypeFact({ id: "s", subtypeId: "d", supertypeId: "a" });
    const ids = () => mergeKeeping(existing, incoming).subtypeFacts.map((sf) => sf.id);
    const once = ids();
    expect(new Set(once).size).toBe(3);
    expect(ids()).toEqual(once);
  });
});
