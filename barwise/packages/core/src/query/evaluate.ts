/**
 * Symbolic model query API: deterministic evaluator.
 *
 * `queryModel` answers a {@link ModelQuery} purely from an in-memory
 * `OrmModel` -- no I/O, no LLM. Element lookups by name are
 * case-insensitive. A well-formed query against a missing element
 * returns a `not-found` result rather than throwing.
 */

import { type Constraint, isInternalUniqueness, isMandatoryRole } from "../model/Constraint.js";
import { matchesConstraintType } from "../model/constraintKeyword.js";
import type { FactType } from "../model/FactType.js";
import { type ModelGraph, requireGraph } from "../model/graph.js";
import { type ObjectType, referenceModeOf } from "../model/ObjectType.js";
import type { ConstraintInView, OrmModel } from "../model/OrmModel.js";
import { expandReading } from "../model/ReadingOrder.js";
import type { Role } from "../model/Role.js";
import type { Verbalization } from "../verbalization/Verbalization.js";
import { Verbalizer } from "../verbalization/Verbalizer.js";
import type {
  ConstraintRef,
  EntityAnchors,
  EntityRef,
  FactTypeRef,
  ModelQuery,
  ModelStats,
  PathStep,
  QueryResult,
  RoleRef,
} from "./types.js";

/**
 * Evaluate a {@link ModelQuery} against an ORM model.
 *
 * @param model - The ORM model to query.
 * @param query - The formal query.
 * @returns A deterministic {@link QueryResult}.
 */
export function queryModel(model: OrmModel, query: ModelQuery): QueryResult {
  const ctx = new QueryContext(model, requireGraph(model));

  switch (query.kind) {
    case "list-entities":
      return ctx.listEntities(query.entityKind);
    case "list-fact-types":
      return ctx.listFactTypes(query.arity);
    case "list-constraints":
      return ctx.listConstraints(query.constraintType);
    case "entity":
      return ctx.entityDetail(query.name);
    case "fact-type":
      return ctx.factTypeDetail(query.name);
    case "fact-types-of":
      return ctx.factTypesOf(query.entity);
    case "related-entities":
      return ctx.relatedEntities(query.entity);
    case "constraints-of":
      return ctx.constraintsOf(query.name);
    case "subtypes-of":
      return ctx.subtypesOf(query.entity, query.transitive);
    case "supertypes-of":
      return ctx.supertypesOf(query.entity, query.transitive);
    case "mandatory-roles":
      return ctx.mandatoryRoles(query.entity);
    case "path":
      return ctx.path(query.from, query.to);
    case "anchors":
      return ctx.anchors(query.entity);
    case "model-stats":
      return ctx.stats();
  }
}

/**
 * Holds per-query state (the model and a shared verbalizer) and
 * implements each query kind.
 */
class QueryContext {
  private readonly verbalizer = new Verbalizer();

  constructor(
    private readonly model: OrmModel,
    private readonly graph: ModelGraph,
  ) {}

  // ---- Element resolution ------------------------------------------------

  private findEntity(name: string): ObjectType | undefined {
    const lower = name.toLowerCase();
    return this.model.objectTypes.find((ot) => ot.name.toLowerCase() === lower);
  }

  private findFactType(name: string): FactType | undefined {
    const lower = name.toLowerCase();
    return this.model.factTypes.find((ft) => ft.name.toLowerCase() === lower);
  }

  // ---- Ref builders ------------------------------------------------------

  private entityRef(ot: ObjectType): EntityRef {
    return {
      id: ot.id,
      name: ot.name,
      entityKind: ot.kind,
      ...(ot.definition !== undefined ? { definition: ot.definition } : {}),
      ...(referenceModeOf(ot) !== undefined ? { referenceMode: referenceModeOf(ot) } : {}),
    };
  }

  private factTypeRef(ft: FactType): FactTypeRef {
    return {
      id: ft.id,
      name: ft.name,
      arity: ft.roles.length,
      reading: this.verbalizer.factTypes.verbalizePrimary(ft, this.model).text,
    };
  }

  /**
   * A constraint as a query reports it. The id and the fact types come from
   * its verbalization row, which already answers both for every kind (the
   * constraint's own id; the fact types it applies to), so query and
   * verbalize cannot disagree. An internal constraint is verbalized in the
   * fact type it lives in; one across fact types has none.
   */
  private constraintRef([c, ft]: ConstraintInView): ConstraintRef {
    const row = ft === undefined
      ? this.verbalizer.constraints.verbalizeExternal(c, this.model)
      : this.verbalizer.constraints.verbalize(c, ft, this.model);
    return this.refFromRow(c, row);
  }

  private refFromRow(c: Constraint, row: Verbalization): ConstraintRef {
    // Every id here came from [ft.id] or factTypesHolding, so each resolves.
    const factTypeIds = row.factTypeIds ?? [];
    return {
      id: row.sourceElementId,
      constraintType: c.type,
      verbalization: row.text,
      factTypes: factTypeIds.map((id) => this.model.getFactType(id)!.name),
      factTypeIds,
    };
  }

  /** Each constraint touching any of these fact types, once, in order. */
  private refsTouching(factTypes: readonly FactType[]): ConstraintRef[] {
    return this.model.constraintsTouchingAny(factTypes.map((ft) => ft.id))
      .map((inView) => this.constraintRef(inView));
  }

  private roleRef(role: Role, ft: FactType): RoleRef {
    return {
      id: role.id,
      name: role.name,
      player: this.graph.player(role).name,
      factType: ft.name,
      factTypeId: ft.id,
    };
  }

  // ---- Query implementations --------------------------------------------

  listEntities(entityKind?: "entity" | "value"): QueryResult {
    const entities = this.model.objectTypes
      .filter((ot) => entityKind === undefined || ot.kind === entityKind)
      .map((ot) => this.entityRef(ot))
      .sort(byName);
    return { kind: "entities", entities };
  }

  listFactTypes(arity?: number): QueryResult {
    const factTypes = this.model.factTypes
      .filter((ft) => arity === undefined || ft.roles.length === arity)
      .map((ft) => this.factTypeRef(ft))
      .sort(byName);
    return { kind: "fact-types", factTypes };
  }

  listConstraints(constraintType?: string): QueryResult {
    const keyword = constraintType;
    const matches = (c: Constraint) =>
      keyword === undefined || matchesConstraintType(c.type, keyword);
    // The whole model: each fact type's own constraints, then every
    // constraint across fact types once.
    const constraints: ConstraintRef[] = [];
    for (const ft of this.model.factTypes) {
      for (const c of ft.internalConstraints) {
        if (matches(c)) constraints.push(this.constraintRef([c, ft]));
      }
    }
    for (const c of this.model.constraints) {
      if (matches(c)) constraints.push(this.constraintRef([c, undefined]));
    }
    return { kind: "constraints", constraints };
  }

  entityDetail(name: string): QueryResult {
    const entity = this.findEntity(name);
    if (!entity) return notFoundEntity(name);

    const factTypes = this.model.factTypesForObjectType(entity.id);
    const roles: RoleRef[] = [];
    for (const ft of factTypes) {
      for (const role of ft.rolesForPlayer(entity.id)) {
        roles.push(this.roleRef(role, ft));
      }
    }
    const constraints = this.refsTouching(factTypes);

    return {
      kind: "entity-detail",
      detail: {
        entity: this.entityRef(entity),
        factTypes: factTypes.map((ft) => this.factTypeRef(ft)).sort(byName),
        roles,
        constraints,
        subtypes: this.model.subtypesOf(entity.id)
          .map((ot) => this.entityRef(ot)).sort(byName),
        supertypes: this.model.supertypesOf(entity.id)
          .map((ot) => this.entityRef(ot)).sort(byName),
      },
    };
  }

  factTypeDetail(name: string): QueryResult {
    const ft = this.findFactType(name);
    if (!ft) {
      return { kind: "not-found", message: `No fact type named "${name}".` };
    }

    const playerNames = ft.roles.map((r) => this.graph.player(r).name);

    return {
      kind: "fact-type-detail",
      detail: {
        factType: this.factTypeRef(ft),
        roles: ft.roles.map((r) => this.roleRef(r, ft)),
        readings: ft.readings.map((r) => expandReading(r.template, playerNames)),
        constraints: this.refsTouching([ft]),
        objectified: this.model.objectificationOf(ft.id) !== undefined,
      },
    };
  }

  factTypesOf(entityName: string): QueryResult {
    const entity = this.findEntity(entityName);
    if (!entity) return notFoundEntity(entityName);
    const factTypes = this.model.factTypesForObjectType(entity.id)
      .map((ft) => this.factTypeRef(ft))
      .sort(byName);
    return { kind: "fact-types", factTypes };
  }

  relatedEntities(entityName: string): QueryResult {
    const entity = this.findEntity(entityName);
    if (!entity) return notFoundEntity(entityName);

    const seen = new Set<string>([entity.id]);
    const entities: EntityRef[] = [];
    for (const ft of this.model.factTypesForObjectType(entity.id)) {
      for (const role of ft.roles) {
        if (seen.has(role.playerId)) continue;
        seen.add(role.playerId);
        const other = this.model.getObjectType(role.playerId);
        if (other) entities.push(this.entityRef(other));
      }
    }
    return { kind: "entities", entities: entities.sort(byName) };
  }

  constraintsOf(name: string): QueryResult {
    // A name may refer to a fact type or to an entity.
    const ft = this.findFactType(name);
    if (ft) {
      return { kind: "constraints", constraints: this.refsTouching([ft]) };
    }

    const entity = this.findEntity(name);
    if (entity) {
      return {
        kind: "constraints",
        constraints: this.refsTouching(this.model.factTypesForObjectType(entity.id)),
      };
    }

    return {
      kind: "not-found",
      message: `No entity or fact type named "${name}".`,
    };
  }

  subtypesOf(entityName: string, transitive: boolean): QueryResult {
    const entity = this.findEntity(entityName);
    if (!entity) return notFoundEntity(entityName);
    const related = transitive
      ? this.walkHierarchy(entity.id, (id) => this.model.subtypesOf(id))
      : this.model.subtypesOf(entity.id);
    return {
      kind: "entities",
      entities: related.map((ot) => this.entityRef(ot)).sort(byName),
    };
  }

  supertypesOf(entityName: string, transitive: boolean): QueryResult {
    const entity = this.findEntity(entityName);
    if (!entity) return notFoundEntity(entityName);
    const related = transitive
      ? this.walkHierarchy(entity.id, (id) => this.model.supertypesOf(id))
      : this.model.supertypesOf(entity.id);
    return {
      kind: "entities",
      entities: related.map((ot) => this.entityRef(ot)).sort(byName),
    };
  }

  /** Breadth-first walk of the subtype/supertype graph from a start id. */
  private walkHierarchy(
    startId: string,
    step: (id: string) => readonly ObjectType[],
  ): ObjectType[] {
    const visited = new Set<string>([startId]);
    const result: ObjectType[] = [];
    const queue: string[] = [startId];
    while (queue.length > 0) {
      const id = queue.shift()!;
      for (const next of step(id)) {
        if (visited.has(next.id)) continue;
        visited.add(next.id);
        result.push(next);
        queue.push(next.id);
      }
    }
    return result;
  }

  mandatoryRoles(entityName?: string): QueryResult {
    let filterId: string | undefined;
    if (entityName !== undefined) {
      const entity = this.findEntity(entityName);
      if (!entity) return notFoundEntity(entityName);
      filterId = entity.id;
    }

    const roles: RoleRef[] = [];
    for (const ft of this.model.factTypes) {
      for (const c of ft.internalConstraints) {
        if (c.type !== "mandatory") continue;
        const role = ft.getRoleById(c.roleId);
        if (!role) continue;
        if (filterId !== undefined && role.playerId !== filterId) continue;
        roles.push(this.roleRef(role, ft));
      }
    }
    return { kind: "roles", roles };
  }

  path(fromName: string, toName: string): QueryResult {
    const from = this.findEntity(fromName);
    if (!from) return notFoundEntity(fromName);
    const to = this.findEntity(toName);
    if (!to) return notFoundEntity(toName);

    if (from.id === to.id) {
      return { kind: "path", from: from.name, to: to.name, found: true, steps: [] };
    }

    // Breadth-first search over a graph where entities are nodes and an
    // edge exists between two entities that co-participate in a fact type.
    const predecessor = new Map<string, { prevId: string; factType: FactType; }>();
    const visited = new Set<string>([from.id]);
    const queue: string[] = [from.id];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      for (const hop of this.graph.hopsFrom(this.graph.objectType(currentId))) {
        const neighborId = hop.exitRole.playerId;
        if (visited.has(neighborId)) continue;
        visited.add(neighborId);
        predecessor.set(neighborId, { prevId: currentId, factType: hop.factType });
        if (neighborId === to.id) {
          return {
            kind: "path",
            from: from.name,
            to: to.name,
            found: true,
            steps: this.reconstructPath(predecessor, from.id, to.id),
          };
        }
        queue.push(neighborId);
      }
    }

    return { kind: "path", from: from.name, to: to.name, found: false, steps: [] };
  }

  private reconstructPath(
    predecessor: Map<string, { prevId: string; factType: FactType; }>,
    fromId: string,
    toId: string,
  ): PathStep[] {
    const steps: PathStep[] = [];
    let currentId = toId;
    while (currentId !== fromId) {
      const edge = predecessor.get(currentId)!;
      const prev = this.model.getObjectType(edge.prevId);
      const current = this.model.getObjectType(currentId);
      steps.unshift({
        factType: this.factTypeRef(edge.factType),
        from: prev?.name ?? edge.prevId,
        to: current?.name ?? currentId,
      });
      currentId = edge.prevId;
    }
    return steps;
  }

  anchors(entityName?: string): QueryResult {
    let entities: readonly ObjectType[];
    if (entityName !== undefined) {
      const entity = this.findEntity(entityName);
      if (!entity) return notFoundEntity(entityName);
      if (entity.kind !== "entity") {
        return {
          kind: "not-found",
          message: `"${entity.name}" is a value type and has no identification anchor.`,
        };
      }
      entities = [entity];
    } else {
      entities = this.model.objectTypes.filter((ot) => ot.kind === "entity");
    }

    const anchors = entities
      .map((e) => this.entityAnchors(e))
      .sort((a, b) => a.entity.localeCompare(b.entity));
    return { kind: "anchors", anchors };
  }

  /** Compute the identification anchors of a single entity type. */
  private entityAnchors(entity: ObjectType): EntityAnchors {
    let preferredIdentifier: EntityAnchors["preferredIdentifier"];
    const mandatoryFactTypes = new Set<string>();

    for (const ft of this.model.factTypesForObjectType(entity.id)) {
      for (const c of ft.internalConstraints) {
        if (
          preferredIdentifier === undefined
          && isInternalUniqueness(c)
          && c.isPreferred
          && c.roleIds.some((rid) => ft.getRoleById(rid)?.playerId === entity.id)
        ) {
          const identifierTypes = ft.roles
            .filter((r) => r.playerId !== entity.id)
            .map((r) => this.graph.player(r).name);
          preferredIdentifier = { factType: ft.name, identifierTypes };
        }
        if (isMandatoryRole(c) && ft.getRoleById(c.roleId)?.playerId === entity.id) {
          mandatoryFactTypes.add(ft.name);
        }
      }
    }

    const referenceMode = referenceModeOf(entity);
    return {
      entity: entity.name,
      ...(referenceMode !== undefined ? { referenceMode } : {}),
      ...(preferredIdentifier !== undefined ? { preferredIdentifier } : {}),
      mandatoryRoles: [...mandatoryFactTypes].sort(),
      missingIdentifier: preferredIdentifier === undefined,
    };
  }

  stats(): QueryResult {
    const entityTypes = this.model.objectTypes.filter((ot) => ot.kind === "entity").length;
    const valueTypes = this.model.objectTypes.filter((ot) => ot.kind === "value").length;
    // Each fact type's own constraints, plus each constraint across fact
    // types once.
    const internal = this.model.factTypes.reduce(
      (sum, ft) => sum + ft.internalConstraints.length,
      0,
    );
    const constraints = internal + this.model.constraints.length;
    const stats: ModelStats = {
      modelName: this.model.name,
      ...(this.model.domainContext !== undefined
        ? { domainContext: this.model.domainContext }
        : {}),
      entityTypes,
      valueTypes,
      factTypes: this.model.factTypes.length,
      constraints,
      subtypeRelationships: this.model.subtypeFacts.length,
      objectifiedFactTypes: this.model.objectifiedFactTypes.length,
      populations: this.model.populations.length,
    };
    return { kind: "stats", stats };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function byName<T extends { name: string; }>(a: T, b: T): number {
  return a.name.localeCompare(b.name);
}

function notFoundEntity(name: string): QueryResult {
  return { kind: "not-found", message: `No entity named "${name}".` };
}
