/**
 * ORM constraint types (Phase 1 and Phase 2).
 */

import type { CardinalityRange, ValueRange } from "./ObjectType.js";
import type { JoinOperand, RolePath, RolePathStep } from "./RolePath.js";

export type { CardinalityRange, JoinOperand, RolePath, RolePathStep, ValueRange };

/**
 * The modality of a constraint: alethic (logical necessity, the default)
 * or deontic (obligation -- it should hold; a violation is recorded, not
 * impossible).
 */
export type ConstraintModality = "alethic" | "deontic";

/**
 * Fields shared by every constraint: a traceability id and an optional
 * modality (default alethic). Each constraint interface extends this.
 */
export interface ConstraintBase {
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
  /** Alethic (necessity, default) or deontic (obligation). */
  readonly modality?: ConstraintModality;
}

// ---------------------------------------------------------------------------
// Phase 1 constraints
// ---------------------------------------------------------------------------

/**
 * Internal uniqueness constraint.
 *
 * Applies to one or more roles within a single fact type. The combination
 * of values in the specified roles is unique across the population.
 *
 * Single-role example: "Each Order is placed by at most one Customer"
 *   -> uniqueness on the Order role of "Customer places Order"
 *
 * Multi-role example: "Each Employee, Date combination maps to at most one Shift"
 *   -> uniqueness spanning Employee and Date roles in a ternary fact type
 */
export interface InternalUniquenessConstraint extends ConstraintBase {
  readonly type: "internal_uniqueness";
  /** Role ids within the same fact type. */
  readonly roleIds: readonly string[];
  /**
   * True if this uniqueness constraint is the preferred identifier for
   * the entity type that plays the constrained role(s). The preferred
   * identifier determines the primary key in relational mapping.
   *
   * At most one internal uniqueness constraint per entity type should
   * be marked as preferred.
   */
  readonly isPreferred?: boolean;
}

/**
 * Mandatory role constraint.
 *
 * Every instance of the object type playing this role must participate
 * in the fact type.
 *
 * Example: "Every Order is placed by some Customer"
 *   -> mandatory on the Order role of "Customer places Order"
 */
export interface MandatoryRoleConstraint extends ConstraintBase {
  readonly type: "mandatory";
  /** The single role id that is mandatory. */
  readonly roleId: string;
}

/**
 * External uniqueness constraint.
 *
 * Uniqueness across a combination of roles from different fact types.
 * The object type playing the roles must be the same across all
 * referenced fact types.
 *
 * Example: An Employee is uniquely identified by their combination
 * of FirstName and LastName (if those are separate fact types).
 */
export interface ExternalUniquenessConstraint extends ConstraintBase {
  readonly type: "external_uniqueness";
  /** Role ids spanning multiple fact types. */
  readonly roleIds: readonly string[];
}

/**
 * Value constraint.
 *
 * Restricts the allowed values for a value type or a specific role.
 * Supports enumerated values, value ranges (inclusive/exclusive, possibly
 * open-ended), or both. A value satisfies the constraint if it equals one
 * of `values` or falls within any of `ranges`.
 *
 * Example: "Rating must be one of: A, B, C, D, F" or "Age must be >= 18".
 */
export interface ValueConstraint extends ConstraintBase {
  readonly type: "value_constraint";
  /** The role id this constraint applies to (if role-level). */
  readonly roleId?: string;
  /** Allowed enumerated values. */
  readonly values: readonly string[];
  /** Allowed value ranges. */
  readonly ranges?: readonly ValueRange[];
}

// ---------------------------------------------------------------------------
// Phase 2 constraints
// ---------------------------------------------------------------------------

/**
 * The operand of an exclusion, a disjunctive mandatory or an exclusive-or:
 * the roles it constrains, or, for a supertype's subtypes, the subtype
 * facts (orm-format-3, Open decision 2, option a). Exactly one is present,
 * so a reader of `roleIds` must first ask which it has.
 */
export type RoleOrSubtypeOperand =
  | {
    /** Role ids (may span fact types). */
    readonly roleIds: readonly string[];
    readonly subtypeFactIds?: never;
  }
  | {
    /** Subtype fact ids, all of one supertype. */
    readonly subtypeFactIds: readonly string[];
    readonly roleIds?: never;
  };

/**
 * Disjunctive mandatory constraint.
 *
 * Each instance of the common object type must play at least one of
 * the specified roles. The roles may span multiple fact types. Over
 * subtype facts it is totality: each instance of the supertype is an
 * instance of at least one of the subtypes.
 *
 * Example: "Each Person drives some Car or rides some Bus."
 */
export type DisjunctiveMandatoryConstraint =
  & ConstraintBase
  & { readonly type: "disjunctive_mandatory"; }
  & RoleOrSubtypeOperand;

/**
 * Exclusion constraint.
 *
 * No instance of the common object type may play more than one of the
 * specified roles simultaneously.
 *
 * Example: "No Person both drives some Car and rides some Bus."
 */
export type ExclusionConstraint =
  & ConstraintBase
  & { readonly type: "exclusion"; }
  & RoleOrSubtypeOperand;

/**
 * Exclusive-or constraint.
 *
 * Combines disjunctive mandatory and exclusion: each instance of the
 * common object type must play exactly one of the specified roles.
 *
 * Example: "Each Person either drives some Car or rides some Bus but not both."
 */
export type ExclusiveOrConstraint =
  & ConstraintBase
  & { readonly type: "exclusive_or"; }
  & RoleOrSubtypeOperand;

/**
 * Subset constraint.
 *
 * The population of the subset role sequence must be a subset of
 * the superset role sequence. Both sequences must have the same arity.
 *
 * Example: "If a Customer rates some Product then that Customer purchases some Product."
 */
export interface SubsetConstraint extends ConstraintBase {
  readonly type: "subset";
  /** Role ids forming the subset side. */
  readonly subsetRoleIds: readonly string[];
  /** Role ids forming the superset side. */
  readonly supersetRoleIds: readonly string[];
}

/**
 * Equality constraint.
 *
 * The populations of both role sequences must be identical.
 * Equivalent to a pair of subset constraints in both directions.
 *
 * Example: "A Customer rates some Product if and only if that Customer purchases some Product."
 */
export interface EqualityConstraint extends ConstraintBase {
  readonly type: "equality";
  /** First role sequence. */
  readonly roleIds1: readonly string[];
  /** Second role sequence. */
  readonly roleIds2: readonly string[];
}

/**
 * The type of a ring constraint, specifying the reflexive relationship
 * property being constrained.
 */
export type RingType =
  | "irreflexive"
  | "asymmetric"
  | "antisymmetric"
  | "intransitive"
  | "acyclic"
  | "symmetric"
  | "transitive"
  | "purely_reflexive";

// Typed as Record<RingType, true> so the derived array below cannot
// lag the union: adding a member without listing it here is a compile
// error, unlike a bare literal array, whose `readonly RingType[]`
// annotation checks membership but never completeness (barwise-869).
const RING_TYPE_MEMBERS: Record<RingType, true> = {
  irreflexive: true,
  asymmetric: true,
  antisymmetric: true,
  intransitive: true,
  acyclic: true,
  symmetric: true,
  transitive: true,
  purely_reflexive: true,
};

/** Every RingType member, in declaration order. */
export const RING_TYPES = Object.keys(RING_TYPE_MEMBERS) as readonly RingType[];

/**
 * A property of the binary relation R a ring constraint holds over, on
 * the directed pairs (roleId1 -> roleId2) of a population.
 *
 *   irreflexive       no R(a, a)
 *   symmetric         R(a, b) implies R(b, a)
 *   antisymmetric     R(a, b) and R(b, a) imply a = b
 *   transitive        R(a, b) and R(b, c) imply R(a, c)
 *   intransitive      R(a, b) and R(b, c) imply not R(a, c)
 *   acyclic           the transitive closure is irreflexive
 *   purely_reflexive  R(a, b) implies a = b
 */
export type RingProperty =
  | "irreflexive"
  | "symmetric"
  | "antisymmetric"
  | "transitive"
  | "intransitive"
  | "acyclic"
  | "purely_reflexive";

/**
 * The properties each ring type is the conjunction of: the algebra the
 * consumers used to spell out by hand, declared once.
 *
 * Seven of the eight are a single property and asymmetric is two, which
 * is why `population/ring.ts` and `CounterexampleGenerator` each carried
 * eight arms to say what a handler per property says once. Adding a ring
 * type to ORM 2's vocabulary is a row here plus, at most, one new
 * property handler in each consumer; without this table it was two
 * hand-written arms that nothing required to agree.
 *
 * **Order is load-bearing.** A consumer that must choose one property --
 * the counterexample generator, which shows a single witness -- takes
 * the first. Asymmetric therefore lists `antisymmetric` first, because
 * the witness ORM 2 expects for it is the reverse pair (a, b), (b, a)
 * rather than the self-loop that `irreflexive` would yield.
 *
 * `Record<RingType, ...>` for the same reason as `RING_TYPE_MEMBERS`
 * above (barwise-869): a member added to the union without a row here is
 * a compile error, where a lookup keyed on a plain object would silently
 * return undefined. The non-empty tuple type is what lets a consumer
 * read `[0]` without a guard for a row nobody filled in.
 */
export const RING_PROPERTIES: Record<RingType, readonly [RingProperty, ...RingProperty[]]> = {
  irreflexive: ["irreflexive"],
  asymmetric: ["antisymmetric", "irreflexive"],
  antisymmetric: ["antisymmetric"],
  intransitive: ["intransitive"],
  acyclic: ["acyclic"],
  symmetric: ["symmetric"],
  transitive: ["transitive"],
  purely_reflexive: ["purely_reflexive"],
};

/**
 * Ring constraint.
 *
 * Constrains a reflexive relationship: a pair of roles in a single
 * fact type that are played by the same object type.
 *
 * Example (irreflexive): "No Person is a parent of that same Person."
 * Example (asymmetric): "If Person1 is a parent of Person2 then
 *   Person2 is not a parent of Person1."
 */
export interface RingConstraint extends ConstraintBase {
  readonly type: "ring";
  /** First role id. */
  readonly roleId1: string;
  /** Second role id. */
  readonly roleId2: string;
  /** The ring property being constrained. */
  readonly ringType: RingType;
}

/**
 * Frequency constraint.
 *
 * Restricts how many times a value (single role) or value combination (a
 * role sequence) may occur in the population. A length-1 `roleIds` is the
 * common single-role case ("each Customer places 2..5 Orders"); a longer
 * sequence bounds a combination ("each (Room, TimeSlot) pair is booked
 * 0..1 times").
 *
 * Example: "Each Customer places at least 2 and at most 5 Orders."
 */
export interface FrequencyConstraint extends ConstraintBase {
  readonly type: "frequency";
  /** The role sequence being frequency-constrained (length 1 = single role). */
  readonly roleIds: readonly string[];
  /** Minimum number of times the value (combination) must occur. */
  readonly min: number;
  /** Maximum times, or "unbounded" for no upper limit. */
  readonly max: number | "unbounded";
}

/**
 * The comparison operator asserted between two role values.
 */
export type ValueComparisonOperator = "<" | "<=" | "=" | "<>" | ">=" | ">";

/**
 * Value-comparison constraint.
 *
 * Asserts an ordering between the values of two roles of the same fact
 * type: for every instance, `value(roleId1) <operator> value(roleId2)`
 * must hold. Distinct from a ring constraint, which relates two roles by
 * instance identity rather than by value order. Comparisons across a join
 * path (e.g. a Project's start vs end held in two fact types) are deferred
 * to the role-path model (barwise-5t9.10).
 *
 * Example: "For each ReviewPeriod, the StartDate must be before the EndDate."
 */
export interface ValueComparisonConstraint extends ConstraintBase {
  readonly type: "value_comparison";
  /** The left-hand role id. */
  readonly roleId1: string;
  /** The right-hand role id. */
  readonly roleId2: string;
  /** The relationship that must hold: value(roleId1) <operator> value(roleId2). */
  readonly operator: ValueComparisonOperator;
}

/**
 * Cardinality constraint on a unary role.
 *
 * Bounds how many object instances play a given unary role -- e.g. "at most
 * 10 Promotions are active", where _Promotion is active_ is a unary fact
 * type. Distinct from a frequency constraint (which bounds how many times a
 * single object plays a role) and from object-type cardinality (the
 * `cardinality` field on ObjectType, which bounds the whole population). The
 * role must belong to a unary (arity-1) fact type.
 */
export interface CardinalityConstraint extends ConstraintBase, CardinalityRange {
  readonly type: "cardinality";
  /** The unary role whose occurrence count is bounded. */
  readonly roleId: string;
}

// ---------------------------------------------------------------------------
// Join constraints (role-path operands -- Tier 3)
// ---------------------------------------------------------------------------

/**
 * Join subset constraint: the projected tuple set of the `subset` operand
 * must be contained in that of the `superset` operand. Each operand is a role
 * path with a projection (the compared tuple). The flat `SubsetConstraint`
 * covers the no-join case; this variant carries inline path-projected
 * operands for cross-fact-type joins.
 *
 * Example: "Each Person who was born in a Country is a citizen of some
 * Country" over the bornIn / citizenOf join paths.
 */
export interface JoinSubsetConstraint extends ConstraintBase {
  readonly type: "join_subset";
  /** The operand whose projected tuples must be contained in the superset's. */
  readonly subset: JoinOperand;
  /** The operand whose projected tuples contain the subset's. */
  readonly superset: JoinOperand;
}

/**
 * Join equality constraint: the projected tuple sets of all operands must be
 * identical. Two or more operands, compared as an unordered set.
 *
 * Example: "Each Person was born in the same Country of which that Person is
 * a citizen" over the bornIn / citizenOf join paths, each projecting
 * (Person, Country).
 */
export interface JoinEqualityConstraint extends ConstraintBase {
  readonly type: "join_equality";
  /** Two or more operands whose projected tuple sets must be equal. */
  readonly operands: readonly JoinOperand[];
}

/**
 * Join exclusion constraint: no tuple may appear in the projected tuple set
 * of more than one operand. Two or more operands, compared as an unordered
 * set.
 */
export interface JoinExclusionConstraint extends ConstraintBase {
  readonly type: "join_exclusion";
  /** Two or more operands whose projected tuple sets must be pairwise disjoint. */
  readonly operands: readonly JoinOperand[];
}

/**
 * Union of all constraint types.
 */
export type Constraint =
  | InternalUniquenessConstraint
  | MandatoryRoleConstraint
  | ExternalUniquenessConstraint
  | ValueConstraint
  | DisjunctiveMandatoryConstraint
  | ExclusionConstraint
  | ExclusiveOrConstraint
  | SubsetConstraint
  | EqualityConstraint
  | RingConstraint
  | FrequencyConstraint
  | ValueComparisonConstraint
  | CardinalityConstraint
  | JoinSubsetConstraint
  | JoinEqualityConstraint
  | JoinExclusionConstraint;

/**
 * Every member of the `Constraint` union, keyed for compile-checked
 * completeness.
 *
 * The `RING_TYPE_MEMBERS` idiom one level up (barwise-869): a constraint
 * kind added to the union without a row here is a compile error, where a
 * hand-written array annotated `readonly Constraint["type"][]` checks
 * membership and never completeness. What made this worth exporting is
 * that consumers had begun re-listing the sixteen kinds -- a generator
 * that must reach every kind, a coverage assertion that must name every
 * kind -- and each such list is a copy that drifts the day a kind is
 * added.
 */
const CONSTRAINT_TYPE_MEMBERS: Record<Constraint["type"], true> = {
  internal_uniqueness: true,
  mandatory: true,
  external_uniqueness: true,
  value_constraint: true,
  disjunctive_mandatory: true,
  exclusion: true,
  exclusive_or: true,
  subset: true,
  equality: true,
  ring: true,
  frequency: true,
  value_comparison: true,
  cardinality: true,
  join_subset: true,
  join_equality: true,
  join_exclusion: true,
};

/** Every constraint type discriminator, in declaration order. */
export const CONSTRAINT_TYPES = Object.keys(
  CONSTRAINT_TYPE_MEMBERS,
) as readonly Constraint["type"][];

// ---------------------------------------------------------------------------
// Type guard helpers
// ---------------------------------------------------------------------------

export function isInternalUniqueness(
  c: Constraint,
): c is InternalUniquenessConstraint {
  return c.type === "internal_uniqueness";
}

export function isMandatoryRole(
  c: Constraint,
): c is MandatoryRoleConstraint {
  return c.type === "mandatory";
}

export function isExternalUniqueness(
  c: Constraint,
): c is ExternalUniquenessConstraint {
  return c.type === "external_uniqueness";
}

export function isValueConstraint(c: Constraint): c is ValueConstraint {
  return c.type === "value_constraint";
}

export function isDisjunctiveMandatory(
  c: Constraint,
): c is DisjunctiveMandatoryConstraint {
  return c.type === "disjunctive_mandatory";
}

export function isExclusion(c: Constraint): c is ExclusionConstraint {
  return c.type === "exclusion";
}

export function isExclusiveOr(c: Constraint): c is ExclusiveOrConstraint {
  return c.type === "exclusive_or";
}

export function isSubset(c: Constraint): c is SubsetConstraint {
  return c.type === "subset";
}

export function isEquality(c: Constraint): c is EqualityConstraint {
  return c.type === "equality";
}

export function isRing(c: Constraint): c is RingConstraint {
  return c.type === "ring";
}

export function isFrequency(c: Constraint): c is FrequencyConstraint {
  return c.type === "frequency";
}

export function isValueComparison(
  c: Constraint,
): c is ValueComparisonConstraint {
  return c.type === "value_comparison";
}

export function isCardinality(c: Constraint): c is CardinalityConstraint {
  return c.type === "cardinality";
}

export function isJoinSubset(c: Constraint): c is JoinSubsetConstraint {
  return c.type === "join_subset";
}

export function isJoinEquality(c: Constraint): c is JoinEqualityConstraint {
  return c.type === "join_equality";
}

export function isJoinExclusion(c: Constraint): c is JoinExclusionConstraint {
  return c.type === "join_exclusion";
}

/**
 * Every role id a constraint references, across every constraint shape.
 *
 * The switch is exhaustive over the `Constraint` union with NO default
 * arm, which is the whole point: a constraint kind added later fails to
 * compile here until it is classified, rather than falling through as
 * "references no roles". That silent-`[]` behaviour is not hypothetical
 * -- `splitModel` hand-listed eight raw document keys, matched none of a
 * join constraint's `subset`/`superset`/`operands`, and treated every
 * join constraint as context-local no matter which fact types its
 * operand paths reached (barwise-928).
 *
 * Lives here rather than in either caller because it is a derivation
 * that belongs to the data: `splitModel` asks it which context a
 * constraint is homed in, and `graphOf` asks it which references a model
 * must resolve. Two hand-written copies of "which fields hold role ids"
 * is the must-agree duplication the root CLAUDE.md forbids.
 */
export function roleIdsOf(c: Constraint): string[] {
  switch (c.type) {
    case "internal_uniqueness":
    case "external_uniqueness":
    case "frequency":
      return [...c.roleIds];
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or":
      // A subtype operand names no role; `subtypeFactIdsOf` has it.
      return c.roleIds ? [...c.roleIds] : [];
    case "mandatory":
    case "cardinality":
      return [c.roleId];
    case "value_constraint":
      return c.roleId ? [c.roleId] : [];
    case "subset":
      return [...c.subsetRoleIds, ...c.supersetRoleIds];
    case "equality":
      return [...c.roleIds1, ...c.roleIds2];
    case "ring":
    case "value_comparison":
      return [c.roleId1, c.roleId2];
    case "join_subset":
    case "join_equality":
    case "join_exclusion":
      return joinOperandsOf(c).flatMap(operandRoleIds);
  }
}

/** Role ids a join operand references: both ends of every hop in its path. */
export function operandRoleIds(o: JoinOperand): string[] {
  return o.path.steps.flatMap((s) => [s.entry, s.exit]);
}

/**
 * Every SUBTYPE FACT id a constraint references: the operand of an
 * exclusion, a disjunctive mandatory or an exclusive-or over a supertype's
 * subtypes (orm-format-3, Open decision 2). The sibling of `roleIdsOf`,
 * which returns none for such a constraint: a caller asking which fact
 * types or elements a constraint touches must ask both, or a subtype
 * constraint touches nothing.
 */
export function subtypeFactIdsOf(c: Constraint): string[] {
  switch (c.type) {
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or":
      return c.subtypeFactIds ? [...c.subtypeFactIds] : [];
    default:
      return [];
  }
}

/**
 * Whether a constraint's operand is subtype facts rather than roles. The one
 * test for it, so every reader agrees on a constraint whose subtype fact
 * list is empty: it is over subtypes, and validation reports it as too few.
 */
export function isOverSubtypes(c: Constraint): boolean {
  return (c.type === "disjunctive_mandatory" || c.type === "exclusion" || c.type === "exclusive_or")
    && c.subtypeFactIds !== undefined;
}

/**
 * What a constraint over subtypes still says once some of its subtype facts
 * are gone, or undefined when it says nothing. An exclusion narrows: no
 * Person is two of the rest still holds. An exclusive-or keeps its
 * exclusion half over the rest. A disjunctive mandatory goes: "each Person
 * is at least one of Male, Female" without Male is not "each Person is a
 * Female", a rule nobody stated, and an exclusive-or's exhaustive half goes
 * for the same reason. An exclusion left over fewer than two states nothing.
 * One with none gone is returned as it is.
 *
 * `OrmModel.removeSubtypeFact` and the merge both read it, so a subtype
 * fact removed by hand and one a merge leaves out leave the same rule.
 */
export function withoutSubtypeFacts(
  c: ExternalConstraint,
  gone: (subtypeFactId: string) => boolean,
): ExternalConstraint | undefined {
  const ids = subtypeFactIdsOf(c);
  if (!ids.some(gone)) return c;
  const rest = ids.filter((id) => !gone(id));
  if (c.type === "disjunctive_mandatory" || rest.length < 2) return undefined;
  return {
    ...(c.id !== undefined ? { id: c.id } : {}),
    ...(c.modality !== undefined ? { modality: c.modality } : {}),
    type: "exclusion",
    subtypeFactIds: rest,
  };
}

/**
 * Every OBJECT TYPE id a constraint references.
 *
 * Only join constraints have any: each operand's role path is rooted at
 * an object type (the correlation variable's type). Exhaustive over the
 * union with no `default` arm for the same reason as `roleIdsOf` -- a
 * kind added later must be classified rather than silently reporting
 * none.
 *
 * Separate from `roleIdsOf` because the two resolve against different
 * stores, and a caller checking references has to know which is which.
 */
export function objectTypeIdsOf(c: Constraint): string[] {
  switch (c.type) {
    case "internal_uniqueness":
    case "external_uniqueness":
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or":
    case "frequency":
    case "mandatory":
    case "cardinality":
    case "value_constraint":
    case "subset":
    case "equality":
    case "ring":
    case "value_comparison":
      return [];
    case "join_subset":
    case "join_equality":
    case "join_exclusion":
      return joinOperandsOf(c).map((o) => o.path.root);
  }
}

/**
 * The join operands a constraint carries, or none for the kinds that
 * have no role path.
 *
 * The three join kinds spell their operands differently -- `join_subset`
 * names its two, the other two hold a list -- and three call sites had
 * each grown their own version of that switch. Exhaustive with no
 * `default` arm, for the reason `roleIdsOf` gives.
 */
export function joinOperandsOf(c: Constraint): readonly JoinOperand[] {
  switch (c.type) {
    case "internal_uniqueness":
    case "external_uniqueness":
    case "disjunctive_mandatory":
    case "exclusion":
    case "exclusive_or":
    case "frequency":
    case "mandatory":
    case "cardinality":
    case "value_constraint":
    case "subset":
    case "equality":
    case "ring":
    case "value_comparison":
      return [];
    case "join_subset":
      return [c.subset, c.superset];
    case "join_equality":
    case "join_exclusion":
      return c.operands;
  }
}

/**
 * Whether every role a constraint names must belong to the fact type
 * that carries it.
 *
 * Most constraints are local, but the exceptions are not an oversight
 * -- they are the point of those kinds. An external uniqueness
 * constraint that is entirely local is the anomaly, and
 * `constraint/external-uniqueness-all-local` reports it. Exclusion,
 * subset, equality, exclusive-or and disjunctive mandatory span fact
 * types routinely, which is why `rules/population/spanning.ts` exists.
 * Join constraints reach across by construction.
 *
 * So a caller cannot ask "is this role id one of the fact type's" and
 * treat a "no" as a defect: whether it is a defect depends on the kind,
 * and that judgement is this function.
 *
 * The same table decides where a constraint lives
 * (`docs/specs/orm-format-3.spec.md`, placement by kind): a kind whose
 * roles must be local is internal and belongs to its fact type, every
 * other kind is external and belongs to the model. One table, so the
 * placement rule and the locality rule cannot disagree, and the
 * `InternalConstraint` type below is derived from it rather than listed
 * a second time.
 *
 * A total record rather than a list of the seven, so a constraint kind
 * added later fails to compile until someone classifies it, instead of
 * silently defaulting to whichever answer the author of the list
 * happened to write first.
 */
const PLACEMENT = {
  internal_uniqueness: "internal",
  mandatory: "internal",
  value_constraint: "internal",
  ring: "internal",
  frequency: "internal",
  cardinality: "internal",
  value_comparison: "internal",
  external_uniqueness: "external",
  disjunctive_mandatory: "external",
  exclusion: "external",
  exclusive_or: "external",
  subset: "external",
  equality: "external",
  join_subset: "external",
  join_equality: "external",
  join_exclusion: "external",
} as const satisfies Record<Constraint["type"], "internal" | "external">;

type InternalKind = {
  [K in keyof typeof PLACEMENT]: (typeof PLACEMENT)[K] extends "internal" ? K : never;
}[keyof typeof PLACEMENT];

/** The kinds that live in their fact type: every role is one of its roles. */
export type InternalConstraint = Extract<Constraint, { type: InternalKind; }>;

/** The kinds that live in the model: their roles may span fact types. */
export type ExternalConstraint = Exclude<Constraint, InternalConstraint>;

/** Whether `c` lives in its fact type (see `PLACEMENT`). */
export function isInternalConstraint(c: Constraint): c is InternalConstraint {
  return PLACEMENT[c.type] === "internal";
}

/** Whether `c` lives in the model (see `PLACEMENT`). */
export function isExternalConstraint(c: Constraint): c is ExternalConstraint {
  return PLACEMENT[c.type] === "external";
}
