/**
 * Constraints as a format 3.0 file states them, all 17 kinds, stated once
 * as Effect Schemas and decoded into constraint records or into every
 * problem with them (docs/specs/effect-adoption.spec.md, 1r, R2).
 *
 * As for object types, the Schemas are written in the file's own keys and
 * make no transformation, and `constraintRecord` maps a decoded value to its
 * record. The record is `main`'s with barwise-973's two narrowings, which
 * gate S3 holds it to: an id and a modality on every constraint (alethic
 * when the file states none), and a join constraint's operands at least
 * two. Its type is derived from the Schemas through that mapping, so a
 * Schema that widened a field would widen the record and fail S3.
 *
 * **Placement.** A file lists a constraint under a fact type or in
 * `model.constraints`, as `PLACEMENT` says of its kind. Each list's Schema
 * reads every kind, and a kind that lives in the other list fails a rule
 * of its own, in the wording `refuseMisplacedConstraints` uses today, which
 * the harness runs whatever else is wrong with the constraint. So a
 * misplaced constraint's other problems are reported in the same pass, and
 * the decoded type of each list holds only the kinds that live there.
 *
 * **What the decoder leaves to validation.** A frequency or cardinality
 * whose max is below its min loads today and is reported by validation, so
 * the decoder accepts it: gate S1 compares what the two heads load, and a
 * decoder that refused it would differ. References between elements --
 * a role or subtype fact that does not exist -- are validation's for the
 * same reason, as WS0's rule has it.
 *
 * Nothing on the load path calls this until R4.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  type Constraint,
  type ConstraintModality,
  type InternalConstraint,
  placementOf,
  RING_TYPES,
  type ValueComparisonOperator,
} from "../model/Constraint.js";
import { type DecodeProblems, decoderFor, runDecode } from "./decoder.js";
import { crossField, crossFieldGuard, type CrossFieldMark, type MessageWithin } from "./harness.js";
import {
  intAtLeast,
  nonEmpty,
  rangeRecord,
  RangesFile,
  ValuesFile,
  valuesOrRanges,
} from "./leaves.js";
import { type ElementLabel, elementOf } from "./problems.js";

// -- Leaves -----------------------------------------------------------------

/** Total records, so a modality or operator added to the model fails to compile here. */
const MODALITY_MEMBERS: Record<ConstraintModality, true> = { alethic: true, deontic: true };
const MODALITIES = Object.keys(MODALITY_MEMBERS) as ConstraintModality[];

const OPERATOR_MEMBERS: Record<ValueComparisonOperator, true> = {
  "<": true,
  "<=": true,
  "=": true,
  "<>": true,
  ">=": true,
  ">": true,
};
const OPERATORS = Object.keys(OPERATOR_MEMBERS) as ValueComparisonOperator[];

const Modality = Schema.Literals(MODALITIES).annotate({
  message: `must be ${MODALITIES.join(" or ")}.`,
});
const RingTypeFile = Schema.Literals(RING_TYPES).annotate({
  message: `must name a ring type (one of ${RING_TYPES.join(", ")}).`,
});
const OperatorFile = Schema.Literals(OPERATORS).annotate({
  message: `must be a comparison operator (one of ${OPERATORS.join(", ")}).`,
});

/**
 * A list's minimum length, as a rule the harness runs: Effect runs a list's
 * checks only once every item decodes, so a list both too short and
 * holding a bad item reported the item alone (review of R2). It reads no
 * field below the list, so it runs whenever the list is a list. The
 * arbitrary constraint steers derivation only.
 */
const LIST_LENGTH: CrossFieldMark = { id: "list-min-length", reads: [] };
const atLeastItems = (min: number, message: string) =>
  crossField(LIST_LENGTH, (xs: readonly unknown[]) => xs.length >= min, message, {
    arbitraryConstraint: { minLength: min },
  });

const RoleId = nonEmpty("");
const roleList = (min: number) =>
  Schema.Array(nonEmpty(" (a role id)")).check(
    atLeastItems(
      min,
      min === 1 ? "must list at least one role." : `must list at least ${min} roles.`,
    ),
  );
const RoleIds = roleList(1);
/** Subtype facts of one supertype; too few is validation's to report. */
const SubtypeFactIds = Schema.Array(nonEmpty(" (a subtype fact id)"));

/** A maximum: an integer no smaller than `min`, or "unbounded", named whichever part fails. */
const bound = (min: number) => {
  const message = min === 0
    ? 'must be a non-negative integer or "unbounded".'
    : `must be an integer of at least ${min} or "unbounded".`;
  return Schema.Union([intAtLeast(min, message), Schema.Literal("unbounded")]).annotate({
    message,
  });
};

const RolePathFile = Schema.Struct({
  root: nonEmpty(""),
  steps: Schema.Array(Schema.Struct({ entry: nonEmpty(""), exit: nonEmpty("") })),
});

const JoinOperandFile = Schema.Struct({
  path: RolePathFile,
  projection: Schema.Array(intAtLeast(0)),
});
type JoinOperandFileValue = (typeof JoinOperandFile)["Type"];

/**
 * Two or more operands, typed as such: the record's narrowing, stated by the
 * check that enforces it, so the derived type carries it. Marked as the
 * role lists' minimum is, for the same reason.
 */
const Operands = Schema.Array(JoinOperandFile).pipe(
  crossFieldGuard(
    LIST_LENGTH,
    (
      ops,
    ): ops is readonly [JoinOperandFileValue, JoinOperandFileValue, ...JoinOperandFileValue[]] =>
      ops.length >= 2,
    "must list at least two operands.",
    { arbitraryConstraint: { minLength: 2 } },
  ),
);

// -- The kinds --------------------------------------------------------------

const base = {
  id: nonEmpty("").pipe(
    Schema.annotateKey({
      messageMissingKey: "is missing: a 3.0 file states every constraint's id.",
    }),
  ),
  modality: Schema.optionalKey(Modality),
};

const kind = <T extends string, F extends Schema.Struct.Fields>(type: T, fields: F) =>
  Schema.Struct({ ...base, type: Schema.Literal(type), ...fields });

/** Roles or a supertype's subtype facts, exactly one of the two. */
const rolesOrSubtypeFacts = <T extends string>(type: T) =>
  kind(type, {
    roles: Schema.optionalKey(roleList(2)),
    subtype_facts: Schema.optionalKey(SubtypeFactIds),
  }).check(
    crossField(
      { id: "roles-or-subtype-facts", reads: ["roles", "subtype_facts"] },
      (c: { readonly roles?: unknown; readonly subtype_facts?: unknown; }) =>
        c.roles === undefined && c.subtype_facts === undefined
          ? false
          : c.roles !== undefined && c.subtype_facts !== undefined
          ? {
            path: ["subtype_facts"],
            issue: "must not be given beside roles: a constraint is over roles or over "
              + "subtype facts, not both.",
          }
          : true,
      "must have roles or subtype_facts.",
    ),
  );

/**
 * Each kind's Schema, keyed by kind, so the two lists are built from one
 * table, and derivation (M1) and the drift test can read each kind alone.
 */
export const CONSTRAINT_KIND_FILES = {
  internal_uniqueness: kind("internal_uniqueness", { roles: RoleIds }),
  mandatory: kind("mandatory", { role: RoleId }),
  value_constraint: kind("value_constraint", {
    role: Schema.optionalKey(RoleId),
    values: Schema.optionalKey(ValuesFile),
    ranges: Schema.optionalKey(RangesFile),
  }).check(valuesOrRanges),
  ring: kind("ring", { role_1: RoleId, role_2: RoleId, ring_type: RingTypeFile }),
  frequency: kind("frequency", {
    role: Schema.optionalKey(RoleId),
    roles: Schema.optionalKey(RoleIds),
    min: intAtLeast(1),
    max: bound(1),
  }).check(
    crossField(
      { id: "frequency-role-or-roles", reads: ["role", "roles"] },
      (c: { readonly role?: unknown; readonly roles?: unknown; }) =>
        c.role !== undefined || c.roles !== undefined,
      "must have a role or roles.",
    ),
  ),
  value_comparison: kind("value_comparison", {
    role_1: RoleId,
    role_2: RoleId,
    operator: OperatorFile,
  }),
  cardinality: kind("cardinality", { role: RoleId, min: intAtLeast(0), max: bound(0) }),
  external_uniqueness: kind("external_uniqueness", { roles: RoleIds }),
  disjunctive_mandatory: rolesOrSubtypeFacts("disjunctive_mandatory"),
  exclusion: rolesOrSubtypeFacts("exclusion"),
  exclusive_or: rolesOrSubtypeFacts("exclusive_or"),
  subset: kind("subset", { subset_roles: RoleIds, superset_roles: RoleIds }),
  equality: kind("equality", { roles_1: RoleIds, roles_2: RoleIds }),
  join_subset: kind("join_subset", { subset: JoinOperandFile, superset: JoinOperandFile }),
  join_equality: kind("join_equality", { operands: Operands }),
  join_exclusion: kind("join_exclusion", { operands: Operands }),
  join_ring: kind("join_ring", { operand: JoinOperandFile, ring_type: RingTypeFile }),
} satisfies Record<Constraint["type"], Schema.Top>;

type Kinds = typeof CONSTRAINT_KIND_FILES;
type Kind = keyof Kinds;

/**
 * A constraint of any kind as a file states it, wherever it is listed.
 * The two lists below are built from the same kinds; this union is what
 * derivation (M1) and the record mapping read.
 */
export const ConstraintFile = Schema.Union(Object.values(CONSTRAINT_KIND_FILES) as Kinds[Kind][]);

/** A decoded file constraint: exactly what the file states. */
export type ConstraintFileValue = (typeof ConstraintFile)["Type"];

// -- Placement --------------------------------------------------------------

/**
 * What a message calls a constraint: by its kind and id, as
 * `refuseMisplacedConstraints` does (`The ring constraint "c-1"`), and with
 * no kind when the kind is the problem.
 */
function describeConstraint(raw: unknown): ElementLabel {
  const doc = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const noun = typeof doc.type === "string" && placementOf(doc.type) !== undefined
    ? `The ${doc.type} constraint`
    : "The constraint";
  // An empty id is quoted and an absent one left out, as
  // `refuseMisplacedConstraints` words them; an id of the wrong type is
  // still how a reader finds the constraint. One with no id is found by the
  // problem's `at`.
  if (typeof doc.id === "string") return { label: `${noun} "${doc.id}"`, identity: doc.id };
  return typeof doc.id === "number" || typeof doc.id === "boolean"
    ? { label: `${noun} with id ${String(doc.id)}`, identity: String(doc.id) }
    : { label: noun, identity: "" };
}

const PLACEMENT_MARK: CrossFieldMark = { id: "constraint-placement", reads: [] };

/**
 * The rule a kind listed in the wrong place fails. It reads no field, so
 * the harness runs it whatever else is wrong; as a guard that never holds
 * it removes the kind from the list's decoded type.
 */
function misplacedIn(where: "internal" | "external") {
  const messageWithin: MessageWithin = where === "internal"
    ? (factType) =>
      `is listed under ${factType ?? "a fact type"}, but its kind lives in the model: `
      + "move it to model.constraints."
    : () =>
      "is listed in model.constraints, but its kind lives in its fact type: "
      + "move it under the fact type whose roles it names.";
  return crossFieldGuard(
    PLACEMENT_MARK,
    (_: unknown): _ is never => false,
    messageWithin(undefined),
    {
      messageWithin,
    },
  );
}

const badTag = `must name a constraint kind (one of ${
  Object.keys(CONSTRAINT_KIND_FILES).join(", ")
}).`;

/** The kinds that live in `where`, at the type level, from `PLACEMENT` as the model derives it. */
type PlacedIn<W extends "internal" | "external"> = W extends "internal" ? InternalConstraint["type"]
  : Exclude<Kind, InternalConstraint["type"]>;

/**
 * Each member of a list's union, typed as the run-time map below builds it:
 * a kind placed elsewhere carries the guard that never holds, and so decodes
 * to nothing. Built by a map over the table, the members' types would merge
 * into one, and the list's decoded type would hold every kind (review of R2,
 * which a type test now pins).
 */
type ListMember<W extends "internal" | "external"> = {
  [K in Kind]: K extends PlacedIn<W> ? Kinds[K] : Schema.refine<never, Kinds[K]>;
}[Kind];

/** One list's constraint: every kind read, and the other list's refused. */
function listedIn<W extends "internal" | "external">(where: W) {
  // The map decides with `placementOf`, and `ListMember` with the type
  // `PLACEMENT` derives, so the run-time and type-level lists cannot part.
  const members = (Object.keys(CONSTRAINT_KIND_FILES) as Kind[]).map((k) =>
    placementOf(k) === where
      ? CONSTRAINT_KIND_FILES[k]
      : CONSTRAINT_KIND_FILES[k].pipe(misplacedIn(where))
  ) as ListMember<W>[];
  return Schema.Union(members).annotate(
    elementOf({ noun: "Constraint", badTag, tagField: "type", describe: describeConstraint }),
  );
}

/** A constraint under a fact type, as a 3.0 file lists it. */
export const InternalConstraintFile = listedIn("internal");

/** A constraint in `model.constraints`, as a 3.0 file lists it. */
export const ExternalConstraintFile = listedIn("external");

/** A fact type's `constraints`, and the model's. */
export const InternalConstraintsFile = Schema.Array(InternalConstraintFile);
export const ExternalConstraintsFile = Schema.Array(ExternalConstraintFile);

// -- To the record ------------------------------------------------------------

/** A new list, typed as the record's lists are: read-only. */
const mapped = <A, B>(xs: readonly A[], f: (a: A) => B): readonly B[] => xs.map(f);

/** An operand over roles or over subtype facts, as the record holds it. */
function rolesOrSubtypeFactsRecord<
  C extends {
    readonly type: string;
    readonly roles?: readonly string[];
    readonly subtype_facts?: readonly string[];
  },
>(c: C) {
  // The rule on the Schema leaves exactly one of the two; `?? []` is
  // unreachable and only keeps the record's type from holding undefined.
  return c.subtype_facts !== undefined
    ? { type: c.type as C["type"], subtypeFactIds: c.subtype_facts }
    : { type: c.type as C["type"], roleIds: c.roles ?? [] };
}

/**
 * The record a decoded constraint stands for: `deserializeConstraint`'s,
 * with the modality stated. Its return type is the record's type, derived
 * from the Schemas: gate S3 reads it, so each kind has its own arm, and a
 * `type` that held two kinds would fail it.
 */
function recordOf(c: ConstraintFileValue) {
  const head = { id: c.id, modality: c.modality ?? "alethic" };
  switch (c.type) {
    case "internal_uniqueness":
      return { ...head, type: c.type, roleIds: c.roles };
    case "external_uniqueness":
      return { ...head, type: c.type, roleIds: c.roles };
    case "mandatory":
      return { ...head, type: c.type, roleId: c.role };
    case "value_constraint":
      return {
        ...head,
        type: c.type,
        ...(c.role !== undefined ? { roleId: c.role } : {}),
        values: c.values ?? [],
        ...(c.ranges !== undefined ? { ranges: mapped(c.ranges, rangeRecord) } : {}),
      };
    case "disjunctive_mandatory":
      return { ...head, ...rolesOrSubtypeFactsRecord(c) };
    case "exclusion":
      return { ...head, ...rolesOrSubtypeFactsRecord(c) };
    case "exclusive_or":
      return { ...head, ...rolesOrSubtypeFactsRecord(c) };
    case "subset":
      return {
        ...head,
        type: c.type,
        subsetRoleIds: c.subset_roles,
        supersetRoleIds: c.superset_roles,
      };
    case "equality":
      return { ...head, type: c.type, roleIds1: c.roles_1, roleIds2: c.roles_2 };
    case "ring":
      return { ...head, type: c.type, roleId1: c.role_1, roleId2: c.role_2, ringType: c.ring_type };
    case "frequency":
      return {
        ...head,
        type: c.type,
        // `roles` wins over `role` when a file gives both, as today's reader
        // reads it; the silent drop is barwise-plc.
        roleIds: c.roles ?? (c.role !== undefined ? [c.role] : []),
        min: c.min,
        max: c.max,
      };
    case "value_comparison":
      return {
        ...head,
        type: c.type,
        roleId1: c.role_1,
        roleId2: c.role_2,
        operator: c.operator,
      };
    case "cardinality":
      return { ...head, type: c.type, roleId: c.role, min: c.min, max: c.max };
    case "join_subset":
      return {
        ...head,
        type: c.type,
        // An operand's file shape is the record's, and the decode built it fresh.
        subset: c.subset,
        superset: c.superset,
      };
    case "join_equality":
      return { ...head, type: c.type, operands: c.operands };
    case "join_exclusion":
      return { ...head, type: c.type, operands: c.operands };
    case "join_ring":
      return { ...head, type: c.type, operand: c.operand, ringType: c.ring_type };
  }
}

/** A decoded constraint: the record, typed from the Schemas (gate S3). */
export type DecodedConstraint = ReturnType<typeof recordOf>;

/**
 * `recordOf`, typed to keep its input's kind: every arm returns the
 * input's `type`, so a list of internal kinds maps to internal records.
 */
export const constraintRecord = recordOf as <C extends ConstraintFileValue>(
  c: C,
) => Extract<DecodedConstraint, { readonly type: C["type"]; }>;

/** A decoded constraint of a kind that lives in its fact type. */
export type DecodedInternalConstraint = Extract<
  DecodedConstraint,
  { readonly type: InternalConstraint["type"]; }
>;

/** A decoded constraint of a kind that lives in the model. */
export type DecodedExternalConstraint = Exclude<DecodedConstraint, DecodedInternalConstraint>;

// -- Decoding ---------------------------------------------------------------

const decodeInternalFile = decoderFor(InternalConstraintsFile);
const decodeExternalFile = decoderFor(ExternalConstraintsFile);

/** Decode a fact type's `constraints` as a 3.0 file lists them. */
export function decodeInternalConstraints(
  docs: unknown,
): Effect.Effect<readonly DecodedInternalConstraint[], DecodeProblems> {
  return decodeInternalFile(docs).pipe(Effect.map((cs) => cs.map(constraintRecord)));
}

/** Decode `model.constraints` as a 3.0 file lists them. */
export function decodeExternalConstraints(
  docs: unknown,
): Effect.Effect<readonly DecodedExternalConstraint[], DecodeProblems> {
  return decodeExternalFile(docs).pipe(Effect.map((cs) => cs.map(constraintRecord)));
}

/** The synchronous boundaries: the records, or every problem thrown at once. */
export const runInternalConstraintsDecode = (docs: unknown) =>
  runDecode(decodeInternalConstraints(docs));
export const runExternalConstraintsDecode = (docs: unknown) =>
  runDecode(decodeExternalConstraints(docs));
