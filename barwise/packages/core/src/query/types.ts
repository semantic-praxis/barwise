/**
 * Symbolic model query API: types.
 *
 * A `ModelQuery` is a formal, serializable representation of a question
 * about an ORM model. `queryModel` evaluates it deterministically and
 * returns a `QueryResult`. The `query/parse.ts` module provides a text
 * DSL front-end that produces `ModelQuery` values.
 */

/**
 * A formal query over an ORM model. Discriminated by `kind`.
 *
 * Every query is answered purely from the model -- no I/O, no LLM, fully
 * deterministic.
 */
export type ModelQuery =
  | { readonly kind: "list-entities"; readonly entityKind?: "entity" | "value"; }
  | { readonly kind: "list-fact-types"; readonly arity?: number; }
  | { readonly kind: "list-constraints"; readonly constraintType?: string; }
  | { readonly kind: "entity"; readonly name: string; }
  | { readonly kind: "fact-type"; readonly name: string; }
  | { readonly kind: "fact-types-of"; readonly entity: string; }
  | { readonly kind: "related-entities"; readonly entity: string; }
  | { readonly kind: "constraints-of"; readonly name: string; }
  | { readonly kind: "subtypes-of"; readonly entity: string; readonly transitive: boolean; }
  | { readonly kind: "supertypes-of"; readonly entity: string; readonly transitive: boolean; }
  | { readonly kind: "mandatory-roles"; readonly entity?: string; }
  | { readonly kind: "path"; readonly from: string; readonly to: string; }
  | { readonly kind: "model-stats"; };

/** The `kind` discriminant of a {@link ModelQuery}. */
export type ModelQueryKind = ModelQuery["kind"];

/** A lightweight reference to an object type. */
export interface EntityRef {
  readonly id: string;
  readonly name: string;
  /** "entity" (identified by a reference mode) or "value" (self-identifying). */
  readonly entityKind: "entity" | "value";
  readonly definition?: string;
  readonly referenceMode?: string;
}

/** A lightweight reference to a fact type. */
export interface FactTypeRef {
  readonly id: string;
  readonly name: string;
  /** Number of roles. */
  readonly arity: number;
  /** Primary natural-language reading. */
  readonly reading: string;
}

/** A lightweight reference to a constraint. */
export interface ConstraintRef {
  readonly id: string;
  /** The metamodel constraint type (e.g. "internal_uniqueness"). */
  readonly constraintType: string;
  /** FORML verbalization of the constraint. */
  readonly verbalization: string;
  /** Name of the fact type the constraint is attached to. */
  readonly factType: string;
  /** Id of the fact type the constraint is attached to. */
  readonly factTypeId: string;
}

/** A lightweight reference to a role within a fact type. */
export interface RoleRef {
  readonly id: string;
  readonly name: string;
  /** Name of the object type playing this role. */
  readonly player: string;
  /** Name of the fact type this role belongs to. */
  readonly factType: string;
  /** Id of the fact type this role belongs to. */
  readonly factTypeId: string;
}

/** Full detail for a single entity. */
export interface EntityDetail {
  readonly entity: EntityRef;
  /** Fact types the entity participates in. */
  readonly factTypes: readonly FactTypeRef[];
  /** Roles played by the entity. */
  readonly roles: readonly RoleRef[];
  /** Constraints on fact types the entity participates in. */
  readonly constraints: readonly ConstraintRef[];
  /** Direct subtypes of the entity. */
  readonly subtypes: readonly EntityRef[];
  /** Direct supertypes of the entity. */
  readonly supertypes: readonly EntityRef[];
}

/** Full detail for a single fact type. */
export interface FactTypeDetail {
  readonly factType: FactTypeRef;
  readonly roles: readonly RoleRef[];
  /** All reading templates, expanded with role player names. */
  readonly readings: readonly string[];
  readonly constraints: readonly ConstraintRef[];
  /** True if the fact type is objectified as an entity type. */
  readonly objectified: boolean;
}

/** A single hop in a {@link QueryResult} path result. */
export interface PathStep {
  /** The fact type connecting the two entities. */
  readonly factType: FactTypeRef;
  /** Name of the entity at the start of this hop. */
  readonly from: string;
  /** Name of the entity at the end of this hop. */
  readonly to: string;
}

/** Element counts for a model. */
export interface ModelStats {
  readonly modelName: string;
  readonly domainContext?: string;
  readonly entityTypes: number;
  readonly valueTypes: number;
  readonly factTypes: number;
  readonly constraints: number;
  readonly subtypeRelationships: number;
  readonly objectifiedFactTypes: number;
  readonly populations: number;
}

/**
 * The deterministic result of evaluating a {@link ModelQuery}.
 * Discriminated by `kind`.
 *
 * `not-found` is returned when a well-formed query references an element
 * (entity, fact type) that does not exist in the model.
 */
export type QueryResult =
  | { readonly kind: "entities"; readonly entities: readonly EntityRef[]; }
  | { readonly kind: "fact-types"; readonly factTypes: readonly FactTypeRef[]; }
  | { readonly kind: "constraints"; readonly constraints: readonly ConstraintRef[]; }
  | { readonly kind: "roles"; readonly roles: readonly RoleRef[]; }
  | { readonly kind: "entity-detail"; readonly detail: EntityDetail; }
  | { readonly kind: "fact-type-detail"; readonly detail: FactTypeDetail; }
  | {
    readonly kind: "path";
    readonly from: string;
    readonly to: string;
    readonly found: boolean;
    readonly steps: readonly PathStep[];
  }
  | { readonly kind: "stats"; readonly stats: ModelStats; }
  | { readonly kind: "not-found"; readonly message: string; };

/**
 * Thrown by `parseQuery` when a query string is malformed (unknown
 * command, missing argument, unbalanced quotes). A well-formed query
 * against a missing element does NOT throw -- it returns a `not-found`
 * result.
 */
export class QueryParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryParseError";
  }
}
