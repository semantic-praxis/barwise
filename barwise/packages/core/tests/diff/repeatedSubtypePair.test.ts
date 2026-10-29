/**
 * Two subtype facts over one pair (barwise-m9b).
 *
 * A lenient load can hold them, and `structural/duplicate-subtype-fact`
 * reports them. The diff keyed subtype facts by their pair in a plain map,
 * so the second overwrote the first: a diff saw one, and a merge wrote one,
 * after which the rule had nothing left to report. Both are carried now,
 * so the merge result still carries the defect and the rule still names it.
 */
import { describe, expect, it } from "vitest";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { MERGE_DIFF_OPTIONS, mergeAndValidate } from "../../src/diff/ModelMerge.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { RULE_ID } from "../../src/validation/ruleId.js";

function withRepeatedPair(): OrmModel {
  const m = new OrmModel({ name: "M" });
  m.addObjectType({ id: "a", name: "A", kind: "entity", referenceMode: "a_id" });
  m.addObjectType({ id: "b", name: "B", kind: "entity", referenceMode: "b_id" });
  m.addSubtypeFact({ id: "sf1", subtypeId: "b", supertypeId: "a" });
  // What a lenient load holds; a strict add refuses the repeated pair.
  m.addSubtypeFact({ id: "sf2", subtypeId: "b", supertypeId: "a" }, {
    skipPlayerValidation: true,
  });
  return m;
}

describe("two subtype facts over one pair", () => {
  it("the diff sees both", () => {
    const model = withRepeatedPair();
    const sfDeltas = diffModels(model, model).deltas.filter((d) =>
      d.elementType === "subtype_fact"
    );
    expect(sfDeltas.map((d) => [d.kind, d.existing?.id])).toEqual([
      ["unchanged", "sf1"],
      ["unchanged", "sf2"],
    ]);
  });

  it("pairs a repeat by id before position", () => {
    const existing = withRepeatedPair();
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "a", name: "A", kind: "entity", referenceMode: "a_id" });
    incoming.addObjectType({ id: "b", name: "B", kind: "entity", referenceMode: "b_id" });
    incoming.addSubtypeFact({ id: "sf2", subtypeId: "b", supertypeId: "a" });
    const sfDeltas = diffModels(existing, incoming).deltas.filter((d) =>
      d.elementType === "subtype_fact"
    );
    expect(sfDeltas.map((d) => [d.kind, d.existing?.id ?? d.incoming?.id])).toEqual([
      ["removed", "sf1"],
      ["unchanged", "sf2"],
    ]);
  });

  it("a merge keeps both, and validation still reports the repeat", () => {
    const model = withRepeatedPair();
    const { deltas } = diffModels(model, model, MERGE_DIFF_OPTIONS);
    const result = mergeAndValidate(model, model, {
      deltas,
      matching: "id-first",
      recognizeRenames: false,
    }, new Set());
    expect(result.model?.subtypeFacts.map((sf) => sf.id)).toEqual(["sf1", "sf2"]);
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual([RULE_ID.duplicateSubtypeFact]);
  });
});

describe("what the merge still drops, and the ids it keeps", () => {
  it("drops both when an accepted change makes an end a value type", () => {
    const existing = withRepeatedPair();
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "a", name: "A", kind: "value" });
    incoming.addObjectType({ id: "b", name: "B", kind: "entity", referenceMode: "b_id" });
    for (const id of ["sf1", "sf2"]) {
      incoming.addSubtypeFact({ id, subtypeId: "b", supertypeId: "a" }, {
        skipPlayerValidation: true,
      });
    }
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    const result = mergeAndValidate(
      existing,
      incoming,
      { deltas, matching: "id-first", recognizeRenames: false },
      new Set(deltas.keys()),
    );
    expect(result.model?.subtypeFacts).toEqual([]);
  });

  it("keeps the existing id when a repeat's modification is accepted", () => {
    const existing = withRepeatedPair();
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "a", name: "A", kind: "entity", referenceMode: "a_id" });
    incoming.addObjectType({ id: "b", name: "B", kind: "entity", referenceMode: "b_id" });
    incoming.addSubtypeFact({ id: "sf1", subtypeId: "b", supertypeId: "a" });
    incoming.addSubtypeFact({
      id: "sfZ",
      subtypeId: "b",
      supertypeId: "a",
      providesIdentification: false,
    }, { skipPlayerValidation: true });
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    expect(deltas.filter((d) => d.elementType === "subtype_fact").map((d) => d.kind))
      .toEqual(["unchanged", "modified"]);
    const result = mergeAndValidate(
      existing,
      incoming,
      { deltas, matching: "id-first", recognizeRenames: false },
      new Set(deltas.keys()),
    );
    expect(result.model?.subtypeFacts.map((sf) => sf.id)).toEqual(["sf1", "sf2"]);
  });

  it("a constraint naming the second keeps naming the second", () => {
    const model = withRepeatedPair();
    model.addConstraint({ type: "exclusion", id: "x", subtypeFactIds: ["sf1", "sf2"] });
    const { deltas } = diffModels(model, model, MERGE_DIFF_OPTIONS);
    const merged = mergeAndValidate(model, model, {
      deltas,
      matching: "id-first",
      recognizeRenames: false,
    }, new Set())
      .model!;
    expect(merged.getConstraint("x")).toMatchObject({ subtypeFactIds: ["sf1", "sf2"] });
  });
});

describe("a repeat the incoming side no longer holds", () => {
  // From the retroactive review of #733: the incoming model keeps one of the
  // two facts, under its own id, modified. Rejecting the other's removal and
  // accepting the modification used to drop the accepted fact, leave the
  // constraint naming the survivor twice, and report nothing.
  it("keeps both, and the constraint still names both", () => {
    const existing = withRepeatedPair();
    existing.addConstraint({ type: "exclusion", id: "x", subtypeFactIds: ["sf1", "sf2"] });
    const incoming = new OrmModel({ name: "M" });
    incoming.addObjectType({ id: "a", name: "A", kind: "entity", referenceMode: "a_id" });
    incoming.addObjectType({ id: "b", name: "B", kind: "entity", referenceMode: "b_id" });
    incoming.addSubtypeFact({
      id: "sf2",
      subtypeId: "b",
      supertypeId: "a",
      providesIdentification: false,
    });
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    expect(deltas.filter((d) => d.elementType === "subtype_fact").map((d) => d.kind))
      .toEqual(["removed", "modified"]);
    // The surfaces' default: accept additions and modifications, reject removals.
    const accepted = new Set(deltas.flatMap((d, i) => (d.kind === "removed" ? [] : [i])));

    const result = mergeAndValidate(existing, incoming, {
      deltas,
      matching: "id-first",
      recognizeRenames: false,
    }, accepted);
    expect(result.model?.subtypeFacts.map((sf) => sf.id)).toEqual(["sf1", "sf2"]);
    expect(result.model?.getConstraint("x")).toMatchObject({ subtypeFactIds: ["sf1", "sf2"] });
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual([RULE_ID.duplicateSubtypeFact]);
  });
});

describe("a repeat an accepted removal leaves out", () => {
  // From the pr-review of #740: a constraint naming the removed fact fell
  // back to the merged fact holding the same pair, which is its surviving
  // sibling, so the constraint named that sibling twice and nothing said so.
  it("leaves the constraint, rather than pointing it at the sibling", () => {
    const existing = withRepeatedPair();
    existing.addObjectType({ id: "c", name: "C", kind: "entity", referenceMode: "c_id" });
    existing.addSubtypeFact({ id: "sf3", subtypeId: "c", supertypeId: "a" });
    existing.addConstraint({ type: "exclusion", id: "x", subtypeFactIds: ["sf1", "sf2", "sf3"] });
    const incoming = new OrmModel({ name: "M" });
    for (const [id, name] of [["a", "A"], ["b", "B"], ["c", "C"]] as const) {
      incoming.addObjectType({ id, name, kind: "entity", referenceMode: `${id}_id` });
    }
    incoming.addSubtypeFact({ id: "sf2", subtypeId: "b", supertypeId: "a" });
    incoming.addSubtypeFact({ id: "sf3", subtypeId: "c", supertypeId: "a" });
    incoming.addConstraint({ type: "exclusion", id: "x", subtypeFactIds: ["sf2", "sf3"] });
    const { deltas } = diffModels(existing, incoming, MERGE_DIFF_OPTIONS);
    // Accept the removal of sf1; reject the change to x.
    const accepted = new Set(
      deltas.flatMap((d, i) => (d.elementType === "subtype_fact" ? [i] : [])),
    );

    const result = mergeAndValidate(existing, incoming, {
      deltas,
      matching: "id-first",
      recognizeRenames: false,
    }, accepted);
    expect(result.model?.subtypeFacts.map((sf) => sf.id)).toEqual(["sf2", "sf3"]);
    expect(result.model?.getConstraint("x")).toMatchObject({ subtypeFactIds: ["sf2", "sf3"] });
  });
});
