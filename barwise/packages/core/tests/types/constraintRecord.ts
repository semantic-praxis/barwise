/**
 * `ConstraintRecord`: the constraint record barwise-973 targets, frozen, and
 * the per-kind check the Effect spike's derived type is held to (gate S3 of
 * docs/specs/effect-adoption.spec.md).
 *
 * Written out in full, importing nothing from `src/`, on purpose. The spike
 * replaces `Constraint` in `src/model/Constraint.ts` with a type derived
 * from a Schema. A reference computed from that type would move with it:
 * widen `ringType` in the Schema and the reference widens too, so the
 * check would pass the regression it exists to catch. The kinds, the field
 * types, and the nested ones (`RingType`, `JoinOperand`, `ValueRange`) are
 * therefore stated here, as they were on `main` when WS0 froze them.
 *
 * This is a copy of a decision made in `src/`, so it needs a check that
 * the two agree, and it has one: on `main`, today's union with barwise-973's
 * two narrowings applied must match this kind by kind
 * (`constraintRecord.test-d.ts`). The narrowings, from
 * core-branching-load.spec.md (Target architecture): `id` and `modality`
 * required, and a join constraint's `operands` a tuple of at least two.
 * Its third narrowing, `ValueConstraintDef.ranges`, is on the object
 * type's value constraint, not on a member of this union.
 */

type ConstraintModality = "alethic" | "deontic";
type RingType =
  | "irreflexive"
  | "asymmetric"
  | "antisymmetric"
  | "intransitive"
  | "acyclic"
  | "symmetric"
  | "transitive"
  | "purely_reflexive";
type ValueComparisonOperator = "<" | "<=" | "=" | "<>" | ">=" | ">";
interface ValueRange {
  readonly min?: string;
  readonly max?: string;
  readonly minInclusive?: boolean;
  readonly maxInclusive?: boolean;
}
interface JoinOperand {
  readonly path: {
    readonly root: string;
    readonly steps: readonly { readonly entry: string; readonly exit: string; }[];
  };
  readonly projection: readonly number[];
}
type Operands = readonly [JoinOperand, JoinOperand, ...JoinOperand[]];

interface Base {
  readonly id: string;
  readonly modality: ConstraintModality;
}

/** The record barwise-973 targets, one member per constraint kind. */
export type ConstraintRecord =
  | (Base & {
    readonly type: "internal_uniqueness";
    readonly roleIds: readonly string[];
    readonly isPreferred?: boolean;
  })
  | (Base & { readonly type: "mandatory"; readonly roleId: string; })
  | (Base & { readonly type: "external_uniqueness"; readonly roleIds: readonly string[]; })
  | (Base & {
    readonly type: "value_constraint";
    readonly roleId?: string;
    readonly values: readonly string[];
    readonly ranges?: readonly ValueRange[];
  })
  | (Base & { readonly type: "disjunctive_mandatory"; readonly roleIds: readonly string[]; })
  | (Base & { readonly type: "exclusion"; readonly roleIds: readonly string[]; })
  | (Base & { readonly type: "exclusive_or"; readonly roleIds: readonly string[]; })
  | (Base & {
    readonly type: "subset";
    readonly subsetRoleIds: readonly string[];
    readonly supersetRoleIds: readonly string[];
  })
  | (Base & {
    readonly type: "equality";
    readonly roleIds1: readonly string[];
    readonly roleIds2: readonly string[];
  })
  | (Base & {
    readonly type: "ring";
    readonly roleId1: string;
    readonly roleId2: string;
    readonly ringType: RingType;
  })
  | (Base & {
    readonly type: "frequency";
    readonly roleIds: readonly string[];
    readonly min: number;
    readonly max: number | "unbounded";
  })
  | (Base & {
    readonly type: "value_comparison";
    readonly roleId1: string;
    readonly roleId2: string;
    readonly operator: ValueComparisonOperator;
  })
  | (Base & {
    readonly type: "cardinality";
    readonly roleId: string;
    readonly min: number;
    readonly max: number | "unbounded";
  })
  | (Base & {
    readonly type: "join_subset";
    readonly subset: JoinOperand;
    readonly superset: JoinOperand;
  })
  | (Base & { readonly type: "join_equality"; readonly operands: Operands; })
  | (Base & { readonly type: "join_exclusion"; readonly operands: Operands; });

/** Each assignable to the other: the comparison S3 names. */
export type MutuallyAssignable<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false)
  : false;

/**
 * For each kind of the frozen record, whether `Candidate`'s member of that
 * kind and the record's are mutually assignable, and whether `Candidate`
 * has a kind the record does not. Keyed on the record's kinds, not on
 * `src/`'s, so a candidate that drops a kind reads `false` for it rather
 * than losing the key.
 */
export type KindsMatch<Candidate extends { readonly type: string; }> =
  & {
    [K in ConstraintRecord["type"]]: MutuallyAssignable<
      Extract<Candidate, { readonly type: K; }>,
      Extract<ConstraintRecord, { readonly type: K; }>
    >;
  }
  & {
    readonly noExtraKinds: [Exclude<Candidate["type"], ConstraintRecord["type"]>] extends [never]
      ? true
      : false;
  };

/** What `KindsMatch` reads when every kind matches and none is extra. */
export type AllKindsMatch = { [K in ConstraintRecord["type"]]: true; } & {
  readonly noExtraKinds: true;
};
