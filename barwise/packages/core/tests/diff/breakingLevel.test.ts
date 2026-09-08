/**
 * The breaking level a change reports.
 *
 * Completeness is the compiler's job now -- `CHANGE_LEVEL` is a
 * `Record<ChangeKind, BreakingLevel>`, so an unclassified variant does
 * not build. What is left for a test is the judgement the table
 * encodes, and one pairing in particular: the same conceptual change
 * on two different element kinds must read the same level. It did not,
 * for as long as the classifier matched sentences (barwise-946).
 */

import { describe, expect, it } from "vitest";
import { classifyBreakingLevel, classifyChange } from "../../src/diff/breakingLevel.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { OrmModel } from "../../src/model/OrmModel.js";

describe("the same conceptual change gets the same breaking level", () => {
  /** A model carrying both an object type definition and a standalone one. */
  function model(objectTypeDefinition: string, termDefinition: string, context: string) {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      definition: objectTypeDefinition,
      sourceContext: context,
    });
    m.addDefinition({ term: "Churn", definition: termDefinition, context });
    return m;
  }

  it("rewording a definition is safe, whichever kind of definition it is", () => {
    const { deltas } = diffModels(
      model("A buyer.", "Leaving.", "Sales"),
      model("A purchaser of goods.", "Ceasing to be a customer.", "Sales"),
    );
    const modified = deltas.filter((d) => d.kind === "modified");

    expect(modified).toHaveLength(2);
    for (const delta of modified) {
      expect(
        delta.breakingLevel,
        `${delta.elementType} ${JSON.stringify(delta.changeDescriptions)}`,
      ).toBe("safe");
    }
  });

  it("changing a bounded context is safe, whichever kind of element carries it", () => {
    const { deltas } = diffModels(
      model("A buyer.", "Leaving.", "Sales"),
      model("A buyer.", "Leaving.", "Fulfilment"),
    );
    const modified = deltas.filter((d) => d.kind === "modified");

    expect(modified).toHaveLength(2);
    for (const delta of modified) {
      expect(
        delta.breakingLevel,
        `${delta.elementType} ${JSON.stringify(delta.changeDescriptions)}`,
      ).toBe("safe");
    }
  });

  it("classifies the two spellings of each pair identically", () => {
    expect(classifyChange({ change: "definitionText", from: "a", to: "b" }))
      .toBe(classifyChange({ change: "definition", from: "a", to: "b" }));
    expect(classifyChange({ change: "context", from: "a", to: "b" }))
      .toBe(classifyChange({ change: "sourceContext", from: "a", to: "b" }));
  });
});

describe("the most severe change decides the delta", () => {
  it("takes breaking over caution over safe", () => {
    const safe = { change: "note", from: "a", to: "b" } as const;
    const caution = { change: "cardinality", from: undefined, to: { min: 1, max: 5 } } as const;
    const breaking = { change: "arity", from: 2, to: 3 } as const;

    expect(classifyBreakingLevel("modified", [safe], "object_type")).toBe("safe");
    expect(classifyBreakingLevel("modified", [safe, caution], "object_type")).toBe("caution");
    expect(classifyBreakingLevel("modified", [safe, caution, breaking], "object_type")).toBe(
      "breaking",
    );
  });

  it("reads a change kind it has never heard of as caution, not safe", () => {
    // Unreachable for anything this build produced -- the table is
    // total. Reachable for a delta that crossed a version boundary as
    // JSON, which is the path `changes` exists to serve. Without the
    // fallback the lookup yields undefined, which the loop below reads
    // as neither breaking nor caution and so reports as safe: the one
    // direction this must not fail in.
    const fromTheFuture = { change: "somethingLater", from: "a", to: "b" } as unknown as Parameters<
      typeof classifyChange
    >[0];
    expect(classifyChange(fromTheFuture)).toBe("caution");
    expect(classifyBreakingLevel("modified", [fromTheFuture], "object_type")).toBe("caution");
  });

  it("decides add, remove and unchanged from the kind alone", () => {
    const breaking = { change: "arity", from: 2, to: 3 } as const;
    expect(classifyBreakingLevel("added", [breaking], "object_type")).toBe("safe");
    expect(classifyBreakingLevel("unchanged", [breaking], "object_type")).toBe("safe");
    expect(classifyBreakingLevel("removed", [], "object_type")).toBe("breaking");
    // A population is data, not shape: losing its tuples changes what
    // validation can say, not what a consumer binds to. Left at
    // breaking, every transcript import reported one, because extraction
    // marks its populations as samples.
    expect(classifyBreakingLevel("removed", [], "population")).toBe("caution");
  });
});
