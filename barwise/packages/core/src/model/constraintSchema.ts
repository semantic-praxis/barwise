/**
 * Constraints as Effect Schema: the 16 kinds of the frozen `ConstraintRecord`
 * (docs/specs/effect-adoption.spec.md, WS1), as records and as a file spells
 * them.
 *
 * `ConstraintSchema` is the record, with the file format's rules stated as
 * checks, so a derived value is one the hand-written JSON Schema accepts (P3).
 * `ConstraintYamlCodec` reads a file's constraint into that record. The file
 * is not the record with snake_case keys, so each kind maps explicitly:
 * `modality` defaults to alethic and is omitted when alethic, `is_preferred`
 * is written only when true, a frequency names one role as `role` and several
 * as `roles`, and a value constraint's empty lists are omitted. Writing a file
 * stays with the hand-written serializer, as for object types, so the bytes
 * (gate S2) cannot move.
 *
 * Each field's rule is stated on the file shape as well as the record, so a
 * decode reports every field's problem at once: a rule only on the record
 * runs after the file shape has passed, and a constraint with an unknown
 * field never had its other fields checked. Rules across fields (max >= min)
 * stay on the record, where the fields they compare are known to be valid.
 *
 * The decoder requires every id (decision 8). A file may omit a constraint's
 * id, so the loader fills it before decoding.
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { ValueRangeFromFile, ValueRangeSchema } from "./valueRangeSchema.js";

// -- Leaves -----------------------------------------------------------------

const Modality = Schema.Literals(["alethic", "deontic"]);
type Modality = typeof Modality.Type;
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

const RoleId = Schema.String.check(Schema.isMinLength(1));
const RoleIds = Schema.Array(RoleId).check(Schema.isMinLength(1));
const TwoOrMoreRoleIds = Schema.Array(RoleId).check(Schema.isMinLength(2));

const AtLeast = (min: number) => Schema.Int.check(Schema.isGreaterThanOrEqualTo(min));
const Bound = (min: number) => Schema.Union([AtLeast(min), Schema.Literal("unbounded")]);
/** Reported at `max`, so a problem names the field a reader would change. */
const minNotAboveMax = Schema.makeFilter(
  (c: { readonly min: number; readonly max: number | "unbounded"; }) =>
    c.max === "unbounded" || c.min <= c.max || { path: ["max"], issue: "must have max >= min." },
);

const JoinOperand = Schema.Struct({
  path: Schema.Struct({
    root: RoleId,
    steps: Schema.Array(Schema.Struct({ entry: RoleId, exit: RoleId })),
  }),
  projection: Schema.Array(AtLeast(0)),
});

/** At least two operands: barwise-973's narrowing of today's array. */
const Operands = Schema.TupleWithRest(Schema.Tuple([JoinOperand, JoinOperand]), [JoinOperand]);

/**
 * Preferred, or absent: a file writes `is_preferred` only when true and reads
 * `false` as absent, so the record's canonical form never holds `false`.
 */
const PreferredFlag = Schema.Boolean.check(
  Schema.makeFilter((b: boolean) => b === true, { message: "is not preferred by default." }),
);

// -- Records ----------------------------------------------------------------

/**
 * A constraint's id is never empty. Today's reader and writer both treat `""`
 * as no id (the writer omits it, and the reader mints one), so an empty id
 * could not survive a save; the loader fills it like a missing one.
 */
const base = { id: Schema.String.check(Schema.isMinLength(1)), modality: Modality };

const InternalUniqueness = Schema.Struct({
  ...base,
  type: Schema.Literal("internal_uniqueness"),
  roleIds: RoleIds,
  isPreferred: Schema.optionalKey(PreferredFlag),
});
const Mandatory = Schema.Struct({ ...base, type: Schema.Literal("mandatory"), roleId: RoleId });
const ExternalUniqueness = Schema.Struct({
  ...base,
  type: Schema.Literal("external_uniqueness"),
  roleIds: RoleIds,
});
const ValueConstraint = Schema.Struct({
  ...base,
  type: Schema.Literal("value_constraint"),
  roleId: Schema.optionalKey(RoleId),
  values: Schema.Array(Schema.String),
  ranges: Schema.optionalKey(Schema.Array(ValueRangeSchema).check(Schema.isMinLength(1))),
}).check(
  Schema.makeFilter(
    (c: { readonly values: readonly string[]; readonly ranges?: readonly unknown[]; }) =>
      c.values.length > 0 || c.ranges !== undefined
      || { path: ["values"], issue: "must have values or ranges." },
  ),
);
const DisjunctiveMandatory = Schema.Struct({
  ...base,
  type: Schema.Literal("disjunctive_mandatory"),
  roleIds: TwoOrMoreRoleIds,
});
const Exclusion = Schema.Struct({
  ...base,
  type: Schema.Literal("exclusion"),
  roleIds: TwoOrMoreRoleIds,
});
const ExclusiveOr = Schema.Struct({
  ...base,
  type: Schema.Literal("exclusive_or"),
  roleIds: TwoOrMoreRoleIds,
});
const Subset = Schema.Struct({
  ...base,
  type: Schema.Literal("subset"),
  subsetRoleIds: RoleIds,
  supersetRoleIds: RoleIds,
});
const Equality = Schema.Struct({
  ...base,
  type: Schema.Literal("equality"),
  roleIds1: RoleIds,
  roleIds2: RoleIds,
});
const Ring = Schema.Struct({
  ...base,
  type: Schema.Literal("ring"),
  roleId1: RoleId,
  roleId2: RoleId,
  ringType: RingType,
});
const Frequency = Schema.Struct({
  ...base,
  type: Schema.Literal("frequency"),
  roleIds: RoleIds,
  min: AtLeast(1),
  max: Bound(1),
}).check(minNotAboveMax);
const ValueComparison = Schema.Struct({
  ...base,
  type: Schema.Literal("value_comparison"),
  roleId1: RoleId,
  roleId2: RoleId,
  operator: Operator,
});
const Cardinality = Schema.Struct({
  ...base,
  type: Schema.Literal("cardinality"),
  roleId: RoleId,
  min: AtLeast(0),
  max: Bound(0),
}).check(minNotAboveMax);
const JoinSubset = Schema.Struct({
  ...base,
  type: Schema.Literal("join_subset"),
  subset: JoinOperand,
  superset: JoinOperand,
});
const JoinEquality = Schema.Struct({
  ...base,
  type: Schema.Literal("join_equality"),
  operands: Operands,
});
const JoinExclusion = Schema.Struct({
  ...base,
  type: Schema.Literal("join_exclusion"),
  operands: Operands,
});

export const ConstraintSchema = Schema.Union([
  InternalUniqueness,
  Mandatory,
  ExternalUniqueness,
  ValueConstraint,
  DisjunctiveMandatory,
  Exclusion,
  ExclusiveOr,
  Subset,
  Equality,
  Ring,
  Frequency,
  ValueComparison,
  Cardinality,
  JoinSubset,
  JoinEquality,
  JoinExclusion,
]);

/** The constraint record as the Schema states it. */
export type ConstraintFromSchema = typeof ConstraintSchema.Type;

// -- As a file spells them --------------------------------------------------

const fileBase = { id: Schema.String, modality: Schema.optionalKey(Modality) };
type FileBase = { readonly id: string; readonly modality?: Modality; };

/** Alethic is the default: read as the default, written by omission. */
function readBase(f: FileBase): { id: string; modality: Modality; } {
  return { id: f.id, modality: f.modality ?? "alethic" };
}
function writeBase(r: { readonly id: string; readonly modality: Modality; }): FileBase {
  return r.modality === "deontic" ? { id: r.id, modality: "deontic" } : { id: r.id };
}

/** A file shape read into its record, and the record written back. */
function kind<F extends Schema.Top, R extends Schema.Top>(
  file: F,
  record: R,
  read: (f: F["Type"]) => R["Encoded"],
  write: (r: R["Encoded"]) => F["Type"],
) {
  return file.pipe(
    Schema.decodeTo(record, SchemaTransformation.transform({ decode: read, encode: write })),
  );
}

/** The file shape of a kind that names its roles as `roles`. */
const roles = <T extends string>(type: T, list: typeof RoleIds = RoleIds) =>
  Schema.Struct({ ...fileBase, type: Schema.Literal(type), roles: list });

export const ConstraintYamlCodec = Schema.Union([
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("internal_uniqueness"),
      roles: RoleIds,
      is_preferred: Schema.optionalKey(Schema.Boolean),
    }),
    InternalUniqueness,
    (f) => ({
      ...readBase(f),
      type: f.type,
      roleIds: f.roles,
      ...(f.is_preferred ? { isPreferred: true } : {}),
    }),
    (r) => ({
      ...writeBase(r),
      type: r.type,
      roles: r.roleIds,
      ...(r.isPreferred ? { is_preferred: true } : {}),
    }),
  ),
  kind(
    Schema.Struct({ ...fileBase, type: Schema.Literal("mandatory"), role: RoleId }),
    Mandatory,
    (f) => ({ ...readBase(f), type: f.type, roleId: f.role }),
    (r) => ({ ...writeBase(r), type: r.type, role: r.roleId }),
  ),
  kind(
    roles("external_uniqueness"),
    ExternalUniqueness,
    (f) => ({ ...readBase(f), type: f.type, roleIds: f.roles }),
    (r) => ({ ...writeBase(r), type: r.type, roles: r.roleIds }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("value_constraint"),
      role: Schema.optionalKey(RoleId),
      values: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
      ranges: Schema.optionalKey(Schema.Array(ValueRangeFromFile).check(Schema.isMinLength(1))),
    }),
    ValueConstraint,
    (f) => ({
      ...readBase(f),
      type: f.type,
      ...(f.role !== undefined ? { roleId: f.role } : {}),
      values: f.values ?? [],
      ...(f.ranges && f.ranges.length > 0 ? { ranges: f.ranges } : {}),
    }),
    (r) => ({
      ...writeBase(r),
      type: r.type,
      ...(r.roleId !== undefined ? { role: r.roleId } : {}),
      ...(r.values.length > 0 ? { values: r.values } : {}),
      ...(r.ranges && r.ranges.length > 0 ? { ranges: r.ranges } : {}),
    }),
  ),
  kind(
    roles("disjunctive_mandatory", TwoOrMoreRoleIds),
    DisjunctiveMandatory,
    (f) => ({ ...readBase(f), type: f.type, roleIds: f.roles }),
    (r) => ({ ...writeBase(r), type: r.type, roles: r.roleIds }),
  ),
  kind(
    roles("exclusion", TwoOrMoreRoleIds),
    Exclusion,
    (f) => ({ ...readBase(f), type: f.type, roleIds: f.roles }),
    (r) => ({ ...writeBase(r), type: r.type, roles: r.roleIds }),
  ),
  kind(
    roles("exclusive_or", TwoOrMoreRoleIds),
    ExclusiveOr,
    (f) => ({ ...readBase(f), type: f.type, roleIds: f.roles }),
    (r) => ({ ...writeBase(r), type: r.type, roles: r.roleIds }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("subset"),
      subset_roles: RoleIds,
      superset_roles: RoleIds,
    }),
    Subset,
    (f) => ({
      ...readBase(f),
      type: f.type,
      subsetRoleIds: f.subset_roles,
      supersetRoleIds: f.superset_roles,
    }),
    (r) => ({
      ...writeBase(r),
      type: r.type,
      subset_roles: r.subsetRoleIds,
      superset_roles: r.supersetRoleIds,
    }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("equality"),
      roles_1: RoleIds,
      roles_2: RoleIds,
    }),
    Equality,
    (f) => ({ ...readBase(f), type: f.type, roleIds1: f.roles_1, roleIds2: f.roles_2 }),
    (r) => ({ ...writeBase(r), type: r.type, roles_1: r.roleIds1, roles_2: r.roleIds2 }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("ring"),
      role_1: RoleId,
      role_2: RoleId,
      ring_type: RingType,
    }),
    Ring,
    (f) => ({
      ...readBase(f),
      type: f.type,
      roleId1: f.role_1,
      roleId2: f.role_2,
      ringType: f.ring_type,
    }),
    (r) => ({
      ...writeBase(r),
      type: r.type,
      role_1: r.roleId1,
      role_2: r.roleId2,
      ring_type: r.ringType,
    }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("frequency"),
      role: Schema.optionalKey(RoleId),
      roles: Schema.optionalKey(RoleIds),
      min: AtLeast(1),
      max: Bound(1),
    }),
    Frequency,
    (f) => ({
      ...readBase(f),
      type: f.type,
      // `roles` wins over `role` when a file gives both, as main's loader
      // reads it; the schema allows the pair, and the silent drop is
      // barwise-plc. Matching main here is what keeps S1 a comparison.
      roleIds: f.roles ?? (f.role !== undefined ? [f.role] : []),
      min: f.min,
      max: f.max,
    }),
    (r) => ({
      ...writeBase(r),
      type: r.type,
      ...(r.roleIds.length === 1 ? { role: r.roleIds[0]! } : { roles: r.roleIds }),
      min: r.min,
      max: r.max,
    }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("value_comparison"),
      role_1: RoleId,
      role_2: RoleId,
      operator: Operator,
    }),
    ValueComparison,
    (f) => ({
      ...readBase(f),
      type: f.type,
      roleId1: f.role_1,
      roleId2: f.role_2,
      operator: f.operator,
    }),
    (r) => ({
      ...writeBase(r),
      type: r.type,
      role_1: r.roleId1,
      role_2: r.roleId2,
      operator: r.operator,
    }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("cardinality"),
      role: RoleId,
      min: AtLeast(0),
      max: Bound(0),
    }),
    Cardinality,
    (f) => ({ ...readBase(f), type: f.type, roleId: f.role, min: f.min, max: f.max }),
    (r) => ({ ...writeBase(r), type: r.type, role: r.roleId, min: r.min, max: r.max }),
  ),
  kind(
    Schema.Struct({
      ...fileBase,
      type: Schema.Literal("join_subset"),
      subset: JoinOperand,
      superset: JoinOperand,
    }),
    JoinSubset,
    (f) => ({ ...readBase(f), type: f.type, subset: f.subset, superset: f.superset }),
    (r) => ({ ...writeBase(r), type: r.type, subset: r.subset, superset: r.superset }),
  ),
  kind(
    Schema.Struct({ ...fileBase, type: Schema.Literal("join_equality"), operands: Operands }),
    JoinEquality,
    (f) => ({ ...readBase(f), type: f.type, operands: f.operands }),
    (r) => ({ ...writeBase(r), type: r.type, operands: r.operands }),
  ),
  kind(
    Schema.Struct({ ...fileBase, type: Schema.Literal("join_exclusion"), operands: Operands }),
    JoinExclusion,
    (f) => ({ ...readBase(f), type: f.type, operands: f.operands }),
    (r) => ({ ...writeBase(r), type: r.type, operands: r.operands }),
  ),
]);
