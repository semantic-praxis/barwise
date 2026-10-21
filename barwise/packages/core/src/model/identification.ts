import { type InternalUniquenessConstraint, isInternalUniqueness } from "./Constraint.js";
import type { FactType } from "./FactType.js";
import type { ObjectType, ValueType } from "./ObjectType.js";
import type { OrmModel } from "./OrmModel.js";
import type { Role } from "./Role.js";

/**
 * What actually identifies an entity type: the binary fact type, the
 * role the entity plays in it, and the value type on the other side.
 */
export interface PreferredIdentifyingBinary {
  readonly factType: FactType;
  readonly entityRole: Role;
  readonly valuePlayer: ValueType;
}

/**
 * Which entity types an entity type's identification depends on.
 *
 * A relational mapping has to settle every table's primary key before
 * anything reads one, and settling them needs an order. The order comes
 * from this graph, and the graph is only usable if it is acyclic --
 * which nothing enforced until `structural/identification-cycle`.
 *
 * Two edges, one per way an entity type borrows another's identity:
 *
 * - **Objectification.** An objectifying entity type is identified by
 *   the fact type it objectifies, so it depends on each entity player of
 *   that fact type. A type that plays a role in the fact type it
 *   objectifies therefore depends on itself, which is the length-one
 *   cycle and was barwise-962.
 * - **Identifying subtype.** A subtype whose subtype fact declares
 *   `providesIdentification` extends its supertype's key, so it depends
 *   on the supertype. A non-identifying subtype gets its own key and is
 *   not an edge.
 *
 * `structural/subtype-cycle` covers one of those edges for one of those
 * reasons; this covers both, which is what makes a settlement order
 * well-defined. It lives in `model/` because "what identifies what" is a
 * metamodel question -- the validator asks it to report a cycle and the
 * mapper asks it to order settlement, and neither owns the answer.
 */
export function identificationGraph(model: OrmModel): Map<string, readonly string[]> {
  const edges = new Map<string, string[]>();
  const add = (from: string, to: string): void => {
    const existing = edges.get(from);
    if (existing) existing.push(to);
    else edges.set(from, [to]);
  };

  for (const oft of model.objectifiedFactTypes) {
    const factType = model.getFactType(oft.factTypeId);
    if (!factType) continue; // structural/objectified-dangling-fact-type reports it
    for (const role of factType.roles) {
      if (model.getObjectType(role.playerId)?.kind === "entity") {
        add(oft.objectTypeId, role.playerId);
      }
    }
  }

  for (const sf of model.subtypeFacts) {
    if (sf.providesIdentification) add(sf.subtypeId, sf.supertypeId);
  }

  return edges;
}

/**
 * A settlement order for every entity type, or the cycle that makes one
 * impossible.
 *
 * Total by construction: it reports a cycle rather than throwing, so the
 * mapper stays total on a model that reached it unvalidated. Dependencies
 * come first, so an entity type's key can be settled once every entity
 * type it appears after has one.
 *
 * The order is deterministic for a given model: object types are visited
 * in declaration order and each node's dependencies in the order the
 * graph records them, so the same model always yields the same order and
 * the same cycle.
 */
export function identificationOrder(
  model: OrmModel,
): { readonly order: readonly string[]; } | { readonly cycle: readonly string[]; } {
  const edges = identificationGraph(model);
  const order: string[] = [];
  const settled = new Set<string>();
  const onPath: string[] = [];
  const onPathSet = new Set<string>();

  const visit = (id: string): readonly string[] | undefined => {
    if (settled.has(id)) return undefined;
    if (onPathSet.has(id)) return [...onPath.slice(onPath.indexOf(id)), id];

    onPath.push(id);
    onPathSet.add(id);
    for (const dependency of edges.get(id) ?? []) {
      const cycle = visit(dependency);
      if (cycle) return cycle;
    }
    onPath.pop();
    onPathSet.delete(id);

    settled.add(id);
    order.push(id);
    return undefined;
  };

  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity") continue;
    const cycle = visit(ot.id);
    if (cycle) return { cycle };
  }

  return { order };
}

/** Which uniqueness identifies which entity type, both ways round. */
export interface PreferredIdentifiers {
  readonly byEntity: ReadonlyMap<string, IdentifyingUniqueness>;
  readonly byConstraint: ReadonlyMap<string, IdentifyingUniqueness>;
}

/** The uniqueness constraint that identifies an entity type, and where it is. */
export interface IdentifyingUniqueness {
  readonly entityId: string;
  readonly constraint: InternalUniquenessConstraint;
  readonly factType: FactType;
}

/**
 * Which uniqueness identifies which entity type: one answer for every
 * reader (orm-format-3, Open decision 8 and WS4a; barwise-971).
 *
 * Nine modules used to answer "which constraint is this entity's
 * preferred identifier" with nine rules, and the two conventions for
 * where the `isPreferred` flag sits meant each one found nothing on some
 * models: the importers flag the uniqueness on the value's role, the
 * extraction prompt flags the entity's role. This reads each flag the way
 * ORM and NORMA's `PreferredIdentifier` mean it, as naming the entity the
 * roles opposite the uniqueness identify:
 *
 * - a flagged uniqueness on an objectified fact type that spans every
 *   role, or, as NORMA allows, all but one, identifies the objectifying type (Open decision 8 named only the spanning case; the auction
 *   models' objectified ternaries are identified by a two-role uniqueness,
 *   and reading those flags as naming the third role's player made an
 *   entity with its own reference scheme the claimant);
 * - a flagged uniqueness on either role of a binary between one entity
 *   and one value type identifies the entity, by the uniqueness on the
 *   value's role (and is dropped when there is none);
 * - otherwise, a flagged uniqueness whose uncovered roles are all played
 *   by one entity type, which plays none of the covered roles, identifies
 *   that entity (a ring binary does not identify its player by itself);
 * - anything else is dropped.
 *
 * Two flags naming one entity is a modelling error
 * (`completeness/multiple-preferred-identifiers`, which counts the flags
 * themselves through `identificationSources`, so this resolution cannot
 * hide it). The entity-value binary wins, so an objectified type with its
 * own reference scheme keeps the key the mapper gives it today (Open
 * decision 11); then the first in model order.
 *
 * `byConstraint` is the inverse, for readers that ask about a fact type
 * or a constraint rather than an entity: calling a per-entity lookup
 * inside a loop over fact types would make each of them quadratic.
 */
export function preferredIdentifiers(model: OrmModel): PreferredIdentifiers {
  const objectifying = new Map(
    model.objectifiedFactTypes.map((oft) => [oft.factTypeId, oft.objectTypeId]),
  );
  const chosen = new Map<string, { readonly at: IdentifyingUniqueness; readonly rank: number; }>();
  const offer = (at: IdentifyingUniqueness, rank: number): void => {
    const held = chosen.get(at.entityId);
    if (!held || rank < held.rank) chosen.set(at.entityId, { at, rank });
  };
  const isEntity = (id: string) => model.getObjectType(id)?.kind === "entity";

  for (const factType of model.factTypes) {
    for (const c of factType.internalConstraints) {
      if (!isInternalUniqueness(c) || !c.isPreferred) continue;
      const covered = new Set(c.roleIds);

      const objectType = objectifying.get(factType.id);
      if (objectType && covered.size >= factType.roles.length - 1) {
        if (isEntity(objectType)) offer({ entityId: objectType, constraint: c, factType }, 1);
        continue;
      }

      const binary = entityValueRoles(model, factType);
      if (binary) {
        // The flagged one itself when it is on the value's role, so a
        // second uniqueness there does not take its place.
        const onValueRole = (u: InternalUniquenessConstraint) =>
          u.roleIds.length === 1 && u.roleIds[0] === binary.valueRole.id;
        const onValue = onValueRole(c) ? c : factType.internalConstraints.find(
          (u): u is InternalUniquenessConstraint => isInternalUniqueness(u) && onValueRole(u),
        );
        if (onValue) {
          offer({ entityId: binary.entityRole.playerId, constraint: onValue, factType }, 0);
        }
        continue;
      }

      const players = new Set(
        factType.roles.filter((r) => !covered.has(r.id)).map((r) => r.playerId),
      );
      const [only] = players;
      const playsCovered = factType.roles.some((r) => covered.has(r.id) && r.playerId === only);
      if (players.size === 1 && only !== undefined && isEntity(only) && !playsCovered) {
        offer({ entityId: only, constraint: c, factType }, 1);
      }
    }
  }

  const byEntity = new Map([...chosen].map(([id, { at }]) => [id, at]));
  const byConstraint = new Map<string, IdentifyingUniqueness>();
  for (const at of byEntity.values()) {
    if (at.constraint.id !== undefined) byConstraint.set(at.constraint.id, at);
  }
  return { byEntity, byConstraint };
}

/** The entity's and the value's roles of a binary between one of each. */
function entityValueRoles(
  model: OrmModel,
  factType: FactType,
): { readonly entityRole: Role; readonly valueRole: Role; } | undefined {
  if (factType.arity !== 2) return undefined;
  const [r1, r2] = factType.roles;
  if (!r1 || !r2) return undefined;
  const k1 = model.getObjectType(r1.playerId)?.kind;
  const k2 = model.getObjectType(r2.playerId)?.kind;
  if (k1 === "entity" && k2 === "value") return { entityRole: r1, valueRole: r2 };
  if (k1 === "value" && k2 === "entity") return { entityRole: r2, valueRole: r1 };
  return undefined;
}

/**
 * The binary fact type that identifies an entity type, when it has one.
 *
 * A reference mode is shorthand for exactly this: an identifying binary
 * between an entity and a value type. A model may state both, and then
 * the reference mode is the redundant half -- `completenessWarnings`
 * calls the preferred identifier the authority and the mapper's own
 * fallback path calls the reference mode "the heuristic".
 *
 * Returning the fact type, rather than something derived from it, is
 * the point. `resolveEntityPkType` used to ask a narrower question --
 * what SQL type -- and discard the fact type it found the answer on, so
 * nothing downstream could know the fact type had already been spent on
 * the primary key. It was then mapped a second time as an ordinary
 * value column: one identification, two columns, on 109 entities across
 * 15 shipped models (barwise-967).
 *
 * It is `preferredIdentifiers`' answer when that answer is such a
 * binary. Pass the result of `preferredIdentifiers` when calling this for
 * many entities, so the model is read once.
 */
export function preferredIdentifyingBinary(
  model: OrmModel,
  entity: ObjectType,
  identifiers = preferredIdentifiers(model),
): PreferredIdentifyingBinary | undefined {
  const at = identifiers.byEntity.get(entity.id);
  if (!at) return undefined;
  const binary = entityValueRoles(model, at.factType);
  if (!binary || binary.entityRole.playerId !== entity.id) return undefined;
  const valuePlayer = model.getObjectType(binary.valueRole.playerId);
  if (valuePlayer?.kind !== "value") return undefined;
  return { factType: at.factType, entityRole: binary.entityRole, valuePlayer };
}

/**
 * Every way an object type acquires an identity.
 *
 * Three kinds, and a model may declare more than one. A preferred
 * internal uniqueness constraint names the fact type that identifies
 * the entity; objectifying a fact type means being identified by it;
 * and a subtype fact declaring `providesIdentification` means
 * inheriting the supertype's identifier. `identificationGraph` above
 * already walks the last two, because they are the ones that create a
 * settlement dependency -- a preferred uniqueness does not, since a
 * value type has no key of its own to wait for.
 *
 * A reference mode is deliberately NOT a source. It is shorthand for an
 * identifying binary rather than an independent declaration, and the
 * mapper already treats it as the fallback a preferred identifier
 * overrides (`preferredIdentifyingBinary`). Counting it would make every
 * objectified entity that also carries one a conflict -- 25 types in
 * this repository alone, none of them contradictory.
 *
 * A union rather than a count, because the diagnostic that reads this
 * names the kinds and a count cannot. The preferred-uniqueness arm
 * counts the same constraints `completenessWarnings` counts -- any
 * arity, over `factTypesForObjectType` -- so the two rules cannot
 * disagree about how many there are.
 */
export type IdentificationSource =
  | { readonly kind: "preferred-uniqueness"; readonly factTypeId: string; }
  | { readonly kind: "objectification"; readonly factTypeId: string; }
  | { readonly kind: "identifying-subtype"; readonly supertypeId: string; };

/** A label for each kind, for a diagnostic that has to name them. */
export const IDENTIFICATION_SOURCE_LABEL: Record<IdentificationSource["kind"], string> = {
  "preferred-uniqueness": "a preferred uniqueness constraint",
  "objectification": "an objectification",
  "identifying-subtype": "an identifying subtype fact",
};

export function identificationSources(
  model: OrmModel,
  entity: ObjectType,
): readonly IdentificationSource[] {
  const sources: IdentificationSource[] = [];

  for (const ft of model.factTypesForObjectType(entity.id)) {
    for (const c of ft.internalConstraints) {
      if (c.type === "internal_uniqueness" && c.isPreferred) {
        sources.push({ kind: "preferred-uniqueness", factTypeId: ft.id });
      }
    }
  }

  for (const oft of model.objectifiedFactTypes) {
    if (oft.objectTypeId === entity.id) {
      sources.push({ kind: "objectification", factTypeId: oft.factTypeId });
    }
  }

  for (const sf of model.subtypeFacts) {
    if (sf.subtypeId === entity.id && sf.providesIdentification) {
      sources.push({ kind: "identifying-subtype", supertypeId: sf.supertypeId });
    }
  }

  return sources;
}
