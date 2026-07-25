/**
 * Single-constraint mapping: one parsed NORMA constraint to one Barwise
 * `Constraint`, in the context of the fact type being built.
 *
 * Used by phase 2 while resolving a fact type's InternalConstraints and by
 * the top-level constraint passes.
 */
import type { Constraint } from "@barwise/core";
import type {
  NormaConstraint,
  NormaEqualityConstraint,
  NormaExclusionConstraint,
  NormaFactType,
  NormaFrequencyConstraint,
  NormaMandatoryConstraint,
  NormaRingConstraint,
  NormaSubsetConstraint,
  NormaUniquenessConstraint,
  NormaValueConstraint,
} from "../NormaXmlTypes.js";

/**
 * Map a single NORMA constraint to a Barwise Constraint.
 * Returns undefined if the constraint cannot be mapped (e.g., it references
 * roles outside this fact type).
 */
export function mapNormaConstraint(
  nc: NormaConstraint,
  nft: NormaFactType,
): Constraint | undefined {
  const factRoleIds = new Set(nft.roles.map((r) => r.id));

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
      return mapSubsetConstraint(nc);
    case "exclusion":
      return mapExclusionConstraint(nc);
    case "equality":
      return mapEqualityConstraint(nc);
    case "ring":
      return mapRingConstraint(nc, factRoleIds);
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
): Constraint | undefined {
  return {
    type: "subset",
    subsetRoleIds: [...nc.subsetRoleRefs],
    supersetRoleIds: [...nc.supersetRoleRefs],
  };
}

export function mapExclusionConstraint(
  nc: NormaExclusionConstraint,
): Constraint | undefined {
  // Flatten role sequences into a single array of role ids.
  const allRoleIds = nc.roleSequences.flat();
  if (allRoleIds.length === 0) return undefined;

  // Check if NORMA paired this with a mandatory constraint (exclusive-or).
  // In NORMA, exclusive-or is an exclusion constraint + a mandatory constraint
  // on the same roles. The mapper currently maps them separately and lets
  // validation detect the pattern if needed.
  return {
    type: "exclusion",
    roleIds: allRoleIds,
  };
}

export function mapEqualityConstraint(
  nc: NormaEqualityConstraint,
): Constraint | undefined {
  if (nc.roleSequences.length < 2) return undefined;
  return {
    type: "equality",
    roleIds1: [...nc.roleSequences[0]!],
    roleIds2: [...nc.roleSequences[1]!],
  };
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
