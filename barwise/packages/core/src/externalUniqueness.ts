/**
 * External-uniqueness join inference.
 *
 * An external uniqueness constraint identifies an object by a combination
 * of roles that live in different fact types (e.g. a Room by its Building
 * and its RoomNumber). To check that the combination is unique, the fact
 * types must be joined on the common object -- but the constraint carries
 * only the constrained role ids, not the join key. This module infers the
 * join key for the standard pattern and skips (returns undefined) when it
 * is not a single, clear object type.
 */

import type { FactType } from "./model/FactType.js";
import type { OrmModel } from "./model/OrmModel.js";

/** The inferred join for an external uniqueness constraint. */
export interface ExternalUniquenessJoin {
  /** The common object type the combination identifies. */
  readonly commonObjectId: string;
  /** The fact types holding the constrained roles, in role order. */
  readonly factTypes: readonly FactType[];
  /** Per fact type: the role played by the common object (the join key). */
  readonly keyRoleByFactType: ReadonlyMap<string, string>;
  /** Per fact type: the constrained role whose value enters the combination. */
  readonly constrainedRoleByFactType: ReadonlyMap<string, string>;
}

function locate(
  model: OrmModel,
  roleId: string,
): { ft: FactType; playerId: string; } | undefined {
  for (const ft of model.factTypes) {
    const role = ft.getRoleById(roleId);
    if (role) return { ft, playerId: role.playerId };
  }
  return undefined;
}

/**
 * Infer the join for an external uniqueness constraint, or undefined when
 * the common object is not a single clear type (in which case callers skip).
 */
export function inferExternalUniquenessJoin(
  roleIds: readonly string[],
  model: OrmModel,
): ExternalUniquenessJoin | undefined {
  if (roleIds.length < 2) return undefined;

  const constrainedRoleByFactType = new Map<string, string>();
  const factTypes: FactType[] = [];
  const constrainedPlayers = new Set<string>();
  for (const roleId of roleIds) {
    const found = locate(model, roleId);
    if (!found) return undefined;
    // The standard pattern has one constrained role per fact type.
    if (constrainedRoleByFactType.has(found.ft.id)) return undefined;
    constrainedRoleByFactType.set(found.ft.id, roleId);
    factTypes.push(found.ft);
    constrainedPlayers.add(found.playerId);
  }

  // Candidate common objects: a type that plays exactly one non-constrained
  // role in every constrained fact type, and is not a constrained player.
  let candidates: Set<string> | undefined;
  const keyByFactTypeByPlayer = new Map<string, Map<string, string>>();
  for (const ft of factTypes) {
    const constrainedRoleId = constrainedRoleByFactType.get(ft.id)!;
    const rolesByPlayer = new Map<string, string[]>();
    for (const role of ft.roles) {
      if (role.id === constrainedRoleId) continue;
      const list = rolesByPlayer.get(role.playerId) ?? [];
      list.push(role.id);
      rolesByPlayer.set(role.playerId, list);
    }
    const ftCandidates = new Set<string>();
    const keyByPlayer = new Map<string, string>();
    for (const [playerId, roles] of rolesByPlayer) {
      if (constrainedPlayers.has(playerId) || roles.length !== 1) continue;
      ftCandidates.add(playerId);
      keyByPlayer.set(playerId, roles[0]!);
    }
    keyByFactTypeByPlayer.set(ft.id, keyByPlayer);
    candidates = candidates === undefined
      ? ftCandidates
      : new Set([...candidates].filter((p) => ftCandidates.has(p)));
  }

  if (!candidates || candidates.size !== 1) return undefined;
  const commonObjectId = [...candidates][0]!;

  const keyRoleByFactType = new Map<string, string>();
  for (const ft of factTypes) {
    keyRoleByFactType.set(ft.id, keyByFactTypeByPlayer.get(ft.id)!.get(commonObjectId)!);
  }
  return { commonObjectId, factTypes, keyRoleByFactType, constrainedRoleByFactType };
}
