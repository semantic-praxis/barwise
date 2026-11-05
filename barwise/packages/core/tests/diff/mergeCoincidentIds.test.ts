/**
 * Merge refuses renames paired through two 3.x files' ids when the files
 * look unrelated (barwise-xv1): no element keeps its name between them,
 * or a rename's names moved to other elements. Two replayed models pair by
 * the ids their files stated, so two files numbered from `ot0` merged with
 * no error and turned Dog into Cat. Models with no prior ids pair by their
 * own, and a shared id there is one element (model-invariants decision 1),
 * so those merge as before.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeModels } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { replayInto40 } from "../../src/serialization/replay.js";

/** Entities under `ot0`, `ot1`, ... in the order given: a model as a 3.x file states it. */
function animals(...names: string[]): OrmModel {
  const m = new OrmModel({ name: "M" });
  names.forEach((name, i) => {
    const referenceMode = `${name.toLowerCase()}_id`;
    m.addObjectType({ id: `ot${i}`, name, kind: "entity", referenceMode });
  });
  return m;
}

const takeAll = (base: OrmModel, incoming: OrmModel) => {
  const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
  return mergeModels(base, incoming, diff, new Set(diff.deltas.map((_, i) => i)));
};

const names = (m: OrmModel) => m.objectTypes.map((o) => `${o.id}:${o.name}`);
const replayed = (...names: string[]) => replayInto40(animals(...names));

describe("a merge of two 3.x files that share no name", () => {
  it("refuses, naming each pairing and why", () => {
    expect(() => takeAll(replayed("Customer", "Order"), replayed("Employee", "Department")))
      .toThrow(
        /share the id "ot0" \("Customer" and "Employee"\), "ot1" \("Order" and "Department"\), and no object type or fact type keeps its name/,
      );
  });

  it("counts a name as kept only where one file id holds it in both files", () => {
    // Cat is in both files, but under ot1 in one and ot2 in the other, so
    // no pairing keeps its name: Dog under ot0 becoming Bird is unexplained.
    const incoming = animals("Bird");
    incoming.addObjectType({ id: "ot2", name: "Cat", kind: "entity", referenceMode: "cat_id" });
    expect(() => takeAll(replayed("Dog", "Cat"), replayInto40(incoming))).toThrow(
      /share the id "ot0" \("Dog" and "Bird"\), and no object type/,
    );
  });

  it("refuses ids swapped between them", () => {
    expect(() => takeAll(replayed("Dog", "Cat"), replayed("Cat", "Dog"))).toThrow(
      /share the id "ot0" \("Dog" and "Cat"\), "ot1" \("Cat" and "Dog"\)/,
    );
  });

  it("leaves a merge that does not accept the renames alone", () => {
    const [base, incoming] = [replayed("Dog", "Cat"), replayed("Cat", "Dog")];
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    expect(names(mergeModels(base, incoming, diff, new Set()))).toEqual(["Dog:Dog", "Cat:Cat"]);
  });
});

describe("a merge of two 3.x files that keep a name (revisions of one model)", () => {
  it("merges a rename, its reference mode changed too", () => {
    // The shape of simple-modified.orm.yaml: Customer becomes Client, and
    // customer_id client_id. A change in structure is no evidence.
    const merged = takeAll(replayed("Customer", "Order"), replayed("Client", "Order"));
    expect(names(merged)).toEqual(["Customer:Client", "Order:Order"]);
  });

  it("merges a name respelled to the same local name", () => {
    const merged = takeAll(replayed("Order Line", "Cat"), replayed("Order_Line", "Cat"));
    expect(merged.objectTypes.map((o) => o.name)).toEqual(["Order_Line", "Cat"]);
  });

  it("refuses a rename onto a name the merged model keeps elsewhere", () => {
    // ot0 becomes Cat; the base keeps Cat under ot1, which the incoming
    // file renames to Bird. Fish is kept, so the files are related.
    expect(() => takeAll(replayed("Dog", "Cat", "Fish"), replayed("Cat", "Bird", "Fish")))
      .toThrow(/share the id "ot0" \("Dog" and "Cat"\).*held on other elements/);
  });

  it("merges a rename onto a name whose element the merge removes", () => {
    // The next revision deletes Cat (ot1) and renames Dog (ot0) to Cat.
    const next = animals("Cat");
    next.addObjectType({ id: "ot2", name: "Fish", kind: "entity", referenceMode: "fish_id" });
    const merged = takeAll(replayed("Dog", "Cat", "Fish"), replayInto40(next));
    expect(merged.objectTypes.map((o) => o.name).sort()).toEqual(["Cat", "Fish"]);
  });

  it("refuses a rename whose old name the incoming file holds elsewhere", () => {
    // ot0 is Dog in the base and Cat in the incoming file, which holds Dog
    // under ot1; the base holds no Cat.
    expect(() => takeAll(replayed("Dog", "Bird", "Fish"), replayed("Cat", "Dog", "Fish")))
      .toThrow(/share the id "ot0" \("Dog" and "Cat"\)/);
  });

  it("refuses a moved name that was also respelled, comparing local names", () => {
    expect(() =>
      takeAll(replayed("Order Line", "Bird", "Fish"), replayed("Cat", "Order_Line", "Fish"))
    ).toThrow(/share the id "ot0" \("Order Line" and "Cat"\)/);
  });

  it("refuses a fact type whose name moved to another fact type", () => {
    const facts = (first: string, second: string) => {
      const m = new OrmModel({ name: "M" });
      m.addObjectType({ id: "ot0", name: "Dog", kind: "entity", referenceMode: "id" });
      for (const [i, verb] of [first, second].entries()) {
        m.addFactType({
          id: `ft${i}`,
          name: `Dog ${verb}`,
          roles: [{ name: verb, playerId: "ot0" }],
          readings: [`{0} ${verb}`],
        });
      }
      return replayInto40(m);
    };
    // Dog is kept, so the files are related; only the fact types swap.
    expect(() => takeAll(facts("sleeps", "barks"), facts("barks", "sleeps"))).toThrow(
      /share the id "ft0" \("Dog sleeps" and "Dog barks"\)/,
    );
  });
});

describe("a merge of models that carry no prior ids", () => {
  it("merges a rotation of names under kept ids, as model-invariants decision 1 has it", () => {
    expect(names(takeAll(animals("Dog", "Cat"), animals("Cat", "Dog")))).toEqual([
      "ot0:Cat",
      "ot1:Dog",
    ]);
  });

  it("merges where only one side was replayed, since the two then pair by their own ids", () => {
    // The incoming model rotates the names under the ids the base's replay gave.
    const rotated = new OrmModel({ name: "M" });
    rotated.addObjectType({ id: "Dog", name: "Cat", kind: "entity", referenceMode: "id" });
    rotated.addObjectType({ id: "Cat", name: "Dog", kind: "entity", referenceMode: "id" });
    expect(names(takeAll(replayed("Dog", "Cat"), rotated))).toEqual(["Dog:Cat", "Cat:Dog"]);
  });
});
