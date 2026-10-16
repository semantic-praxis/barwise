/**
 * Constraints as one Effect Schema: the 16 kinds of the frozen
 * `ConstraintRecord` (docs/specs/effect-adoption.spec.md, WS1).
 *
 * Model form only, with camelCase keys as records carry them. The YAML codec,
 * the decoder and the problem type come later in the spike. This first cut
 * exists to take two readings: M1, whether `Arbitrary.schema` derives over the
 * union at all, and S3, whether the derived type is the record barwise-973
 * targets (`tests/types/constraintSchema.test-d.ts`).
 *
 * It states structure only. The rules a model must also satisfy (a non-empty
 * role list, `min <= max`) are not here yet, so P1 and P2 over these values
 * show self-consistency and nothing about validity.
 */
import * as Schema from "effect/Schema";

const Modality = Schema.Literals(["alethic", "deontic"]);
const RingType = Schema.Literals([
  "irreflexive",
  "asymmetric",
  "antisymmetric",
  "intransitive",
  "acyclic",
  "symmetric",
  "transitive",
  "purely_reflexive",
]);
const Operator = Schema.Literals(["<", "<=", "=", "<>", ">=", ">"]);
const RoleIds = Schema.Array(Schema.String);
const Bound = Schema.Union([Schema.Number, Schema.Literal("unbounded")]);

const ValueRange = Schema.Struct({
  min: Schema.optionalKey(Schema.String),
  max: Schema.optionalKey(Schema.String),
  minInclusive: Schema.optionalKey(Schema.Boolean),
  maxInclusive: Schema.optionalKey(Schema.Boolean),
});

const JoinOperand = Schema.Struct({
  path: Schema.Struct({
    root: Schema.String,
    steps: Schema.Array(Schema.Struct({ entry: Schema.String, exit: Schema.String })),
  }),
  projection: Schema.Array(Schema.Number),
});

/** At least two operands: barwise-973's narrowing of today's array. */
const Operands = Schema.TupleWithRest(Schema.Tuple([JoinOperand, JoinOperand]), [JoinOperand]);

const base = { id: Schema.String, modality: Modality };

export const ConstraintSchema = Schema.Union([
  Schema.Struct({
    ...base,
    type: Schema.Literal("internal_uniqueness"),
    roleIds: RoleIds,
    isPreferred: Schema.optionalKey(Schema.Boolean),
  }),
  Schema.Struct({ ...base, type: Schema.Literal("mandatory"), roleId: Schema.String }),
  Schema.Struct({ ...base, type: Schema.Literal("external_uniqueness"), roleIds: RoleIds }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("value_constraint"),
    roleId: Schema.optionalKey(Schema.String),
    values: Schema.Array(Schema.String),
    ranges: Schema.optionalKey(Schema.Array(ValueRange)),
  }),
  Schema.Struct({ ...base, type: Schema.Literal("disjunctive_mandatory"), roleIds: RoleIds }),
  Schema.Struct({ ...base, type: Schema.Literal("exclusion"), roleIds: RoleIds }),
  Schema.Struct({ ...base, type: Schema.Literal("exclusive_or"), roleIds: RoleIds }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("subset"),
    subsetRoleIds: RoleIds,
    supersetRoleIds: RoleIds,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("equality"),
    roleIds1: RoleIds,
    roleIds2: RoleIds,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("ring"),
    roleId1: Schema.String,
    roleId2: Schema.String,
    ringType: RingType,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("frequency"),
    roleIds: RoleIds,
    min: Schema.Number,
    max: Bound,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("value_comparison"),
    roleId1: Schema.String,
    roleId2: Schema.String,
    operator: Operator,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("cardinality"),
    roleId: Schema.String,
    min: Schema.Number,
    max: Bound,
  }),
  Schema.Struct({
    ...base,
    type: Schema.Literal("join_subset"),
    subset: JoinOperand,
    superset: JoinOperand,
  }),
  Schema.Struct({ ...base, type: Schema.Literal("join_equality"), operands: Operands }),
  Schema.Struct({ ...base, type: Schema.Literal("join_exclusion"), operands: Operands }),
]);

/** The constraint record as the Schema states it. */
export type ConstraintFromSchema = typeof ConstraintSchema.Type;
