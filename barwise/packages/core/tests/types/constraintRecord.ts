/**
 * `ConstraintRecord`: the constraint record barwise-973 targets, and the
 * per-kind check the Effect spike's derived type is held to (gate S3 of
 * docs/specs/effect-adoption.spec.md).
 *
 * The target is today's union with the two narrowings
 * core-branching-load.spec.md (Target architecture) makes to it: `id` and
 * `modality` required on the record, and a join constraint's `operands` a
 * tuple of at least two. Its third narrowing, `ValueConstraintDef.ranges`,
 * is on the object type's value constraint, not on a member of this union.
 *
 * It is a mapped type over `Constraint` rather than sixteen interfaces
 * written out, so a kind added to the union is in the target with nothing
 * to update, and the two narrowings are the only statement of what
 * differs. Comparing a derived type with today's union instead would fail
 * a correct conversion, because the conversion makes these narrowings too.
 */
import type { Constraint, ConstraintModality, JoinOperand } from "../../src/model/Constraint.js";

type Recorded<C> = Omit<C, "id" | "modality"> & {
  readonly id: string;
  readonly modality: ConstraintModality;
};

type Narrowed<C> = C extends { readonly type: "join_equality" | "join_exclusion"; }
  ? Omit<Recorded<C>, "operands"> & {
    readonly operands: readonly [JoinOperand, JoinOperand, ...JoinOperand[]];
  }
  : Recorded<C>;

/** The record barwise-973 targets, one member per constraint kind. */
export type ConstraintRecord = Narrowed<Constraint>;

/** Each assignable to the other: the comparison S3 names. */
export type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false)
  : false;

/**
 * For each kind of today's union, whether `Candidate`'s member of that kind
 * and the target's are mutually assignable. A kind `Candidate` lacks reads
 * `false`, since `never` is not assignable from the target's member.
 */
export type KindsMatch<Candidate> = {
  [K in Constraint["type"]]: MutuallyAssignable<
    Extract<Candidate, { readonly type: K; }>,
    Extract<ConstraintRecord, { readonly type: K; }>
  >;
};

/** What `KindsMatch` reads when every kind matches. */
export type AllKindsMatch = { [K in Constraint["type"]]: true; };
