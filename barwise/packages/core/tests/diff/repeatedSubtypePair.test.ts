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
import { mergeAndValidate } from "../../src/diff/ModelMerge.js";
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
    const { deltas } = diffModels(model, model);
    const result = mergeAndValidate(model, model, deltas, new Set());
    expect(result.model?.subtypeFacts.map((sf) => sf.id)).toEqual(["sf1", "sf2"]);
    expect(result.diagnostics.map((d) => d.ruleId)).toEqual([RULE_ID.duplicateSubtypeFact]);
  });
});
