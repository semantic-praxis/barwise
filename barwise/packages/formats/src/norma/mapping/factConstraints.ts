/**
 * Single-constraint mapping: one parsed NORMA constraint to one Barwise
 * `Constraint`, in the context of the fact type being built.
 *
 * Used by phase 2 while resolving a fact type's InternalConstraints and by
 * the top-level constraint passes.
 */
import type { Constraint, JoinOperand, ValueComparisonOperator } from "@barwise/core";
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
import type { NormaJoinDecoder } from "./joinPaths.js";

/**
 * Map a single NORMA constraint to a Barwise Constraint.
 * Returns undefined if the constraint cannot be mapped (e.g., it references
 * roles outside this fact type).
 */
export function mapNormaConstraint(
  nc: NormaConstraint,
  nft: NormaFactType,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  const factRoleIds = new Set(nft.roles.map((r) => r.id));
  const mapped = mapByType(nc, factRoleIds, joinDecoder);
  if (!mapped) return undefined;
  // Deontic modality survives the trip; alethic is the default and stays
  // implicit on both sides.
  return nc.modality === "deontic" ? { ...mapped, modality: "deontic" } : mapped;
}

function mapByType(
  nc: NormaConstraint,
  factRoleIds: Set<string>,
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  switch (nc.type) {
    case "uniqueness":
      return mapUniquenessConstraint(nc, factRoleIds);
    case "mandatory":
      return mapMandatoryConstraint(nc, factRoleIds);
    case "frequency":
      return mapFrequencyConstraint(nc, factRoleIds);
    case "value_constraint":
      return mapValueConstraint(nc, factRoleIds);
    case "subset":
      return mapSubsetConstraint(nc, joinDecoder);
    case "exclusion":
      return mapExclusionConstraint(nc, joinDecoder);
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

function mapMandatoryConstraint(
  nc: NormaMandatoryConstraint,
  factRoleIds: Set<string>,
): Constraint | undefined {
  // NORMA auto-generates implied mandatory constraints for all played roles.
  // These are not part of the user's model and must be excluded.
  if (nc.isImplied) return undefined;

  if (nc.isSimple) {
    // Simple mandatory -> maps to mandatory role constraint.
    const roleId = nc.roleRefs.find((r) => factRoleIds.has(r));
    if (!roleId) return undefined;
    return { type: "mandatory", roleId };
  } else if (nc.exclusiveOrExclusionRef !== undefined) {
    // Coupled to an exclusion: NORMA's exclusive-or encoding. The pair
    // maps to one exclusive_or; the paired exclusion maps to the same
    // constraint and duplicates are dropped by the callers.
    return {
      type: "exclusive_or",
      roleIds: nc.roleRefs,
    };
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
  joinDecoder?: NormaJoinDecoder,
): Constraint | undefined {
  const joinOperands = decodeSequenceOperands(
    nc.roleSequences,
    nc.joinPaths,
    joinDecoder,
  );
  if (joinOperands) {
    return { type: "join_exclusion", operands: joinOperands };
  }

  // Flatten role sequences into a single array of role ids.
  const allRoleIds = nc.roleSequences.flat();
  if (allRoleIds.length === 0) return undefined;

  // Coupled to a disjunctive mandatory: NORMA's exclusive-or encoding.
  if (nc.exclusiveOrMandatoryRef !== undefined) {
    return {
      type: "exclusive_or",
      roleIds: allRoleIds,
    };
  }

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
    ...(nc.modality === "deontic" ? { modality: "deontic" as const } : {}),
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
