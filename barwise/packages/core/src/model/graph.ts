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
import type { ObjectifiedFactType } from "./ObjectifiedFactType.js";
import type { ObjectType } from "./ObjectType.js";
import type { OrmModel } from "./OrmModel.js";
import type { Population } from "./Population.js";
import type { Role } from "./Role.js";
import { hopsFrom, type RoleHop } from "./roleGraph.js";
import type { SubtypeFact } from "./SubtypeFact.js";

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
  /** The element that carries the dangling reference, resolved. */
  readonly from: ReferenceSource;
  /** The field that holds it, e.g. "playerId", "roleIds", "factTypeId". */
  readonly field: string;
  /** The id that does not resolve. */
  readonly missing: string;
}

/**
 * The element carrying an unresolvable reference -- the element itself,
 * not its id.
 *
 * An id would make every consumer look the element up, which is the
 * defect this whole module exists to remove; a record produced BY the
 * thing that eliminates lookups must not hand out bare ids. It is also
 * not enough in practice: `validation/` reports a dangling constraint
 * role under a per-KIND rule id (`mandatoryInvalidRole`,
 * `ringInvalidRole`, `frequencyInvalidRole` and four more), keyed on the
 * constraint's `type`, and names the owning fact type as the affected
 * element. Neither is recoverable from an id -- a constraint's id is
 * optional, so there may not even be one.
 */
export type ReferenceSource =
  | { readonly kind: "role"; readonly role: Role; readonly factType: FactType; }
  | { readonly kind: "constraint"; readonly constraint: Constraint; readonly factType: FactType; }
  | { readonly kind: "subtypeFact"; readonly subtypeFact: SubtypeFact; }
  | {
    readonly kind: "objectifiedFactType";
    readonly objectifiedFactType: ObjectifiedFactType;
  }
  | { readonly kind: "population"; readonly population: Population; };

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
      // A duplicate role id is not an unresolvable reference but an
      // AMBIGUOUS one, and it defeats totality just as thoroughly: an
      // id-keyed index keeps the last writer, so `factTypeOf` would
      // answer confidently for the wrong fact type. Nothing else in the
      // repo reports this -- structural.ts guards duplicate NAMES, not
      // ids -- so the graph refuses rather than answering wrongly.
      if (roleById.has(role.id)) {
        unresolved.push({
          from: { kind: "role", role, factType: ft },
          field: "id",
          missing: role.id,
        });
        continue;
      }
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
          from: { kind: "role", role, factType: ft },
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
  // Keyed by the constraint OBJECT, not by `c.id`. `Constraint.id` is
  // optional and `FactType.addConstraint` does not mint one (only the
  // constructor does), so an id-keyed index silently reports "no roles"
  // for a constraint that references real ones -- the same silent-[]
  // failure barwise-928 was about, which is why this is not keyed the
  // obvious way.
  const rolesOfConstraint = new Map<Constraint, Role[]>();
  const constraintsByRole = new Map<string, Constraint[]>();
  for (const ft of model.factTypes) {
    for (const c of ft.constraints) {
      const resolved: Role[] = [];
      for (const roleId of roleIdsOf(c)) {
        const role = roleById.get(roleId);
        if (!role) {
          unresolved.push({
            from: { kind: "constraint", constraint: c, factType: ft },
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
      rolesOfConstraint.set(c, resolved);
    }
  }

  for (const sf of model.subtypeFacts) {
    for (
      const [field, id] of [["subtypeId", sf.subtypeId], ["supertypeId", sf.supertypeId]] as const
    ) {
      if (!model.getObjectType(id)) {
        unresolved.push({ from: { kind: "subtypeFact", subtypeFact: sf }, field, missing: id });
      }
    }
  }

  for (const oft of model.objectifiedFactTypes) {
    if (!model.getFactType(oft.factTypeId)) {
      unresolved.push({
        from: { kind: "objectifiedFactType", objectifiedFactType: oft },
        field: "factTypeId",
        missing: oft.factTypeId,
      });
    }
    if (!model.getObjectType(oft.objectTypeId)) {
      unresolved.push({
        from: { kind: "objectifiedFactType", objectifiedFactType: oft },
        field: "objectTypeId",
        missing: oft.objectTypeId,
      });
    }
  }

  for (const pop of model.populations) {
    if (!model.getFactType(pop.factTypeId)) {
      unresolved.push({
        from: { kind: "population", population: pop },
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
    rolesOf: (c) => rolesOfConstraint.get(c) ?? [],
    constraintsOn: (role) => constraintsByRole.get(role.id) ?? [],
    rolesPlayedBy: (ot) => rolesByPlayer.get(ot.id) ?? [],
    populationsOf: (ft) => model.populationsForFactType(ft.id),
    supertypesOf: (ot) => model.supertypesOf(ot.id),
    subtypesOf: (ot) => model.subtypesOf(ot.id),
    hopsFrom: (ot) => hopsFrom(model, ot.id),
    resolve: (c) => {
      const roles = rolesOfConstraint.get(c) ?? [];
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
