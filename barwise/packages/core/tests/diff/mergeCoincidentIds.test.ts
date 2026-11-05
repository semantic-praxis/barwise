/**
 * Merge refuses a pairing made through two 3.x files' ids whose names
 * moved (barwise-xv1): each side's name is held on another element of the
 * other side. Two replayed models pair by the ids their files stated, so
 * two files numbering Dog and Cat `ot0` and `ot1` in opposite orders
 * merged with no error and turned Dog into Cat. Models with no prior ids
 * pair by their own, and a shared id there is one element
 * (model-invariants decision 1), so those merge as before.
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

describe("a merge of two 3.x files", () => {
  it("refuses ids swapped between them, naming each pairing", () => {
    expect(() => takeAll(replayed("Dog", "Cat"), replayed("Cat", "Dog"))).toThrow(
      /3\.x files share the id "ot0" \("Dog" and "Cat"\), "ot1" \("Cat" and "Dog"\)/,
    );
  });

  it("refuses a pairing whose new name the base holds elsewhere, one side moved only", () => {
    // ot0 becomes Cat in the incoming file, which keeps no Dog; the base
    // already holds Cat under ot1.
    expect(() => takeAll(replayed("Dog", "Cat"), replayed("Cat", "Bird"))).toThrow(
      /share the id "ot0" \("Dog" and "Cat"\)/,
    );
  });

  it("refuses a pairing whose old name the incoming file holds elsewhere", () => {
    // ot0 is Dog in the base and Cat in the incoming file, which holds Dog
    // under ot1; the base holds no Cat.
    expect(() => takeAll(replayed("Dog", "Bird"), replayed("Cat", "Dog"))).toThrow(
      /share the id "ot0" \("Dog" and "Cat"\)/,
    );
  });

  it("refuses a moved name that was also respelled, comparing local names", () => {
    expect(() => takeAll(replayed("Order Line", "Bird"), replayed("Cat", "Order_Line"))).toThrow(
      /share the id "ot0" \("Order Line" and "Cat"\)/,
    );
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
    expect(() => takeAll(facts("sleeps", "barks"), facts("barks", "sleeps"))).toThrow(
      /share the id "ft0" \("Dog sleeps" and "Dog barks"\)/,
    );
  });

  it("merges a rename between two revisions of one file, its reference mode changed too", () => {
    // The shape of simple-modified.orm.yaml: Customer becomes Client, and
    // customer_id client_id. A change in structure is no evidence.
    expect(names(takeAll(replayed("Customer"), replayed("Client")))).toEqual(["Customer:Client"]);
  });

  it("merges a name respelled to the same local name", () => {
    const merged = takeAll(replayed("Order Line", "Cat"), replayed("Order_Line", "Cat"));
    expect(merged.objectTypes.map((o) => o.name)).toEqual(["Order_Line", "Cat"]);
  });

  it("leaves a merge that does not accept the change alone", () => {
    const [base, incoming] = [replayed("Dog", "Cat"), replayed("Cat", "Dog")];
    const diff = diffModels(base, incoming, MERGE_DIFF_OPTIONS);
    expect(names(mergeModels(base, incoming, diff, new Set()))).toEqual(["Dog:Dog", "Cat:Cat"]);
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
