import type { Complete } from "../util/complete.js";

/**
 * Configuration for creating a new ObjectifiedFactType.
 */
export interface ObjectifiedFactTypeConfig {
  /** Optional stable identifier. In a model, its minted name if omitted; standalone, generated. */
  readonly id?: string;
  /** The id of the fact type being objectified. */
  readonly factTypeId: string;
  /** The id of the entity type created by objectification. */
  readonly objectTypeId: string;
}

/**
 * An ObjectifiedFactType declares that a fact type is simultaneously
 * treated as an entity type (also known as "nesting" in ORM 2).
 *
 * The objectified entity type can then participate in other fact types
 * as a role player, just like any other entity type. Its instances are
 * the tuples of the underlying fact type.
 *
 * Example: The fact type "Person marries Person" can be objectified as
 * the entity type "Marriage", which can then participate in fact types
 * like "Marriage has Date" or "Marriage is registered at Location".
 *
 * In relational mapping, the objectified entity typically maps to a
 * table whose primary key is the composite of the underlying fact
 * type's role columns, unless the entity has its own reference mode.
 */
export class ObjectifiedFactType {
  /** Its id, or none: see `SubtypeFact.id` (iri-identity, decision 19). */
  readonly id: string | undefined;
  readonly factTypeId: string;
  readonly objectTypeId: string;

  constructor(config: ObjectifiedFactTypeConfig) {
    this.id = config.id;
    this.factTypeId = config.factTypeId;
    this.objectTypeId = config.objectTypeId;

    if (config.factTypeId === config.objectTypeId) {
      throw new Error(
        "An objectified fact type cannot reference the same id for both the fact type and the object type.",
      );
    }
  }
}

/** See `subtypeFactRef`: the same reference, one kind over. */
export function objectificationRef(
  oft: {
    readonly id: string | undefined;
    readonly factTypeId: string;
    readonly objectTypeId: string;
  },
): string {
  return oft.id ?? `unnamed:${oft.objectTypeId}=${oft.factTypeId}`;
}

/** See {@link toSubtypeFactConfig}: the same projection, one kind over. */
export function toObjectifiedFactTypeConfig(
  oft: ObjectifiedFactType,
): ObjectifiedFactTypeConfig {
  const config: Complete<ObjectifiedFactTypeConfig> = {
    id: oft.id,
    factTypeId: oft.factTypeId,
    objectTypeId: oft.objectTypeId,
  };
  return config;
}
