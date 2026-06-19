/**
 * ORM constraint types (Phase 1 and Phase 2).
 */

import type { CardinalityRange, ValueRange } from "./ObjectType.js";

export type { CardinalityRange, ValueRange };

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
 * Disjunctive mandatory constraint.
 *
 * Each instance of the common object type must play at least one of
 * the specified roles. The roles may span multiple fact types.
 *
 * Example: "Each Person drives some Car or rides some Bus."
 */
export interface DisjunctiveMandatoryConstraint extends ConstraintBase {
  readonly type: "disjunctive_mandatory";
  /** Two or more role ids (may span fact types). */
  readonly roleIds: readonly string[];
}

/**
 * Exclusion constraint.
 *
 * No instance of the common object type may play more than one of the
 * specified roles simultaneously.
 *
 * Example: "No Person both drives some Car and rides some Bus."
 */
export interface ExclusionConstraint extends ConstraintBase {
  readonly type: "exclusion";
  /** Two or more role ids (may span fact types). */
  readonly roleIds: readonly string[];
}

/**
 * Exclusive-or constraint.
 *
 * Combines disjunctive mandatory and exclusion: each instance of the
 * common object type must play exactly one of the specified roles.
 *
 * Example: "Each Person either drives some Car or rides some Bus but not both."
 */
export interface ExclusiveOrConstraint extends ConstraintBase {
  readonly type: "exclusive_or";
  /** Two or more role ids (may span fact types). */
  readonly roleIds: readonly string[];
}

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
 * Restricts how many times an object may play a given role.
 *
 * Example: "Each Customer places at least 2 and at most 5 Orders."
 */
export interface FrequencyConstraint extends ConstraintBase {
  readonly type: "frequency";
  /** The role being frequency-constrained. */
  readonly roleId: string;
  /** Minimum number of times the object must play the role. */
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
  | CardinalityConstraint;

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
