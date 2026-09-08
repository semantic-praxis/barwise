import type { OrmModel } from "./OrmModel.js";

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
