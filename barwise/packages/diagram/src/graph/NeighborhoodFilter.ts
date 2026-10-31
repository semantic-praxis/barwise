import type { OrmModel } from "@barwise/core";
import { subtypeFactRef } from "@barwise/core";

/**
 * The set of element IDs in an N-hop neighborhood around a focus entity.
 */
export interface Neighborhood {
  readonly objectTypeIds: ReadonlySet<string>;
  readonly factTypeIds: ReadonlySet<string>;
  readonly subtypeFactIds: ReadonlySet<string>;
}

/**
 * Compute the N-hop neighborhood around a focus entity type.
 *
 * A "hop" is one step through a fact type or subtype relationship.
 * Two entities are 1 hop apart if they share a fact type or have a
 * direct subtype relationship.
 *
 * @param model - The ORM model to traverse.
 * @param focusId - The object type ID to center the neighborhood on.
 * @param hops - Number of hops (1, 2, 3, ...). Pass Infinity for all.
 * @returns The IDs of all elements within the neighborhood.
 */
export function computeNeighborhood(
  model: OrmModel,
  focusId: string,
  hops: number,
): Neighborhood {
  const objectTypeIds = new Set<string>();
  const factTypeIds = new Set<string>();
  const subtypeFactIds = new Set<string>();

  // BFS frontier: start with the focus entity.
  let frontier = new Set<string>([focusId]);
  objectTypeIds.add(focusId);

  for (let hop = 0; hop < hops && frontier.size > 0; hop++) {
    const nextFrontier = new Set<string>();

    for (const otId of frontier) {
      // Traverse fact types: find all fact types this entity participates in,
      // then include all other players of those fact types.
      for (const ft of model.factTypesForObjectType(otId)) {
        factTypeIds.add(ft.id);
        for (const role of ft.roles) {
          if (!objectTypeIds.has(role.playerId)) {
            objectTypeIds.add(role.playerId);
            nextFrontier.add(role.playerId);
          }
        }
      }

      // Traverse subtype relationships in both directions.
      for (const sf of model.subtypeFacts) {
        if (sf.subtypeId === otId) {
          subtypeFactIds.add(subtypeFactRef(sf));
          if (!objectTypeIds.has(sf.supertypeId)) {
            objectTypeIds.add(sf.supertypeId);
            nextFrontier.add(sf.supertypeId);
          }
        }
        if (sf.supertypeId === otId) {
          subtypeFactIds.add(subtypeFactRef(sf));
          if (!objectTypeIds.has(sf.subtypeId)) {
            objectTypeIds.add(sf.subtypeId);
            nextFrontier.add(sf.subtypeId);
          }
        }
      }
    }

    frontier = nextFrontier;
  }

  return { objectTypeIds, factTypeIds, subtypeFactIds };
}
