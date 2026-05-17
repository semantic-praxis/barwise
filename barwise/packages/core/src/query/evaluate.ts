/**
 * Symbolic model query API: deterministic evaluator.
 *
 * `queryModel` answers a {@link ModelQuery} purely from an in-memory
 * `OrmModel` -- no I/O, no LLM. Element lookups by name are
 * case-insensitive. A well-formed query against a missing element
 * returns a `not-found` result rather than throwing.
 */

import type { Constraint } from "../model/Constraint.js";
import type { FactType } from "../model/FactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { expandReading } from "../model/ReadingOrder.js";
import type { Role } from "../model/Role.js";
import { Verbalizer } from "../verbalization/Verbalizer.js";
import type {
  ConstraintRef,
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
  const ctx = new QueryContext(model);

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

  constructor(private readonly model: OrmModel) {}

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
      ...(ot.referenceMode !== undefined ? { referenceMode: ot.referenceMode } : {}),
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

  private constraintRef(c: Constraint, ft: FactType, index: number): ConstraintRef {
    return {
      id: c.id ?? `${ft.id}-constraint-${index}`,
      constraintType: c.type,
      verbalization: this.verbalizer.constraints.verbalize(c, ft, this.model).text,
      factType: ft.name,
      factTypeId: ft.id,
    };
  }

  private roleRef(role: Role, ft: FactType): RoleRef {
    const player = this.model.getObjectType(role.playerId);
    return {
      id: role.id,
      name: role.name,
      player: player?.name ?? role.playerId,
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
    const keyword = constraintType !== undefined
      ? normalizeConstraintKeyword(constraintType)
      : undefined;
    const constraints: ConstraintRef[] = [];
    for (const ft of this.model.factTypes) {
      ft.constraints.forEach((c, i) => {
        if (keyword === undefined || matchesConstraintType(c.type, keyword)) {
          constraints.push(this.constraintRef(c, ft, i));
        }
      });
    }
    return { kind: "constraints", constraints };
  }

  entityDetail(name: string): QueryResult {
    const entity = this.findEntity(name);
    if (!entity) return notFoundEntity(name);

    const factTypes = this.model.factTypesForObjectType(entity.id);
    const roles: RoleRef[] = [];
    const constraints: ConstraintRef[] = [];
    for (const ft of factTypes) {
      for (const role of ft.rolesForPlayer(entity.id)) {
        roles.push(this.roleRef(role, ft));
      }
      ft.constraints.forEach((c, i) => {
        constraints.push(this.constraintRef(c, ft, i));
      });
    }

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

    const playerNames = ft.roles.map((r) => {
      const ot = this.model.getObjectType(r.playerId);
      return ot?.name ?? r.playerId;
    });

    return {
      kind: "fact-type-detail",
      detail: {
        factType: this.factTypeRef(ft),
        roles: ft.roles.map((r) => this.roleRef(r, ft)),
        readings: ft.readings.map((r) => expandReading(r.template, playerNames)),
        constraints: ft.constraints.map((c, i) => this.constraintRef(c, ft, i)),
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
      return {
        kind: "constraints",
        constraints: ft.constraints.map((c, i) => this.constraintRef(c, ft, i)),
      };
    }

    const entity = this.findEntity(name);
    if (entity) {
      const constraints: ConstraintRef[] = [];
      for (const factType of this.model.factTypesForObjectType(entity.id)) {
        factType.constraints.forEach((c, i) => {
          constraints.push(this.constraintRef(c, factType, i));
        });
      }
      return { kind: "constraints", constraints };
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
      for (const c of ft.constraints) {
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
      for (const ft of this.model.factTypesForObjectType(currentId)) {
        for (const role of ft.roles) {
          const neighborId = role.playerId;
          if (visited.has(neighborId)) continue;
          visited.add(neighborId);
          predecessor.set(neighborId, { prevId: currentId, factType: ft });
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

  stats(): QueryResult {
    const entityTypes = this.model.objectTypes.filter((ot) => ot.kind === "entity").length;
    const valueTypes = this.model.objectTypes.filter((ot) => ot.kind === "value").length;
    const constraints = this.model.factTypes.reduce(
      (sum, ft) => sum + ft.constraints.length,
      0,
    );
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

/** Normalize a user-supplied constraint keyword (lowercase, hyphen/space to underscore). */
function normalizeConstraintKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Match a constraint type against a normalized keyword. The keyword
 * matches if it equals the type or is a substring of it, so "uniqueness"
 * matches both "internal_uniqueness" and "external_uniqueness".
 */
function matchesConstraintType(constraintType: string, normalizedKeyword: string): boolean {
  return constraintType === normalizedKeyword
    || constraintType.includes(normalizedKeyword);
}
