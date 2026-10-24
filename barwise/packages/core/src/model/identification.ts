import { inferExternalUniquenessJoin } from "../externalUniqueness.js";
import {
  type ExternalUniquenessConstraint,
  type InternalUniquenessConstraint,
  isExternalUniqueness,
  isInternalUniqueness,
} from "./Constraint.js";
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
  readonly valueRole: Role;
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
export function identificationGraph(
  model: OrmModel,
  identifiers: PreferredIdentifiers = preferredIdentifiers(model),
): Map<string, readonly string[]> {
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

  // An entity identified by an external uniqueness takes its key from the
  // far roles' players, so an entity among them settles first
  // (external-preferred-identifier.spec.md).
  for (const [entityId, at] of identifiers.byEntity) {
    if (at.kind !== "external") continue;
    for (const { farRole } of at.components) {
      if (model.getObjectType(farRole.playerId)?.kind === "entity") add(entityId, farRole.playerId);
    }
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
  identifiers?: PreferredIdentifiers,
): { readonly order: readonly string[]; } | { readonly cycle: readonly string[]; } {
  const edges = identificationGraph(model, identifiers);
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
  /** The one identifying uniqueness of each entity that has one. */
  readonly byEntity: ReadonlyMap<string, IdentifyingUniqueness>;
  /** The inverse of `byEntity`, keyed by constraint id. */
  readonly byConstraint: ReadonlyMap<string, IdentifyingUniqueness>;
}

/**
 * The uniqueness constraint that identifies an entity type, and where it
 * is: an internal one in one fact type, or an external one over the far
 * roles of several binaries the entity plays in
 * (external-preferred-identifier.spec.md). A union, so each reader decides
 * the external case where it compiles rather than reading a fact type
 * that is not there.
 */
export type IdentifyingUniqueness =
  | {
    readonly kind: "internal";
    readonly entityId: string;
    readonly constraint: InternalUniquenessConstraint;
    readonly factType: FactType;
  }
  | {
    readonly kind: "external";
    readonly entityId: string;
    readonly constraint: ExternalUniquenessConstraint;
    /** One per role of the constraint, in its role order. */
    readonly components: readonly IdentifyingComponent[];
  };

/** The internal arm: what a 2.0 flag, and so `PlacedFlags`, can name. */
export type InternalIdentifyingUniqueness = Extract<IdentifyingUniqueness, { kind: "internal"; }>;

/** One binary of an external reference scheme. */
export interface IdentifyingComponent {
  readonly factType: FactType;
  /** The role the identified entity plays, unique on its own. */
  readonly nearRole: Role;
  /** The constraint's role: what identifies the entity. */
  readonly farRole: Role;
}

/** The fact types an identifier spends: its one, or one per component. */
export function identifyingFactTypes(at: IdentifyingUniqueness): readonly FactType[] {
  return at.kind === "internal" ? [at.factType] : at.components.map((c) => c.factType);
}

/**
 * Which uniqueness identifies which entity type: one answer for every
 * reader (orm-format-3, Open decision 3 and WS4b-ii).
 *
 * Each entity names its preferred identifier by constraint id, stored on
 * the model (`OrmModel.preferredIdentifierOf`). A reference counts only
 * when the constraint identifies that entity -- an internal uniqueness by
 * `identifiedBy`'s rule, an external one by `externalIdentifies`'s; one
 * that does not is ignored here and
 * reported by `completeness/preferred-identifier-invalid`, so no reader
 * keys a table on a constraint that identifies something else.
 *
 * `byConstraint` is the inverse, for readers that ask about a fact type
 * or a constraint rather than an entity: calling a per-entity lookup
 * inside a loop over fact types would make each of them quadratic.
 */
export function preferredIdentifiers(model: OrmModel): PreferredIdentifiers {
  const byEntity = new Map<string, IdentifyingUniqueness>();
  for (const [entityId] of model.preferredIdentifierRefs) {
    const resolved = resolvePreferredIdentifier(model, entityId);
    if (resolved.ok) byEntity.set(entityId, resolved.at);
  }
  const byConstraint = new Map<string, IdentifyingUniqueness>();
  for (const at of byEntity.values()) {
    if (at.constraint.id !== undefined) byConstraint.set(at.constraint.id, at);
  }
  return { byEntity, byConstraint };
}

/** Why an entity's stored reference identifies nothing, when it does not. */
export type PreferredIdentifierResolution =
  | { readonly ok: true; readonly at: IdentifyingUniqueness; }
  | {
    readonly ok: false;
    readonly reason: PreferredIdentifierFailure;
    /** For `external-other-entity`: the object the constraint does identify. */
    readonly identifies?: string;
  };

/**
 * Why a stored reference identifies nothing. The `external-` reasons are
 * the shape rules of external-preferred-identifier.spec.md, one each, so
 * validation can say which failed.
 */
export type PreferredIdentifierFailure =
  | "none"
  | "dangling"
  | "not-uniqueness"
  | "not-this-entity"
  | "external-no-common-object"
  | "external-other-entity"
  | "external-not-binary"
  | "external-near-not-unique";

/**
 * An entity's stored preferred identifier, checked: the constraint exists,
 * is a uniqueness, and identifies this entity. The one check
 * `preferredIdentifiers` and validation share, so a reference validation
 * accepts is the one every reader uses.
 */
export function resolvePreferredIdentifier(
  model: OrmModel,
  entityId: string,
): PreferredIdentifierResolution {
  const constraintId = model.preferredIdentifierOf(entityId);
  if (constraintId === undefined) return { ok: false, reason: "none" };
  const inView = model.getConstraintInView(constraintId);
  if (!inView) return { ok: false, reason: "dangling" };
  const [c, factType] = inView;
  if (isExternalUniqueness(c)) return externalIdentifies(model, c, entityId);
  if (!factType || !isInternalUniqueness(c)) return { ok: false, reason: "not-uniqueness" };
  const placed = identifiedBy(model, factType, c);
  return placed?.at.entityId === entityId && placed.at.constraint === c
    ? { ok: true, at: placed.at }
    : { ok: false, reason: "not-this-entity" };
}

/**
 * Whether an external uniqueness identifies `entityId`: ORM's reference
 * scheme shape (external-preferred-identifier.spec.md).
 * `inferExternalUniquenessJoin` finds the object the constraint joins on
 * -- two roles or more, one per fact type, a common object playing one
 * other role in each and none of the constraint's own -- and is the answer
 * population validation and the counterexample generator already use, so
 * the object they join on and the one the mapper keys cannot differ. An
 * identifier needs two things more than a join: each fact type a binary,
 * and each near role unique on its own, so each entity has one of each
 * component. Alethically unique: a deontic uniqueness says each entity
 * ought to have one, which does not make a column single-valued.
 */
export function externalIdentifies(
  model: OrmModel,
  c: ExternalUniquenessConstraint,
  entityId: string,
): PreferredIdentifierResolution {
  const join = inferExternalUniquenessJoin(c.roleIds, model);
  if (!join) return { ok: false, reason: "external-no-common-object" };
  if (join.commonObjectId !== entityId) {
    return { ok: false, reason: "external-other-entity", identifies: join.commonObjectId };
  }
  const components: IdentifyingComponent[] = [];
  for (const factType of join.factTypes) {
    if (factType.arity !== 2) return { ok: false, reason: "external-not-binary" };
    const nearRole = factType.getRoleById(join.keyRoleByFactType.get(factType.id)!)!;
    const farRole = factType.getRoleById(join.constrainedRoleByFactType.get(factType.id)!)!;
    const unique = factType.internalConstraints.some((u) =>
      isInternalUniqueness(u) && u.roleIds.length === 1 && u.roleIds[0] === nearRole.id
      && (u.modality ?? "alethic") === "alethic"
    );
    if (!unique) return { ok: false, reason: "external-near-not-unique" };
    components.push({ factType, nearRole, farRole });
  }
  return { ok: true, at: { kind: "external", entityId, constraint: c, components } };
}

/**
 * Where a 2.0 `is_preferred` flag points: the entity it names and the
 * uniqueness that identifies it, read the way ORM and NORMA's
 * `PreferredIdentifier` mean it, as naming the entity the roles opposite
 * the uniqueness identify (orm-format-3, Open decision 8):
 *
 * - a flagged uniqueness on an objectified fact type that spans every
 *   role, or, as NORMA allows, all but one, identifies the objectifying
 *   type (decision 8 named only the spanning case; the auction models'
 *   objectified ternaries are identified by a two-role uniqueness);
 * - a flagged uniqueness on either role of a binary between one entity
 *   and one value type identifies the entity, by the uniqueness on the
 *   value's role (and is dropped when there is none);
 * - otherwise, a flagged uniqueness that leaves exactly one role
 *   uncovered identifies that role's player, when it is an entity type
 *   that plays none of the covered roles (a ring binary does not identify
 *   its player by itself, and two uncovered roles identify nothing);
 * - anything else identifies nothing.
 *
 * `rank` orders two flags naming one entity: the entity-value binary
 * first (Open decision 11), so an objectified type with its own reference
 * scheme keeps the key the mapper gives it.
 *
 * It is also what a stored reference must satisfy: the reference names a
 * constraint, and this says whom that constraint identifies.
 */
function identifiedBy(
  model: OrmModel,
  factType: FactType,
  c: InternalUniquenessConstraint,
): { readonly at: InternalIdentifyingUniqueness; readonly rank: number; } | undefined {
  const isEntity = (id: string) => model.getObjectType(id)?.kind === "entity";
  const covered = new Set(c.roleIds);

  const objectType = model.objectificationOf(factType.id)?.objectTypeId;
  if (objectType && covered.size >= factType.roles.length - 1) {
    return isEntity(objectType)
      ? { at: { kind: "internal", entityId: objectType, constraint: c, factType }, rank: 1 }
      : undefined;
  }

  const binary = entityValueRoles(model, factType);
  if (binary) {
    // The flagged one itself when it is on the value's role, so a second
    // uniqueness there does not take its place.
    const onValueRole = (u: InternalUniquenessConstraint) =>
      u.roleIds.length === 1 && u.roleIds[0] === binary.valueRole.id;
    const onValue = onValueRole(c) ? c : factType.internalConstraints.find(
      (u): u is InternalUniquenessConstraint => isInternalUniqueness(u) && onValueRole(u),
    );
    return onValue
      ? {
        at: {
          kind: "internal",
          entityId: binary.entityRole.playerId,
          constraint: onValue,
          factType,
        },
        rank: 0,
      }
      : undefined;
  }

  const uncovered = factType.roles.filter((r) => !covered.has(r.id));
  const only = uncovered.length === 1 ? uncovered[0]!.playerId : undefined;
  const playsCovered = factType.roles.some((r) => covered.has(r.id) && r.playerId === only);
  return only !== undefined && isEntity(only) && !playsCovered
    ? { at: { kind: "internal", entityId: only, constraint: c, factType }, rank: 1 }
    : undefined;
}

/** What `placePreferredFlags` makes of a model's 2.0 flags. */
export interface PlacedFlags {
  /** The identifier each named entity gets, after the tie-break. */
  readonly byEntity: ReadonlyMap<string, InternalIdentifyingUniqueness>;
  /**
   * Every flag that names each entity, before the tie-break, in model
   * order: two or more is the 2.0 modelling error of an entity with two
   * identifiers, which the stored reference cannot express.
   */
  readonly candidates: ReadonlyMap<string, readonly InternalIdentifyingUniqueness[]>;
  /** Flagged uniquenesses that identify no entity, in model order. */
  readonly dropped: readonly InternalUniquenessConstraint[];
}

/**
 * Place a model's `is_preferred` flags (`identifiedBy`), for the writers
 * that still read them: the 2.0 loader and the llm parser, whose
 * extraction format keeps the flag. Two flags naming one entity resolve to
 * the lower rank, then the first in model order; the rest stay in
 * `candidates` so a caller can say so.
 */
export function placePreferredFlags(
  model: OrmModel,
  isFlagged: (c: InternalUniquenessConstraint) => boolean,
): PlacedFlags {
  const chosen = new Map<
    string,
    { readonly at: InternalIdentifyingUniqueness; readonly rank: number; }
  >();
  const candidates = new Map<string, InternalIdentifyingUniqueness[]>();
  const dropped: InternalUniquenessConstraint[] = [];
  for (const factType of model.factTypes) {
    for (const c of factType.internalConstraints) {
      if (!isInternalUniqueness(c) || !isFlagged(c)) continue;
      const placed = identifiedBy(model, factType, c);
      if (!placed) {
        dropped.push(c);
        continue;
      }
      const { at, rank } = placed;
      const held = chosen.get(at.entityId);
      if (!held || rank < held.rank) chosen.set(at.entityId, { at, rank });
      // One constraint is one candidate, however many flags reach it: an
      // entity-value binary flagged on both roles names its value role's
      // uniqueness twice.
      const list = candidates.get(at.entityId);
      if (!list) candidates.set(at.entityId, [at]);
      else if (!list.some((h) => h.constraint === at.constraint)) list.push(at);
    }
  }
  return {
    byEntity: new Map([...chosen].map(([id, { at }]) => [id, at])),
    candidates,
    dropped,
  };
}

/**
 * Store what a model's flags place as each entity's preferred identifier,
 * returning the placement for a caller that reports what it dropped.
 */
export function storePreferredFlags(
  model: OrmModel,
  isFlagged: (c: InternalUniquenessConstraint) => boolean,
): PlacedFlags {
  const placed = placePreferredFlags(model, isFlagged);
  for (const [entityId, at] of placed.byEntity) {
    if (at.constraint.id !== undefined) model.setPreferredIdentifier(entityId, at.constraint.id);
  }
  return placed;
}

/**
 * Whether an entity type has an identifier at all: an identifying
 * uniqueness (`preferredIdentifiers`), an objectification, or an
 * identifying subtype fact whose supertype is itself identified. The one
 * answer validation, the query anchors, the annotator and NORMA export
 * read, so none of them calls an entity unidentified that another calls
 * identified (orm-format-3 WS4a).
 *
 * The subtype arm recurses because inheriting from an unidentified
 * supertype identifies nothing; a subtype cycle answers false, and
 * `structural/subtype-cycle` reports it.
 */
export function isIdentified(
  model: OrmModel,
  entityId: string,
  identifiers: PreferredIdentifiers = preferredIdentifiers(model),
): boolean {
  const { objectifying, supertypesOf } = otherSources(model, identifiers);
  const walk = (id: string, seen: Set<string>): boolean => {
    if (seen.has(id)) return false;
    seen.add(id);
    if (identifiers.byEntity.has(id) || objectifying.has(id)) return true;
    return (supertypesOf.get(id) ?? []).some((sup) => walk(sup, seen));
  };
  return walk(entityId, new Set());
}

/**
 * The objectifying and identifying-subtype sources, indexed once per
 * `preferredIdentifiers` result, so a reader asking `isIdentified` for
 * every entity reads the model once rather than once per entity.
 */
const otherSourcesCache = new WeakMap<PreferredIdentifiers, {
  readonly objectifying: ReadonlySet<string>;
  readonly supertypesOf: ReadonlyMap<string, readonly string[]>;
}>();
function otherSources(model: OrmModel, identifiers: PreferredIdentifiers) {
  const held = otherSourcesCache.get(identifiers);
  if (held) return held;
  const supertypesOf = new Map<string, string[]>();
  for (const sf of model.subtypeFacts) {
    if (!sf.providesIdentification) continue;
    const list = supertypesOf.get(sf.subtypeId);
    if (list) list.push(sf.supertypeId);
    else supertypesOf.set(sf.subtypeId, [sf.supertypeId]);
  }
  const built = {
    objectifying: new Set(model.objectifiedFactTypes.map((oft) => oft.objectTypeId)),
    supertypesOf,
  };
  otherSourcesCache.set(identifiers, built);
  return built;
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
  if (at?.kind !== "internal") return undefined;
  const binary = entityValueRoles(model, at.factType);
  if (!binary || binary.entityRole.playerId !== entity.id) return undefined;
  const valuePlayer = model.getObjectType(binary.valueRole.playerId);
  if (valuePlayer?.kind !== "value") return undefined;
  return {
    factType: at.factType,
    entityRole: binary.entityRole,
    valueRole: binary.valueRole,
    valuePlayer,
  };
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
 * names the kinds and a count cannot. The preferred-uniqueness arm names
 * the constraint, which is one id whether it is internal or external. It is the
 * entity's stored reference when it identifies the entity
 * (`preferredIdentifiers`); an entity names one at most, so two of that
 * kind cannot arise (orm-format-3 WS4b-ii).
 */
export type IdentificationSource =
  | { readonly kind: "preferred-uniqueness"; readonly constraintId: string; }
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
  identifiers: PreferredIdentifiers = preferredIdentifiers(model),
): readonly IdentificationSource[] {
  const sources: IdentificationSource[] = [];

  const at = identifiers.byEntity.get(entity.id);
  // A resolved identifier was looked up by its id, so it has one.
  if (at) sources.push({ kind: "preferred-uniqueness", constraintId: at.constraint.id! });

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
