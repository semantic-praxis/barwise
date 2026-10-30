/**
 * Each constraint list's decoded type holds exactly the kinds that live
 * there (docs/specs/effect-adoption.spec.md, 1r, R2): the claim the
 * decoders' narrowing to `DecodedInternalConstraint` and
 * `DecodedExternalConstraint` rests on, checked here by the compiler rather
 * than asserted at the cast (review of R2).
 */
import { describe, expectTypeOf, it } from "vitest";
import type {
  DecodedExternalConstraint,
  DecodedInternalConstraint,
  ExternalConstraintFile,
  InternalConstraintFile,
} from "../../src/decode/constraint.js";
import type { ExternalConstraint, InternalConstraint } from "../../src/model/Constraint.js";
import type { MutuallyAssignable } from "./constraintRecord.js";

/** Two unions of kinds, the same set. */
type Same<A, B> = MutuallyAssignable<A, B>;

describe("a constraint list's decoded type", () => {
  it("holds the internal kinds under a fact type, and only those", () => {
    expectTypeOf<
      Same<(typeof InternalConstraintFile)["Type"]["type"], InternalConstraint["type"]>
    >()
      .toEqualTypeOf<true>();
    expectTypeOf<Same<DecodedInternalConstraint["type"], InternalConstraint["type"]>>()
      .toEqualTypeOf<true>();
  });

  it("holds the external kinds in model.constraints, and only those", () => {
    expectTypeOf<
      Same<(typeof ExternalConstraintFile)["Type"]["type"], ExternalConstraint["type"]>
    >()
      .toEqualTypeOf<true>();
    expectTypeOf<Same<DecodedExternalConstraint["type"], ExternalConstraint["type"]>>()
      .toEqualTypeOf<true>();
  });
});
