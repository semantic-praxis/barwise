/**
 * Single-constraint mapping: one parsed NORMA constraint to one Barwise
 * `Constraint`, in the context of the fact type being built.
 *
 * Used by phase 2 while resolving a fact type's InternalConstraints and by
 * the top-level constraint passes.
 */
import {
  canonicalJson,
  type Constraint,
  type JoinOperand,
  type ValueComparisonOperator,
} from "@barwise/core";
import type {
  NormaConstraint,
  NormaEqualityConstraint,
  NormaExclusionConstraint,
  NormaFactType,
  NormaFrequencyConstraint,
  NormaJoinPath,
  NormaMandatoryConstraint,
  NormaRingConstraint,
  NormaSubsetConstraint,
  NormaUniquenessConstraint,
  NormaValueComparisonConstraint,
  NormaValueComparisonOperator,
  NormaValueConstraint,
} from "../NormaXmlTypes.js";
import type { ConstraintIdAllocator } from "./context.js";
import type { NormaJoinDecoder } from "./joinPaths.js";

/**
 * Map a single NORMA constraint to a Barwise Constraint.
 * Returns undefined if the constraint cannot be mapped (e.g., it references
 * roles outside this fact type).
 */
export function mapNormaConstraint(
  nc: NormaConstraint,
  nft: NormaFactType,
  exclusiveOrHalf: boolean,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  const factRoleIds = new Set(nft.roles.map((r) => r.id));
  const mapped = mapByType(nc, factRoleIds, exclusiveOrHalf, joinDecoder);
  return mapped && withModality(nc, mapped);
}

/**
 * `mapped` carrying `nc`'s modality. Deontic survives the trip; alethic is
 * the default and stays implicit on both sides. Every phase applies this,
 * so whether a constraint keeps its modality never depends on whether a
 * fact type lists it.
 */
export function withModality(nc: NormaConstraint, mapped: Constraint): Constraint {
  return nc.modality === "deontic" ? { ...mapped, modality: "deontic" } : mapped;
}

/**
 * True when `held` already has a constraint saying exactly what
 * `candidate` says: same kind, fields, role order and modality, id aside.
 * The one duplicate rule for every phase. What it is checked against is the
 * caller's: phase 1 passes one fact type's list, and phase 3 passes the
 * fact type for a constraint of one fact type and the whole model for one
 * across fact types, so until 3c places by kind, a copy two fact types'
 * InternalConstraints both list survives phase 1.
 *
 * Per-kind checks over a few fields used to stand here, and they drifted --
 * a subset compared only its subset roles, an equality only its first
 * sequence, a ring ignored its ring type -- and each drift dropped a
 * distinct constraint and its NORMA id without a word, from files NORMA
 * writes (two subsets from one role). Whole content can only keep a
 * constraint that says something different; at worst one written twice in
 * another role order is kept twice, which loses nothing.
 *
 * An exclusive_or is the one exception, merged by its role SET and modality
 * in `ConstraintIdAllocator.buildExclusiveOr`: its role order carries no
 * meaning, and its two halves may name the roles in different orders.
 */
export function holdsSame(held: readonly Constraint[], candidate: Constraint): boolean {
  const content = (c: Constraint) => canonicalJson({ ...c, id: undefined });
  const key = content(candidate);
  // The kind first: phase 3 checks every constraint across fact types in
  // the model, and most of them cannot match.
  return held.some((c) => c.type === candidate.type && content(c) === key);
}

type ExclusiveOr = Extract<Constraint, { type: "exclusive_or"; }>;

/**
 * The exclusive_or `mapped` from the half `nc`, with its modality and id,
 * ready to attach -- or undefined when its pair, or another pair over the
 * same roles, already has one (`ConstraintIdAllocator.buildExclusiveOr`).
 * The one step every exclusive_or site takes, so none attaches one without
 * the check.
 */
export function exclusiveOrToAdd(
  ids: ConstraintIdAllocator,
  nc: NormaConstraint,
  mapped: ExclusiveOr,
): Constraint | undefined {
  const id = ids.buildExclusiveOr(nc, mapped.roleIds);
  return id === undefined ? undefined : { ...withModality(nc, mapped), id };
}

/**
 * The exclusive_or a mandatory half builds, over its own roles: the one
 * shape both phases build, whichever reaches the pair (modality is added by
 * `withModality`).
 */
export function exclusiveOrFromMandatory(nc: NormaMandatoryConstraint): ExclusiveOr {
  return { type: "exclusive_or", roleIds: [...nc.roleRefs] };
}

function mapByType(
  nc: NormaConstraint,
  factRoleIds: Set<string>,
  exclusiveOrHalf: boolean,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  switch (nc.type) {
    case "uniqueness":
      return mapUniquenessConstraint(nc, factRoleIds);
    case "mandatory":
      return mapMandatoryConstraint(nc, factRoleIds, exclusiveOrHalf);
    case "frequency":
      return mapFrequencyConstraint(nc, factRoleIds);
    case "value_constraint":
      return mapValueConstraint(nc, factRoleIds);
    case "subset":
      return mapSubsetConstraint(nc, joinDecoder);
    case "exclusion":
      return mapExclusionConstraint(nc, exclusiveOrHalf, joinDecoder);
    case "equality":
      return mapEqualityConstraint(nc, joinDecoder);
    case "ring":
      return mapRingConstraint(nc, factRoleIds);
    case "value_comparison":
      return mapValueComparisonConstraint(nc, factRoleIds);
    default:
      return undefined;
  }
}

function mapUniquenessConstraint(
  nc: NormaUniquenessConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  // Only map internal uniqueness constraints that reference roles in this fact type.
  const relevantRoles = nc.roleRefs.filter((r) => factRoleIds.has(r));
  if (relevantRoles.length === 0) return undefined;

  if (nc.isInternal) {
    const result: Constraint = {
      type: "internal_uniqueness",
      roleIds: relevantRoles,
    };
    if (nc.isPreferred) {
      return { ...result, isPreferred: true } as Constraint;
    }
    return result;
  } else {
    return {
      type: "external_uniqueness",
      roleIds: nc.roleRefs,
    };
  }
}

/**
 * `exclusiveOrHalf` says whether `nc` maps as an exclusive-or, paired or
 * alone (`ExclusiveOrPairs.exclusiveOrIds`); a half's own coupler alone is
 * not enough to tell, since a file may carry only the other's.
 */
function mapMandatoryConstraint(
  nc: NormaMandatoryConstraint,
  factRoleIds: Set<string>,
  exclusiveOrHalf: boolean,
): Constraint | undefined {
  // NORMA auto-generates implied mandatory constraints for all played roles.
  // These are not part of the user's model and must be excluded.
  if (nc.isImplied) return undefined;

  if (nc.isSimple) {
    // Simple mandatory -> maps to mandatory role constraint.
    const roleId = nc.roleRefs.find((r) => factRoleIds.has(r));
    if (!roleId) return undefined;
    return { type: "mandatory", roleId };
  } else if (exclusiveOrHalf) {
    // Coupled to an exclusion: NORMA's exclusive-or encoding. The pair
    // maps to one exclusive_or; the paired exclusion maps to the same
    // constraint, and `ConstraintIdAllocator.buildExclusiveOr` lets only the
    // first to reach the pair build it.
    return exclusiveOrFromMandatory(nc);
  } else {
    // Disjunctive mandatory -> maps to disjunctive_mandatory.
    return {
      type: "disjunctive_mandatory",
      roleIds: nc.roleRefs,
    };
  }
}

function mapFrequencyConstraint(
  nc: NormaFrequencyConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  // Keep the whole role sequence (a multi-role frequency is a combination);
  // restrict to roles that belong to this fact type.
  const roleIds = nc.roleRefs.filter((r) => factRoleIds.has(r));
  if (roleIds.length === 0) return undefined;
  return {
    type: "frequency",
    roleIds,
    min: nc.min,
    max: nc.max,
  };
}

function mapValueConstraint(
  nc: NormaValueConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  const roleId = nc.roleRefs.find((r) => factRoleIds.has(r));
  if (!roleId) return undefined;
  return {
    type: "value_constraint",
    roleId,
    values: nc.values,
    ...(nc.ranges && nc.ranges.length > 0 ? { ranges: nc.ranges } : {}),
  };
}

export function mapSubsetConstraint(
  nc: NormaSubsetConstraint,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  // A role sequence carrying a join path routes to the join variant; when
  // any operand falls outside the minimal grammar, fall back to the flat
  // mapping (which drops the path, today's behavior).
  if (joinDecoder && (nc.subsetJoinPath || nc.supersetJoinPath)) {
    const subset = joinDecoder.decodeOperand(nc.subsetRoleRefs, nc.subsetJoinPath);
    const superset = joinDecoder.decodeOperand(nc.supersetRoleRefs, nc.supersetJoinPath);
    if (subset && superset) {
      return { type: "join_subset", subset, superset };
    }
  }
  return {
    type: "subset",
    subsetRoleIds: [...nc.subsetRoleRefs],
    supersetRoleIds: [...nc.supersetRoleRefs],
  };
}

export function mapExclusionConstraint(
  nc: NormaExclusionConstraint,
  exclusiveOrHalf: boolean,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  // Flatten role sequences into a single array of role ids.
  const allRoleIds = nc.roleSequences.flat();

  // Coupled to a disjunctive mandatory: NORMA's exclusive-or encoding. Only
  // an unpaired half reaches here (`exclusiveOrHalf`): plain, over single
  // roles (`collectExclusiveOrPairs`). A paired exclusion never does --
  // phase 1 maps its pair from the mandatory and phase 3 skips it.
  if (exclusiveOrHalf) {
    return {
      type: "exclusive_or",
      roleIds: allRoleIds,
    };
  }

  const joinOperands = decodeSequenceOperands(
    nc.roleSequences,
    nc.joinPaths,
    joinDecoder,
  );
  if (joinOperands) {
    return { type: "join_exclusion", operands: joinOperands };
  }
  if (allRoleIds.length === 0) return undefined;

  return {
    type: "exclusion",
    roleIds: allRoleIds,
  };
}

/** NORMA's ValueComparisonOperatorValues -> barwise comparison operators. */
const normaOperatorToBarwise: Partial<
  Record<NormaValueComparisonOperator, ValueComparisonOperator>
> = {
  LessThan: "<",
  LessThanOrEqual: "<=",
  Equal: "=",
  NotEqual: "<>",
  GreaterThanOrEqual: ">=",
  GreaterThan: ">",
};

/**
 * Map a NORMA value-comparison constraint. Only the same-fact-type,
 * no-join case is representable; an `Undefined` operator is NORMA's
 * own validation-error state and is skipped like other unmappable
 * constructs.
 */
export function mapValueComparisonConstraint(
  nc: NormaValueComparisonConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  const operator = normaOperatorToBarwise[nc.operator];
  if (!operator) return undefined;
  if (nc.roleRefs.length !== 2) return undefined;
  const [roleId1, roleId2] = nc.roleRefs;
  if (!factRoleIds.has(roleId1!) || !factRoleIds.has(roleId2!)) return undefined;
  return {
    type: "value_comparison",
    roleId1: roleId1!,
    roleId2: roleId2!,
    operator,
  };
}

export function mapEqualityConstraint(
  nc: NormaEqualityConstraint,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  if (nc.roleSequences.length < 2) return undefined;

  const joinOperands = decodeSequenceOperands(
    nc.roleSequences,
    nc.joinPaths,
    joinDecoder,
  );
  if (joinOperands) {
    return { type: "join_equality", operands: joinOperands };
  }

  return {
    type: "equality",
    roleIds1: [...nc.roleSequences[0]!],
    roleIds2: [...nc.roleSequences[1]!],
  };
}

/**
 * Decode every role sequence of a multi-sequence constraint into a
 * JoinOperand, when at least one sequence carries a join path. Returns
 * undefined -- meaning "use the flat mapping" -- when no sequence has a
 * path, there are fewer than two sequences, or any operand falls outside
 * the minimal grammar.
 */
function decodeSequenceOperands(
  roleSequences: readonly (readonly string[])[],
  joinPaths: readonly (NormaJoinPath | undefined)[] | undefined,
  joinDecoder: NormaJoinDecoder | undefined,
): JoinOperand[] | undefined {
  if (!joinDecoder || !joinPaths?.some(Boolean)) return undefined;
  if (roleSequences.length < 2) return undefined;

  const operands: JoinOperand[] = [];
  for (let i = 0; i < roleSequences.length; i++) {
    const operand = joinDecoder.decodeOperand(roleSequences[i]!, joinPaths[i]);
    if (!operand) return undefined;
    operands.push(operand);
  }
  return operands;
}

function mapRingConstraint(
  nc: NormaRingConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  const relevantRoles = nc.roleRefs.filter((r) => factRoleIds.has(r));
  if (relevantRoles.length < 2) return undefined;
  return {
    type: "ring",
    roleId1: relevantRoles[0]!,
    roleId2: relevantRoles[1]!,
    ringType: nc.ringType,
  };
}
