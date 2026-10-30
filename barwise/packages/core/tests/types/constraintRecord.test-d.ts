/**
 * Gate S3 (docs/specs/effect-adoption.spec.md), and the harness that makes
 * it bite.
 *
 * S3 itself: the record the constraint decoder builds, whose type is derived
 * from its Schemas (`DecodedConstraint`, R2), matches the frozen
 * `ConstraintRecord` kind by kind. Beside it, two checks on the instrument.
 * The frozen `ConstraintRecord` agrees with `src/` today, once barwise-973's
 * two narrowings are applied to today's union -- the drift check its comment
 * names. And `KindsMatch` rejects a candidate widened in each way, missing a
 * kind, or carrying one extra.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { DecodedConstraint } from "../../src/decode/constraint.js";
import type { Constraint, ConstraintModality, JoinOperand } from "../../src/model/Constraint.js";
import type { AllKindsMatch, ConstraintRecord, KindsMatch } from "./constraintRecord.js";

/** Today's union with barwise-973's two narrowings applied. */
type Recorded<C> = Omit<C, "id" | "modality"> & {
  readonly id: string;
  readonly modality: ConstraintModality;
};
type Narrowed<C> = C extends { readonly type: "join_equality" | "join_exclusion"; } ?
    & Omit<
      Recorded<C>,
      "operands"
    >
    & {
      readonly operands: readonly [JoinOperand, JoinOperand, ...JoinOperand[]];
    }
  : Recorded<C>;

type Of<C, K extends ConstraintRecord["type"]> = Extract<C, { readonly type: K; }>;
type Replace<K extends ConstraintRecord["type"], Member> =
  | Exclude<ConstraintRecord, { readonly type: K; }>
  | Member;

describe("S3: the decoder's record", () => {
  it("is ConstraintRecord, kind by kind", () => {
    expectTypeOf<KindsMatch<DecodedConstraint>>().toEqualTypeOf<AllKindsMatch>();
  });
});

describe("ConstraintRecord", () => {
  it("agrees with src/ today, once barwise-973's narrowings are applied", () => {
    expectTypeOf<KindsMatch<Narrowed<Constraint>>>().toEqualTypeOf<AllKindsMatch>();
  });

  it("is not today's union: id, modality and join operands are narrower", () => {
    expectTypeOf<KindsMatch<Constraint>["ring"]>().toEqualTypeOf<false>();
    expectTypeOf<KindsMatch<Constraint>["join_equality"]>().toEqualTypeOf<false>();
  });

  it("is matched by itself", () => {
    expectTypeOf<KindsMatch<ConstraintRecord>>().toEqualTypeOf<AllKindsMatch>();
  });
});

describe("KindsMatch rejects", () => {
  it("a widened field", () => {
    type Widened = Replace<
      "ring",
      Omit<Of<ConstraintRecord, "ring">, "ringType"> & { readonly ringType: string; }
    >;
    expectTypeOf<KindsMatch<Widened>["ring"]>().toEqualTypeOf<false>();
    expectTypeOf<KindsMatch<Widened>["mandatory"]>().toEqualTypeOf<true>();
  });

  it("join operands that are an array again", () => {
    type Widened = Replace<
      "join_equality",
      Omit<Of<ConstraintRecord, "join_equality">, "operands"> & {
        readonly operands: readonly JoinOperand[];
      }
    >;
    expectTypeOf<KindsMatch<Widened>["join_equality"]>().toEqualTypeOf<false>();
    expectTypeOf<KindsMatch<Widened>["join_exclusion"]>().toEqualTypeOf<true>();
  });

  it("a missing kind", () => {
    type Missing = Exclude<ConstraintRecord, { readonly type: "cardinality"; }>;
    expectTypeOf<KindsMatch<Missing>["cardinality"]>().toEqualTypeOf<false>();
  });

  it("an extra kind", () => {
    type Extra = ConstraintRecord | { readonly type: "nonesuch"; readonly id: string; };
    expectTypeOf<KindsMatch<Extra>["noExtraKinds"]>().toEqualTypeOf<false>();
  });

  it("a field one kind does not have", () => {
    type Extra = Replace<
      "mandatory",
      Of<ConstraintRecord, "mandatory"> & { readonly weight: number; }
    >;
    expectTypeOf<KindsMatch<Extra>["mandatory"]>().toEqualTypeOf<false>();
  });

  it("an optional field one kind does not have", () => {
    type Extra = Replace<
      "internal_uniqueness",
      Of<ConstraintRecord, "internal_uniqueness"> & { readonly isPreferred?: boolean; }
    >;
    expectTypeOf<KindsMatch<Extra>["internal_uniqueness"]>().toEqualTypeOf<false>();
  });

  it("a missing optional field", () => {
    type Dropped = Replace<
      "value_constraint",
      Omit<Of<ConstraintRecord, "value_constraint">, "roleId">
    >;
    expectTypeOf<KindsMatch<Dropped>["value_constraint"]>().toEqualTypeOf<false>();
  });
});
