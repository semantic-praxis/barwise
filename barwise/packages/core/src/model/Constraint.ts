/**
 * ORM constraint types (Phase 1 and Phase 2).
 */

import type { ValueRange } from "./ObjectType.js";

export type { ValueRange };

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
export interface InternalUniquenessConstraint {
  readonly type: "internal_uniqueness";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface MandatoryRoleConstraint {
  readonly type: "mandatory";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface ExternalUniquenessConstraint {
  readonly type: "external_uniqueness";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface ValueConstraint {
  readonly type: "value_constraint";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface DisjunctiveMandatoryConstraint {
  readonly type: "disjunctive_mandatory";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface ExclusionConstraint {
  readonly type: "exclusion";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface ExclusiveOrConstraint {
  readonly type: "exclusive_or";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface SubsetConstraint {
  readonly type: "subset";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface EqualityConstraint {
  readonly type: "equality";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface RingConstraint {
  readonly type: "ring";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
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
export interface FrequencyConstraint {
  readonly type: "frequency";
  /** Unique identifier for this constraint (for traceability). */
  readonly id?: string;
  /** The role being frequency-constrained. */
  readonly roleId: string;
  /** Minimum number of times the object must play the role. */
  readonly min: number;
  /** Maximum times, or "unbounded" for no upper limit. */
  readonly max: number | "unbounded";
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
  | FrequencyConstraint;

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
