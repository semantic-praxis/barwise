/**
 * A graph derived once from a model, so a capability reads resolved
 * references instead of resolving them.
 *
 * The problem this exists for: `Role.playerId` is a bare `string`, so
 * every consumer looks the player up, guards against a failure
 * validation already refuses, and then discriminates on kind -- 131
 * `getObjectType` call sites across the repo, 13 lookup prologues in the
 * validation rules alone, and in a model that validates the `undefined`
 * arm of each is unreachable with nothing to tell a reader so
 * (`docs/specs/model-graph-and-id-spaces.spec.md`).
 *
 * TOTALITY IS A PROPERTY OF A BUILT GRAPH, NOT OF `graphOf`. Building is
 * where a dangling reference is found, so that is where it is reported;
 * every accessor on a graph that was built is total. That is the whole
 * trade -- one failure point instead of 131. The distinction matters
 * because an `OrmModel` really can hold an unresolvable reference:
 * `constraintConsistency` reports a constraint naming a role its fact
 * type does not have, but reporting is a separate pass no caller is
 * required to run, and no shipped surface runs it before verbalizing.
 *
 * DERIVED, NEVER STORED. Two live representations would have to be kept
 * in sync; one value and one view rebuilt from it cannot disagree.
 * Memoization is deliberately absent: a `WeakMap` cache would outlive an
 * `addObjectType` call while `OrmModel` is still mutable, so it waits
 * for the record conversion rather than shipping unsound here.
 */

import { type Constraint, roleIdsOf } from "./Constraint.js";
import type { FactType } from "./FactType.js";
import type { ObjectType } from "./ObjectType.js";
import type { OrmModel } from "./OrmModel.js";
import type { Population } from "./Population.js";
import type { Role } from "./Role.js";
import { hopsFrom, type RoleHop } from "./roleGraph.js";

/**
 * A reference the model declares and cannot resolve.
 *
 * Plain records, NOT `Diagnostic`. Nothing under `model/` imports from
 * `validation/` today, and minting a `Diagnostic<RuleId>` here would
 * invert that layering for a type the graph does not otherwise need.
 * `validation/` maps these to the ids it already owns; every other
 * consumer reads them directly.
 */
export interface UnresolvedReference {
  /** The element that carries the dangling reference. */
  readonly from: {
    readonly kind: "role" | "constraint" | "subtypeFact" | "objectifiedFactType" | "population";
    readonly id: string;
  };
  /** The field that holds it, e.g. "playerId", "roleIds", "factTypeId". */
  readonly field: string;
  /** The id that does not resolve. */
  readonly missing: string;
}

export type GraphResult =
  | { readonly ok: true; readonly graph: ModelGraph; }
  | { readonly ok: false; readonly unresolved: readonly UnresolvedReference[]; };

/** A role with its player and fact type already resolved. */
export interface ResolvedRole {
  readonly role: Role;
  readonly player: ObjectType;
  readonly factType: FactType;
}

/** A constraint with every role it references resolved. */
export interface ResolvedConstraint {
  readonly constraint: Constraint;
  readonly roles: readonly ResolvedRole[];
  /** True when the constraint's roles span more than one fact type. */
  readonly spansFactTypes: boolean;
  /** The player shared by every role, when they share one. */
  readonly commonPlayer?: ObjectType;
}

/**
 * Every accessor is total: building proved the references, so none can
 * return `undefined` for a reference the model declares.
 */
export interface ModelGraph {
  player(role: Role): ObjectType;
  factTypeOf(role: Role): FactType;
  rolesOf(c: Constraint): readonly Role[];
  constraintsOn(role: Role): readonly Constraint[];
  rolesPlayedBy(ot: ObjectType): readonly Role[];
  populationsOf(ft: FactType): readonly Population[];
  supertypesOf(ot: ObjectType): readonly ObjectType[];
  subtypesOf(ot: ObjectType): readonly ObjectType[];
  hopsFrom(ot: ObjectType): readonly RoleHop[];
  resolve(c: Constraint): ResolvedConstraint;
}

/**
 * Derive the graph, or report every reference that does not resolve.
 *
 * Collects ALL unresolvable references rather than failing at the first:
 * a caller fixing a model wants the whole list, and validation maps the
 * whole list to diagnostics in one pass.
 */
export function graphOf(model: OrmModel): GraphResult {
  const unresolved: UnresolvedReference[] = [];

  const roleById = new Map<string, Role>();
  const factTypeOfRole = new Map<string, FactType>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      roleById.set(role.id, role);
      factTypeOfRole.set(role.id, ft);
    }
  }

  // A role's player, and the object types that play each role.
  const playerOfRole = new Map<string, ObjectType>();
  const rolesByPlayer = new Map<string, Role[]>();
  for (const ft of model.factTypes) {
    for (const role of ft.roles) {
      const player = model.getObjectType(role.playerId);
      if (!player) {
        unresolved.push({
          from: { kind: "role", id: role.id },
          field: "playerId",
          missing: role.playerId,
        });
        continue;
      }
      playerOfRole.set(role.id, player);
      const list = rolesByPlayer.get(player.id);
      if (list) list.push(role);
      else rolesByPlayer.set(player.id, [role]);
    }
  }

  // Constraint -> roles, and the reverse index.
  const rolesOfConstraint = new Map<string, Role[]>();
  const constraintsByRole = new Map<string, Constraint[]>();
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      const resolved: Role[] = [];
      for (const roleId of roleIdsOf(c)) {
        const role = roleById.get(roleId);
        if (!role) {
          unresolved.push({
            from: { kind: "constraint", id: c.id ?? "" },
            field: "roleIds",
            missing: roleId,
          });
          continue;
        }
        resolved.push(role);
        const list = constraintsByRole.get(role.id);
        if (list) list.push(c);
        else constraintsByRole.set(role.id, [c]);
      }
      if (c.id) rolesOfConstraint.set(c.id, resolved);
    }
  }

  for (const sf of model.subtypeFacts) {
    for (
      const [field, id] of [["subtypeId", sf.subtypeId], ["supertypeId", sf.supertypeId]] as const
    ) {
      if (!model.getObjectType(id)) {
        unresolved.push({ from: { kind: "subtypeFact", id: sf.id }, field, missing: id });
      }
    }
  }

  for (const oft of model.objectifiedFactTypes) {
    if (!model.getFactType(oft.factTypeId)) {
      unresolved.push({
        from: { kind: "objectifiedFactType", id: oft.id },
        field: "factTypeId",
        missing: oft.factTypeId,
      });
    }
    if (!model.getObjectType(oft.objectTypeId)) {
      unresolved.push({
        from: { kind: "objectifiedFactType", id: oft.id },
        field: "objectTypeId",
        missing: oft.objectTypeId,
      });
    }
  }

  for (const pop of model.populations) {
    if (!model.getFactType(pop.factTypeId)) {
      unresolved.push({
        from: { kind: "population", id: pop.id },
        field: "factTypeId",
        missing: pop.factTypeId,
      });
    }
  }

  if (unresolved.length > 0) return { ok: false, unresolved };

  // Past this point every lookup below is proved, which is what lets the
  // accessors assert rather than branch. A `!` here is a claim the loops
  // above established, not a shortcut.
  const graph: ModelGraph = {
    player: (role) => playerOfRole.get(role.id)!,
    factTypeOf: (role) => factTypeOfRole.get(role.id)!,
    rolesOf: (c) => (c.id ? rolesOfConstraint.get(c.id) ?? [] : []),
    constraintsOn: (role) => constraintsByRole.get(role.id) ?? [],
    rolesPlayedBy: (ot) => rolesByPlayer.get(ot.id) ?? [],
    populationsOf: (ft) => model.populationsForFactType(ft.id),
    supertypesOf: (ot) => model.supertypesOf(ot.id),
    subtypesOf: (ot) => model.subtypesOf(ot.id),
    hopsFrom: (ot) => hopsFrom(model, ot.id),
    resolve: (c) => {
      const roles = c.id ? rolesOfConstraint.get(c.id) ?? [] : [];
      const resolvedRoles: ResolvedRole[] = roles.map((role) => ({
        role,
        player: playerOfRole.get(role.id)!,
        factType: factTypeOfRole.get(role.id)!,
      }));
      const factTypeIds = new Set(resolvedRoles.map((r) => r.factType.id));
      const playerIds = new Set(resolvedRoles.map((r) => r.player.id));
      const first = resolvedRoles[0];
      return {
        constraint: c,
        roles: resolvedRoles,
        spansFactTypes: factTypeIds.size > 1,
        ...(playerIds.size === 1 && first ? { commonPlayer: first.player } : {}),
      };
    },
  };

  return { ok: true, graph };
}
