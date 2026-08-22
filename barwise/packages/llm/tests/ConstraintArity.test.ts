/**
 * Conformance and validation must agree about constraint arity.
 *
 * They did not. `isValidArity` fell through to a permissive `>= 1` for
 * `disjunctive_mandatory`, `exclusion`, and `exclusive_or`, while
 * `constraintConsistency` rejects exactly those three below two roles.
 * Conformance therefore waved through constraints the validator was
 * guaranteed to reject a moment later, and every one became a
 * validation error the extraction had no way to avoid.
 *
 * The cost was measured on the dev split before it was understood:
 * `incident-response` scored 0.000 on seven such errors and
 * `subscription-billing` lost 0.1 to one. Nothing failed; the pipeline
 * simply produced models it already knew were invalid.
 *
 * The last test here is the one that matters. Checking the removal
 * behaviour alone would re-pin one side of a disagreement; what needs
 * guarding is that the two modules agree at all, which is a property of
 * the pair and not of either.
 *
 * Validation runs through `ValidationEngine` because that is what
 * `scoreExtraction` uses; a different entry point could agree here and
 * still cost the score.
 */
import { ValidationEngine } from "@barwise/core";
import { describe, expect, it } from "vitest";
import { parseDraftModel } from "../src/DraftModelParser.js";
import { enforceConformance } from "../src/ExtractionConformance.js";
import type { ExtractionResponse, InferredConstraintType } from "../src/ExtractionTypes.js";

const REF = [{ lines: [1, 2] as [number, number], excerpt: "test" }];

/** The three types whose arity the two modules disagreed about. */
const MULTI_ROLE: readonly InferredConstraintType[] = [
  "disjunctive_mandatory",
  "exclusion",
  "exclusive_or",
];

/**
 * A two-role fact type plus a constraint over however many of its roles
 * the caller names -- the smallest shape that can express the bug.
 */
function responseWith(
  type: InferredConstraintType,
  roles: readonly string[],
): ExtractionResponse {
  return {
    // No reference_mode: an entity declaring one without an identifier
    // fact type raises its own correction, which would sit alongside
    // the arity one and make these counts a test of the fixture.
    object_types: [
      { name: "Incident", kind: "entity", source_references: REF },
      { name: "Alert", kind: "entity", source_references: REF },
    ],
    fact_types: [
      {
        name: "Incident originates from Alert",
        reading: "Incident originates from Alert",
        roles: [
          { player: "Incident", name: "originator" },
          { player: "Alert", name: "origin" },
        ],
        source_references: REF,
      },
    ],
    subtypes: [],
    inferred_constraints: [
      {
        type,
        fact_type: "Incident originates from Alert",
        roles,
        description: `${type} over ${roles.length} role(s)`,
        confidence: "high",
      },
    ],
    ambiguities: [],
  };
}

describe("a multi-role constraint covering only one role", () => {
  it.each(MULTI_ROLE)("is removed rather than passed on (%s)", (type) => {
    const { response, corrections } = enforceConformance(responseWith(type, ["Incident"]));

    expect(response.inferred_constraints).toHaveLength(0);
    const arity = corrections.filter((c) => c.category === "arity_mismatch");
    expect(arity).toHaveLength(1);
    expect(arity[0]!.description).toContain("at least 2");
  });

  it.each(MULTI_ROLE)("survives when it covers two (%s)", (type) => {
    // The correction must not be so eager that it deletes the valid
    // case: a real disjunction over two roles is the whole point of
    // these constraint types.
    const { response, corrections } = enforceConformance(
      responseWith(type, ["Incident", "Alert"]),
    );

    expect(response.inferred_constraints).toHaveLength(1);
    expect(corrections.filter((c) => c.category === "arity_mismatch")).toEqual([]);
  });
});

describe("conformance and validation agree", () => {
  it.each(MULTI_ROLE)(
    "produces no arity error for a single-role %s that reached the model",
    (type) => {
      // The invariant, stated end to end: whatever survives conformance
      // must not trip the validator's arity rule. Asserting removal
      // alone would pin one side of a disagreement rather than the
      // agreement itself -- and a future change that relaxed either
      // module would pass such a test while re-creating the bug.
      const { response } = enforceConformance(responseWith(type, ["Incident"]));
      const { model } = parseDraftModel(response, "Arity");
      const diagnostics = new ValidationEngine().validate(model);

      const arityErrors = diagnostics.filter((d) =>
        d.severity === "error" && /must reference at least 2 roles/.test(d.message)
      );
      expect(arityErrors).toEqual([]);
    },
  );

  it("charges a conformance correction, not a validation error", () => {
    // Weighted differently on purpose (0.02 against 0.1): a dropped
    // malformed constraint is a smaller failure than a model that does
    // not validate, and the scorer should say so. Before the fix this
    // extraction paid the larger price for the same defect.
    const { response, corrections } = enforceConformance(
      responseWith("disjunctive_mandatory", ["Incident"]),
    );
    const { model } = parseDraftModel(response, "Arity");

    expect(corrections.filter((c) => c.category === "arity_mismatch")).toHaveLength(1);
    const errors = new ValidationEngine().validate(model)
      .filter((d) => d.severity === "error");
    expect(errors).toEqual([]);
  });
});

/**
 * Frequency bounds, found the same way and the same class of defect:
 * the validator rejects min < 1 and a max below its min, conformance
 * checked neither, and the gap became an unavoidable validation error.
 *
 * `clinic-appointments` lost 0.1 to exactly this on the first clean
 * train sweep -- "Frequency constraint in fact type 'Appointment has
 * FollowUpNote' has min 0, which must be at least 1."
 */
describe("a frequency constraint with unusable bounds", () => {
  function frequency(min: number, max?: number | "unbounded"): ExtractionResponse {
    const base = responseWith("frequency", ["Incident"]);
    return {
      ...base,
      inferred_constraints: [{
        type: "frequency",
        fact_type: "Incident originates from Alert",
        roles: ["Incident"],
        description: `frequency ${min}..${String(max)}`,
        confidence: "high",
        min,
        ...(max !== undefined ? { max } : {}),
      }],
    };
  }

  it("is removed when its minimum is below one", () => {
    // "At least 0" is not a weak constraint, it is no constraint --
    // every population satisfies it -- so nothing a reader could have
    // relied on is lost by dropping it.
    const { response, corrections } = enforceConformance(frequency(0));

    expect(response.inferred_constraints).toHaveLength(0);
    expect(corrections.filter((c) => c.category === "invalid_bounds")).toHaveLength(1);
  });

  it("is removed when its maximum is below its minimum", () => {
    const { response, corrections } = enforceConformance(frequency(3, 2));

    expect(response.inferred_constraints).toHaveLength(0);
    expect(corrections.filter((c) => c.category === "invalid_bounds")).toHaveLength(1);
  });

  it("survives with usable bounds", () => {
    const { response, corrections } = enforceConformance(frequency(1, 5));

    expect(response.inferred_constraints).toHaveLength(1);
    expect(corrections.filter((c) => c.category === "invalid_bounds")).toEqual([]);
  });

  it("survives an unbounded maximum", () => {
    const { response } = enforceConformance(frequency(2, "unbounded"));

    expect(response.inferred_constraints).toHaveLength(1);
  });

  it("leaves the model free of frequency errors, end to end", () => {
    // The invariant again, as a property of the pair rather than of
    // either module: whatever survives conformance must not trip the
    // validator's frequency rules.
    for (const bad of [frequency(0), frequency(3, 2)]) {
      const { response } = enforceConformance(bad);
      const { model } = parseDraftModel(response, "Bounds");
      const errors = new ValidationEngine().validate(model)
        .filter((d) => d.severity === "error" && /Frequency constraint/.test(d.message));
      expect(errors).toEqual([]);
    }
  });
});
