/**
 * Role-graph traversal primitive.
 *
 * The single, pure adjacency walk over an ORM model's fact-type graph,
 * shared by the symbolic query path search (read-time discovery in
 * `query/evaluate.ts`) and the forthcoming role-path constraint operands
 * (declared and serialized -- see docs/specs/role-path-model.spec.md). One
 * walk, two callers: query BFS expands `hopsFrom` to find a path between two
 * entities; a declared role path is validated by checking each of its steps
 * is a real `RoleHop` and that consecutive steps are contiguous.
 *
 * Keeping the adjacency here (rather than open-coded in each caller) is the
 * ADR-0001 "reuse the traversal, don't fork it" requirement made concrete.
 */

import type { FactType } from "./FactType.js";
import type { OrmModel } from "./OrmModel.js";
import type { Role } from "./Role.js";

/**
 * One single-fact-type hop leaving an object type: enter the fact type at
 * `entryRole` (a role the object plays) and exit at `exitRole` (another role
 * of the same fact type), arriving at `exitRole`'s player.
 */
export interface RoleHop {
  readonly factType: FactType;
  readonly entryRole: Role;
  readonly exitRole: Role;
}

/**
 * Every one-fact-type hop leaving `objectTypeId`, in deterministic order:
 * fact types in `factTypesForObjectType` order, then for each role the object
 * plays (the entry role) each other role of that fact type (the exit role) in
 * `roles` order.
 *
 * Ring hops -- where the exit role's player is the object itself -- are
 * included; a caller walking the graph as a simple node graph (e.g. BFS
 * discovery) skips them via its own visited set, while a ring-constraint
 * evaluator needs them.
 */
export function hopsFrom(model: OrmModel, objectTypeId: string): RoleHop[] {
  const hops: RoleHop[] = [];
  for (const factType of model.factTypesForObjectType(objectTypeId)) {
    for (const entryRole of factType.rolesForPlayer(objectTypeId)) {
      for (const exitRole of factType.roles) {
        if (exitRole.id === entryRole.id) continue;
        hops.push({ factType, entryRole, exitRole });
      }
    }
  }
  return hops;
}
