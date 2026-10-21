/**
 * The draft parser's duplicate check for constraints across fact types
 * (orm-format-3, Open decision 9, WS3b): a rule already in the model is a
 * duplicate whichever fact type holds it. For the single-fact-type kinds
 * only a hand-built model can nest one elsewhere; an equality stated from
 * each side is the case a draft reaches.
 */
import { OrmModel } from "@barwise/core";
import { describe, expect, it } from "vitest";
import type { InferredConstraint } from "../../src/ExtractionTypes.js";
import { parseConstraints } from "../../src/parse/constraints.js";

function fleet(): OrmModel {
  const model = new OrmModel({ name: "Fleet" });
  model.addObjectType({ id: "ot-p", name: "Person", kind: "entity", referenceMode: "id" });
  model.addObjectType({ id: "ot-c", name: "Car", kind: "entity", referenceMode: "vin" });
  for (const [id, name] of [["ft-owns", "Person owns Car"], ["ft-drives", "Person drives Car"]]) {
    model.addFactType({
      id,
      name,
      roles: [
        { id: `${id}-p`, name: "p", playerId: "ot-p" },
        { id: `${id}-c`, name: "c", playerId: "ot-c" },
      ],
      readings: ["{0} " + name.split(" ")[1] + " {1}"],
    });
  }
  return model;
}

const exclusion: InferredConstraint = {
  type: "exclusion",
  fact_type: "Person drives Car",
  roles: ["Person", "Car"],
  description: "rule",
  confidence: "high",
};

describe("parseConstraints across fact types", () => {
  it("skips a rule the model already holds under another fact type", () => {
    const model = fleet();
    // Nested under "Person owns Car", as a 2.0 file may; its roles are
    // all in "Person drives Car".
    model.getFactType("ft-owns")!.addConstraint({
      type: "exclusion",
      roleIds: ["ft-drives-p", "ft-drives-c"],
    });
    const [provenance] = parseConstraints([exclusion], model, []);
    expect(provenance?.applied).toBe(false);
    expect(provenance?.skipReason).toContain("Duplicate constraint");
    expect(model.constraints).toHaveLength(1);
  });

  it("skips an equality stated again from the other fact type", () => {
    const model = fleet();
    const both = (from: string, to: string): InferredConstraint => ({
      type: "equality",
      fact_type: from,
      superset_fact_type: to,
      roles: ["Person"],
      superset_roles: ["Person"],
      description: "rule",
      confidence: "high",
    });
    const provenance = parseConstraints(
      [both("Person owns Car", "Person drives Car"), both("Person drives Car", "Person owns Car")],
      model,
      [],
    );
    expect(provenance.map((p) => p.applied)).toEqual([true, false]);
    expect(model.constraints).toHaveLength(1);
  });

  it("applies it when the model holds no such rule", () => {
    const model = fleet();
    const [provenance] = parseConstraints([exclusion], model, []);
    expect(provenance?.applied).toBe(true);
    expect(model.constraints).toHaveLength(1);
  });
});
