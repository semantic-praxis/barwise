/**
 * What the element-label table has to guarantee, and what the compiler
 * cannot check on its own.
 *
 * Completeness is the compiler's job: `ELEMENT_LABEL` is a
 * `Record<ElementType, string>`, so a kind added to the union without a
 * label is a missing key, and `elementName` falls off its end without a
 * matching arm. Both were watched failing on a planted `subtype_fact`
 * variant before this file was written.
 *
 * What a type cannot say is what the labels READ like -- and these
 * strings are displayed by `barwise diff`, `barwise history` and the VS
 * Code review panel, where three byte-identical copies of `deltaLabel`
 * used to live with nothing guarding the triplicate. The goldens below
 * are what those three printed before they became one call.
 */

import { describe, expect, it } from "vitest";
import {
  deltaLabel,
  ELEMENT_TYPES,
  elementLabel,
  elementName,
  type ElementType,
  type ModelDelta,
} from "../../src/diff/deltas.js";

/** A minimal delta of each kind; only the identity fields matter here. */
const SAMPLES: ReadonlyArray<{ delta: ModelDelta; label: string; }> = [
  {
    delta: {
      kind: "modified",
      elementType: "object_type",
      name: "Customer",
      changes: [],
      changeDescriptions: [],
      breakingLevel: "safe",
    },
    label: "Object type: Customer",
  },
  {
    delta: {
      kind: "added",
      elementType: "fact_type",
      name: "CustomerPlacesOrder",
      changes: [],
      changeDescriptions: [],
      breakingLevel: "safe",
    },
    label: "Fact type: CustomerPlacesOrder",
  },
  {
    delta: {
      kind: "removed",
      elementType: "definition",
      term: "Churn",
      changes: [],
      changeDescriptions: [],
      breakingLevel: "breaking",
    },
    label: "Definition: Churn",
  },
  {
    delta: {
      kind: "modified",
      elementType: "subtype_fact",
      subtype: { id: "ot-manager", name: "Manager" },
      supertype: { id: "ot-employee", name: "Employee" },
      changes: [],
      changeDescriptions: [],
      breakingLevel: "caution",
    },
    // The verbalizer's own phrasing, so the diff names the element the
    // way the rest of the product already talks about it.
    label: "Subtype fact: Manager is a subtype of Employee",
  },
  {
    delta: {
      kind: "added",
      elementType: "objectified_fact_type",
      objectType: { id: "ot-enrolment", name: "Enrolment" },
      factType: { id: "ft-sc", name: "StudentTakesCourse" },
      changes: [],
      changeDescriptions: [],
      breakingLevel: "safe",
    },
    label: "Objectification: Enrolment objectifies StudentTakesCourse",
  },
];

describe("labelling a delta", () => {
  it("has a sample for every element kind the union carries", () => {
    const covered = new Set<ElementType>(SAMPLES.map((s) => s.delta.elementType));
    expect(ELEMENT_TYPES.filter((t) => !covered.has(t))).toEqual([]);
  });

  it("labels every kind distinctly", () => {
    const labels = ELEMENT_TYPES.map(elementLabel);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.every((l) => l.length > 0)).toBe(true);
  });

  for (const { delta, label } of SAMPLES) {
    it(`renders a ${delta.elementType} as the three surfaces rendered it`, () => {
      expect(deltaLabel(delta)).toBe(label);
    });
  }

  it("names a definition by its term and everything else by its name", () => {
    // The two-case expression four files repeated. A definition has no
    // `name` and the others have no `term`, so this is the whole of what
    // `elementName` knows -- and the reason it exists rather than being
    // written out at each call site.
    expect(elementName(SAMPLES[2]!.delta)).toBe("Churn");
    expect(elementName(SAMPLES[0]!.delta)).toBe("Customer");
  });
});
