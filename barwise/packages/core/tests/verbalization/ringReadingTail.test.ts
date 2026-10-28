/**
 * A ring sentence renders the whole reading after its subject, so text
 * after the object stays (barwise-7tx). It used to slice between the two
 * placeholders: "{0} specializes {1} as supertype" read "No EntityNode
 * specializes that same EntityNode."
 */
import { describe, expect, it } from "vitest";
import type { RingType } from "../../src/model/Constraint.js";
import { OrmModel } from "../../src/model/OrmModel.js";
import { ConstraintVerbalizer } from "../../src/verbalization/ConstraintVerbalizer.js";

function ring(reading: string, ringType: RingType): string {
  const model = new OrmModel({ name: "Test" });
  const node = model.addObjectType({ name: "Node", kind: "entity", referenceMode: "node_id" });
  const ft = model.addFactType({
    name: "Node relates to Node",
    roles: [
      { id: "r1", name: "first", playerId: node.id },
      { id: "r2", name: "second", playerId: node.id },
    ],
    readings: [reading],
    constraints: [],
  });
  const c = { type: "ring", roleId1: "r1", roleId2: "r2", ringType } as const;
  return new ConstraintVerbalizer().verbalize(c, ft, model).text;
}

describe("a ring sentence keeps the reading's text outside its placeholders", () => {
  it("keeps a tail after the object", () => {
    expect(ring("{0} specializes {1} as supertype", "irreflexive")).toBe(
      "No Node specializes that same Node as supertype.",
    );
  });

  it("keeps it in every clause of a sentence that renders several", () => {
    expect(ring("{0} specializes {1} as supertype", "transitive")).toBe(
      "If Node1 specializes Node2 as supertype and Node2 specializes Node3 as supertype"
        + " then Node1 specializes Node3 as supertype.",
    );
  });

  it("writes punctuation flush against a placeholder unspaced", () => {
    expect(ring("{0} reports to {1}'s deputy", "irreflexive")).toBe(
      "No Node reports to that same Node's deputy.",
    );
  });

  it("drops the reading's own closing period", () => {
    expect(ring("{0} reports to {1}.", "asymmetric")).toBe(
      "If Node1 reports to Node2 then Node2 does not reports to Node1.",
    );
  });

  it("writes a repeated placeholder as its role's name again", () => {
    expect(ring("{0} ranks {1} above {0}", "symmetric")).toBe(
      "If Node1 ranks Node2 above Node1 then Node2 ranks Node1 above Node2.",
    );
  });

  it("drops text before the subject, which the sentence's first word replaces", () => {
    expect(ring("the {0} precedes {1}", "irreflexive")).toBe("No Node precedes that same Node.");
  });

  it("reads a reading with no subject-first order by placeholder position", () => {
    expect(ring("{1} follows {0} in sequence", "irreflexive")).toBe(
      "No Node follows that same Node in sequence.",
    );
  });
});
