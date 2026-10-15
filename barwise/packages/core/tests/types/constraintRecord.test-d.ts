/**
 * The S3 harness bites (docs/specs/effect-adoption.spec.md). On `main` there
 * is no derived type yet, so these check the target and the check itself:
 * that the target narrows exactly what barwise-973 says, and that a
 * candidate widened in either way, or missing a kind, is rejected. The spike
 * adds one line: `expectTypeOf<KindsMatch<Derived>>().toEqualTypeOf<AllKindsMatch>()`.
 */
import { describe, expectTypeOf, it } from "vitest";
import type {
  Constraint,
  ConstraintModality,
  JoinEqualityConstraint,
  JoinOperand,
  RingConstraint,
} from "../../src/model/Constraint.js";
import type {
  AllKindsMatch,
  ConstraintRecord,
  KindsMatch,
  MutuallyAssignable,
} from "./constraintRecord.js";

type Of<C, K extends Constraint["type"]> = Extract<C, { readonly type: K; }>;

describe("ConstraintRecord", () => {
  it("requires id and modality on every kind", () => {
    expectTypeOf<Of<ConstraintRecord, "ring">["id"]>().toEqualTypeOf<string>();
    expectTypeOf<Of<ConstraintRecord, "mandatory">["modality"]>()
      .toEqualTypeOf<ConstraintModality>();
  });

  it("narrows join operands to a tuple of at least two, and nothing else", () => {
    expectTypeOf<Of<ConstraintRecord, "join_exclusion">["operands"]>()
      .toEqualTypeOf<readonly [JoinOperand, JoinOperand, ...JoinOperand[]]>();
    expectTypeOf<
      MutuallyAssignable<
        Omit<Of<ConstraintRecord, "ring">, "id" | "modality">,
        Omit<RingConstraint, "id" | "modality">
      >
    >().toEqualTypeOf<true>();
  });

  it("is matched by itself on every kind", () => {
    expectTypeOf<KindsMatch<ConstraintRecord>>().toEqualTypeOf<AllKindsMatch>();
  });
});

describe("KindsMatch rejects", () => {
  it("today's union, whose id, modality and operands are wider than the target's", () => {
    expectTypeOf<KindsMatch<Constraint>["ring"]>().toEqualTypeOf<false>();
    expectTypeOf<KindsMatch<Constraint>["join_equality"]>().toEqualTypeOf<false>();
  });

  it("a candidate whose join operands are an array again", () => {
    type Widened =
      | Exclude<ConstraintRecord, { readonly type: "join_equality"; }>
      | (Omit<JoinEqualityConstraint, "id" | "modality"> & {
        readonly id: string;
        readonly modality: ConstraintModality;
      });
    expectTypeOf<KindsMatch<Widened>["join_equality"]>().toEqualTypeOf<false>();
    expectTypeOf<KindsMatch<Widened>["join_exclusion"]>().toEqualTypeOf<true>();
  });

  it("a candidate missing a kind", () => {
    type Missing = Exclude<ConstraintRecord, { readonly type: "cardinality"; }>;
    expectTypeOf<KindsMatch<Missing>["cardinality"]>().toEqualTypeOf<false>();
  });

  it("a candidate with a field one kind does not have", () => {
    type Extra =
      | Exclude<ConstraintRecord, { readonly type: "mandatory"; }>
      | (Of<ConstraintRecord, "mandatory"> & { readonly weight: number; });
    expectTypeOf<KindsMatch<Extra>["mandatory"]>().toEqualTypeOf<false>();
  });
});
