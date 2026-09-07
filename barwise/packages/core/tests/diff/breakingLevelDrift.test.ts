/**
 * The drift guard between the two halves of the breaking-level decision.
 *
 * `elementDiff.ts` writes prose; `breakingLevel.ts` classifies it by
 * equality, prefix and regex against those exact strings. Nothing ties
 * the two together, and they had already drifted: an object type's
 * definition change read `safe` while a standalone definition's text
 * change read `caution`, for the same conceptual change, because a
 * third producer spelled it `"definition text changed"` and the
 * classifier knew only `"definition changed"` (barwise-946).
 *
 * So this test derives the producer's side from the producer's source
 * rather than restating it. A description added to `elementDiff.ts`
 * without a classification fails here, which a hand-written list of
 * expected strings could not do -- it would simply not mention the new
 * one. That is the difference between a test that guards a pair and a
 * test that documents one.
 *
 * WS3 of `docs/specs/closed-sets-as-unions.spec.md` retires this file:
 * once a change is a discriminated variant, the compiler enforces what
 * this scanner checks, and a source scan is strictly worse than a
 * `never` default.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyKnownChange } from "../../src/diff/breakingLevel.js";
import { diffModels } from "../../src/diff/ModelDiff.js";
import { OrmModel } from "../../src/model/OrmModel.js";

const ELEMENT_DIFF = fileURLToPath(
  new URL("../../src/diff/elementDiff.ts", import.meta.url),
);

/**
 * Every change description `elementDiff.ts` can emit, as a
 * representative string.
 *
 * Each `changes.push(...)` whose first argument is a string or template
 * literal contributes one. Interpolations become `0`, which is enough
 * for every pattern the classifier uses: a prefix match reads only the
 * static head, and the one regex (`/^role \d+: name /`) wants a digit
 * where the role index goes. A spread (`changes.push(...constraintDiff)`)
 * contributes nothing, because the literals it forwards are pushed
 * inside `diffConstraints` in this same file and are found there.
 */
function emittedDescriptions(): string[] {
  const source = readFileSync(ELEMENT_DIFF, "utf8");
  const pushes = source.matchAll(/changes\.push\(\s*(`[^`]*`|"[^"]*")/g);
  const samples = new Set<string>();
  for (const match of pushes) {
    const literal = match[1]!;
    samples.add(literal.slice(1, -1).replace(/\$\{[^}]*\}/g, "0"));
  }
  return [...samples];
}

describe("breaking-level classification covers every change the diff emits", () => {
  it("finds the producer's descriptions to check against", () => {
    // A scanner that silently matches nothing would make every
    // assertion below vacuous, which is the failure mode this kind of
    // test is prone to. Pin the count's order of magnitude.
    const descriptions = emittedDescriptions();
    expect(descriptions.length).toBeGreaterThanOrEqual(15);
  });

  it("classifies every one of them explicitly", () => {
    const unclassified = emittedDescriptions().filter(
      (description) => classifyKnownChange(description) === undefined,
    );
    expect(unclassified).toEqual([]);
  });
});

describe("the same conceptual change gets the same breaking level", () => {
  /** A model carrying both an object type definition and a standalone one. */
  function model(objectTypeDefinition: string, termDefinition: string) {
    const m = new OrmModel({ name: "M" });
    m.addObjectType({
      name: "Customer",
      kind: "entity",
      referenceMode: "customer_id",
      definition: objectTypeDefinition,
    });
    m.addDefinition({ term: "Churn", definition: termDefinition });
    return m;
  }

  it("rewording a definition is safe, whichever kind of definition it is", () => {
    const { deltas } = diffModels(
      model("A buyer.", "Leaving."),
      model("A purchaser of goods.", "Ceasing to be a customer."),
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
});
