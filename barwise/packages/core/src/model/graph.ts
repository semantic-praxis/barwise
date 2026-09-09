/**
 * A graph derived once from a model, so a capability reads resolved
 * references instead of resolving them.
 *
 * The problem this exists for: `Role.playerId` is a bare `string`, so
 * every consumer looks the player up, guards against a failure
 * validation already refuses, and then discriminates on kind. In a model
 * that validates, the `undefined` arm of each is unreachable with
 * nothing to tell a reader so
 * (`docs/specs/model-graph-and-id-spaces.spec.md`). The count, with the
 * command, because a bare figure in a comment is how the spec's own
 * inventory went stale:
 *
 *   grep -rn 'getObjectType(' --include=*.ts \
 *     --exclude-dir=dist --exclude-dir=tests packages | wc -l
 *
 * gives 129 today. (Spelled with --exclude-dir rather than a path glob
 * because a glob of the form packages/<star>/src contains the two
 * characters that close a block comment, which is how this header first
 * failed to compile.)
 *
 * TOTALITY IS A PROPERTY OF A BUILT GRAPH, NOT OF `graphOf`. Building is
 * where a dangling reference is found, so that is where it is reported;
 * every accessor on a graph that was built is total. That is the whole
 * trade -- one failure point instead of one per lookup.
 *
 * The distinction matters because an `OrmModel` really can hold an
 * unresolvable reference. `ValidationEngine.validate` now builds this
 * graph first and reports what it finds, but validating is a separate
 * pass no caller is required to run, and no shipped surface runs it
 * before verbalizing (WS5 owns that). A caller holding a model loaded
 * with `lenient` and never validated is the case this refuses to answer
 * wrongly for.
 *
 * What it does NOT refuse is a role id that resolves to a role of the
 * WRONG fact type. That is a locality question, not a resolution one,
 * and `constraintConsistency` still owns it -- deleting its
 * `ft.hasRole` guards in favour of this module would have dropped the
 * case silently (barwise-976).
 *
 * DERIVED, NEVER STORED. Two live representations would have to be kept
 * in sync; one value and one view rebuilt from it cannot disagree.
 * Memoization is deliberately absent: a `WeakMap` cache would outlive an
 * `addObjectType` call while `OrmModel` is still mutable, so it waits
 * for the record conversion rather than shipping unsound here.
 */

import { type Constraint, objectTypeIdsOf, roleIdsOf } from "./Constraint.js";
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
  /**
   * Resolve an object type, a role or a fact type by id, totally.
   *
   * By id and not by element, deliberately: the model's own data is
   * id-shaped in the places these serve -- a join path step holds
   * `entry`/`exit` role ids, a path holds a `root` object type id, a
   * cycle result is a list of object type ids. Handing those an
   * element-shaped accessor would just move the lookup back to the
   * caller. What the graph removes here is not the id but the GUARD:
   * building proved these resolve, so there is no `undefined` arm.
   *
   * Three of these rather than a named accessor per relationship
   * (`subtypeOf`, `supertypeOf`, `factTypeOfObjectified`, ...) because
   * those would each be one line calling `objectType`, and five
   * one-line wrappers are an interface to learn that hides nothing.
   * Callers compose: `g.factTypeOf(g.role(step.entry))`.
   */
  objectType(id: string): ObjectType;
  role(id: string): Role;
  factType(id: string): FactType;
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
      // A join operand's path is rooted at an object type, which is a
      // reference like any other. Enumerated systematically rather than
      // found one at a time: Role.playerId, the constraint role ids,
      // these path roots, SubtypeFact's two ends, ObjectifiedFactType's
      // two, and Population.factTypeId are every id-shaped field in the
      // metamodel. JoinOperand.projection holds indices, not ids.
      for (const otId of objectTypeIdsOf(c)) {
        if (!model.getObjectType(otId)) {
          unresolved.push({
            from: { kind: "constraint", constraint: c, factType: ft },
            field: "path.root",
            missing: otId,
          });
        }
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

  // Past this point every reference the model DECLARES is proved, which
  // is what lets the accessors return a value rather than branch. What
  // building cannot prove is anything about an id or element a caller
  // invents, so a miss here is a programming error, not a model defect
  // -- and `undefined` typed as present would surface far from its
  // cause, which is the failure mode this whole module exists to
  // remove. Fail where the mistake is, with the id in the message.
  const must = <T>(value: T | undefined, what: string, id: string): T => {
    if (value === undefined) {
      throw new Error(
        `ModelGraph: no ${what} "${id}" in this model. The graph resolves only `
          + `references the model declares; this id belongs to another model or none.`,
      );
    }
    return value;
  };

  const graph: ModelGraph = {
    objectType: (id) => must(model.getObjectType(id), "object type", id),
    role: (id) => must(roleById.get(id), "role", id),
    factType: (id) => must(model.getFactType(id), "fact type", id),
    player: (role) => must(playerOfRole.get(role.id), "player for role", role.id),
    factTypeOf: (role) => must(factTypeOfRole.get(role.id), "fact type for role", role.id),
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
        player: must(playerOfRole.get(role.id), "player for role", role.id),
        factType: must(factTypeOfRole.get(role.id), "fact type for role", role.id),
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
