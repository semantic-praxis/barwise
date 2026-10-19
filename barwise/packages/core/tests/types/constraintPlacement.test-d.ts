/**
 * The placement types are derived from `PLACEMENT` in `model/Constraint.ts`
 * (docs/specs/orm-format-3.spec.md, WS3), so these pin what the derivation
 * yields: the seven internal kinds, the nine external ones, and nothing
 * lost or shared between them. A kind reclassified in the table, or added
 * to the union, changes one of these and fails here until the spec's
 * placement table and this list agree.
 */
import { describe, expectTypeOf, it } from "vitest";
import type {
  Constraint,
  ExternalConstraint,
  InternalConstraint,
} from "../../src/model/Constraint.js";

describe("constraint placement types", () => {
  it("InternalConstraint holds exactly the kinds that live in a fact type", () => {
    expectTypeOf<InternalConstraint["type"]>().toEqualTypeOf<
      | "internal_uniqueness"
      | "mandatory"
      | "value_constraint"
      | "ring"
      | "frequency"
      | "cardinality"
      | "value_comparison"
    >();
  });

  it("ExternalConstraint holds exactly the kinds that live in the model", () => {
    expectTypeOf<ExternalConstraint["type"]>().toEqualTypeOf<
      | "external_uniqueness"
      | "disjunctive_mandatory"
      | "exclusion"
      | "exclusive_or"
      | "subset"
      | "equality"
      | "join_subset"
      | "join_equality"
      | "join_exclusion"
    >();
  });

  it("the two placements partition the union", () => {
    expectTypeOf<InternalConstraint | ExternalConstraint>().toEqualTypeOf<Constraint>();
    expectTypeOf<Extract<InternalConstraint, ExternalConstraint>>().toEqualTypeOf<never>();
  });
});
