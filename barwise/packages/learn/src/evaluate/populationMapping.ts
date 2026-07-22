/**
 * Map a forbidden population from the reference model onto the candidate.
 *
 * A counterexample's forbidden population is keyed by the reference
 * model's role ids, which do not exist in the candidate. To test the
 * candidate against it we re-express the population in terms of the
 * candidate's roles. The only stable cross-model key is the object type a
 * role is played by (the brief fixes the vocabulary), so we correspond
 * fact types by their multiset of player names and correspond roles by
 * player name -- and, where a player is repeated (a ring), by position.
 */
import type { FactType, OrmModel, Population, PopulationConfig, Role } from "@barwise/core";

/** The object-type name each role plays, in role order (undefined if unresolved). */
function playerNames(ft: FactType, model: OrmModel): (string | undefined)[] {
  return ft.roles.map((r) => model.getObjectType(r.playerId)?.name);
}

/** Are two arrays equal as multisets? */
function sameMultiset(a: (string | undefined)[], b: (string | undefined)[]): boolean {
  if (a.length !== b.length) return false;
  const sort = (xs: (string | undefined)[]) => [...xs].sort();
  const sa = sort(a);
  const sb = sort(b);
  return sa.every((x, i) => x === sb[i]);
}

/** The candidate fact type corresponding to a reference fact type, if any. */
function correspondingFactType(
  refNames: (string | undefined)[],
  candidate: OrmModel,
): FactType | undefined {
  if (refNames.some((n) => n === undefined)) return undefined;
  return candidate.factTypes.find((ft) => sameMultiset(playerNames(ft, candidate), refNames));
}

/**
 * Correspond reference role ids to candidate role ids: group each side's
 * roles by player name, then zip the groups in order (position
 * disambiguates repeated players). Returns null if the groupings do not
 * line up.
 */
function roleCorrespondence(
  refFt: FactType,
  refModel: OrmModel,
  candFt: FactType,
  candModel: OrmModel,
): Map<string, string> | null {
  const byPlayer = (ft: FactType, model: OrmModel): Map<string, Role[]> => {
    const groups = new Map<string, Role[]>();
    for (const r of ft.roles) {
      const name = model.getObjectType(r.playerId)?.name;
      if (name === undefined) return groups; // caller handles mismatch below
      const list = groups.get(name) ?? [];
      list.push(r);
      groups.set(name, list);
    }
    return groups;
  };

  const refGroups = byPlayer(refFt, refModel);
  const candGroups = byPlayer(candFt, candModel);
  if (refGroups.size !== candGroups.size) return null;

  const map = new Map<string, string>();
  for (const [name, refRoles] of refGroups) {
    const candRoles = candGroups.get(name);
    if (!candRoles || candRoles.length !== refRoles.length) return null;
    refRoles.forEach((rr, i) => map.set(rr.id, candRoles[i]!.id));
  }
  return map;
}

/**
 * Re-express a reference forbidden population as a `PopulationConfig`
 * against the candidate, or return null if no corresponding fact type or
 * role correspondence exists (which means the candidate has not modeled
 * the relationship the constraint would guard).
 */
export function mapForbiddenPopulation(
  forbidden: Population,
  refModel: OrmModel,
  candidate: OrmModel,
): PopulationConfig | null {
  const refFt = refModel.getFactType(forbidden.factTypeId);
  if (!refFt) return null;

  const candFt = correspondingFactType(playerNames(refFt, refModel), candidate);
  if (!candFt) return null;

  const roleMap = roleCorrespondence(refFt, refModel, candFt, candidate);
  if (!roleMap) return null;

  const instances: { roleValues: Record<string, string>; }[] = [];
  for (const inst of forbidden.instances) {
    const roleValues: Record<string, string> = {};
    for (const [refRoleId, value] of Object.entries(inst.roleValues)) {
      const candRoleId = roleMap.get(refRoleId);
      if (candRoleId === undefined) return null;
      roleValues[candRoleId] = value;
    }
    instances.push({ roleValues });
  }

  return { factTypeId: candFt.id, instances };
}
