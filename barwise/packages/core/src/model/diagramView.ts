/**
 * Which elements a saved diagram view contains -- the one rule shared by
 * every surface that draws a view (`docs/specs/norma-export-view-scope.spec.md`).
 *
 * The VS Code diagram session and the NORMA exporter used to answer this
 * separately, and disagreed: the session read `elements` and added the
 * relations among them, the exporter drew whatever had a saved position.
 * Pure and deterministic, so it lives in core.
 */
import { type DiagramLayout, isScopedView } from "./DiagramLayout.js";
import type { OrmModel } from "./OrmModel.js";

/** The elements a view draws, by id. Fresh sets: the caller owns them. */
export interface ViewMembership {
  readonly objectTypeIds: Set<string>;
  readonly factTypeIds: Set<string>;
  readonly subtypeFactIds: Set<string>;
}

/**
 * Reference-mode patterns a diagram folds into the entity's label: an
 * entity with a reference mode, a binary fact type with a preferred
 * uniqueness, and the value type on its other end are drawn as
 * "Entity (.ref_mode)" -- no value-type box, no fact-type shape. A value
 * type that also plays an ordinary role stays drawn (hiding it would leave
 * that role's edge pointing at nothing); its identifying fact type is still
 * folded. Moved from the diagram panel's ModelToGraph so the NORMA exporter
 * hides the same shapes.
 */
export function absorbedReferenceModes(
  model: OrmModel,
): { valueTypeIds: Set<string>; factTypeIds: Set<string>; } {
  const valueTypeIds = new Set<string>();
  const factTypeIds = new Set<string>();
  for (const ot of model.objectTypes) {
    if (ot.kind !== "entity" || !ot.referenceMode) continue;
    for (const ft of model.factTypes) {
      if (ft.arity !== 2) continue;
      const hasPreferred = ft.constraints.some(
        (c) => c.type === "internal_uniqueness" && c.isPreferred,
      );
      if (!hasPreferred) continue;
      const p0 = model.getObjectType(ft.roles[0]!.playerId);
      const p1 = model.getObjectType(ft.roles[1]!.playerId);
      if (!p0 || !p1) continue;
      const valueTypeId = p0.id === ot.id && p1.kind === "value"
        ? p1.id
        : p1.id === ot.id && p0.kind === "value"
        ? p0.id
        : undefined;
      if (valueTypeId) {
        valueTypeIds.add(valueTypeId);
        factTypeIds.add(ft.id);
      }
    }
  }
  for (const vtId of [...valueTypeIds]) {
    const playsOtherRole = model
      .factTypesForObjectType(vtId)
      .some((ft) => !factTypeIds.has(ft.id));
    if (playsOtherRole) valueTypeIds.delete(vtId);
  }
  return { valueTypeIds, factTypeIds };
}

/**
 * Entity types that exist only to objectify a fact type: they play no role
 * anywhere. Such an entity is drawn as its objectified fact type, never as
 * a box of its own -- a separate box is a disconnected island, and in
 * NORMA a second rendering of the same objectification.
 */
export function pureObjectifyingEntityIds(model: OrmModel): Set<string> {
  const ids = new Set(model.objectifiedFactTypes.map((oft) => oft.objectTypeId));
  for (const ft of model.factTypes) {
    for (const role of ft.roles) ids.delete(role.playerId);
  }
  return ids;
}

/**
 * The relations a set of object types fully contains: every fact type
 * whose players are all in the set, and every subtype fact whose two ends
 * are. A relation reaching outside the set is not drawn.
 */
export function containedRelations(
  model: OrmModel,
  objectTypeIds: ReadonlySet<string>,
): { factTypeIds: Set<string>; subtypeFactIds: Set<string>; } {
  const factTypeIds = new Set<string>();
  const subtypeFactIds = new Set<string>();
  for (const ft of model.factTypes) {
    if (ft.roles.every((r) => objectTypeIds.has(r.playerId))) factTypeIds.add(ft.id);
  }
  for (const sf of model.subtypeFacts) {
    if (objectTypeIds.has(sf.subtypeId) && objectTypeIds.has(sf.supertypeId)) {
      subtypeFactIds.add(sf.id);
    }
  }
  return { factTypeIds, subtypeFactIds };
}

/**
 * The elements `layout` draws in `model`. A show-all view (no `elements`)
 * draws everything; a scoped view draws its listed object types that
 * exist and the relations they fully contain. Saved positions never add a
 * member: a position for an element outside the view is ignored.
 */
export function viewMembership(model: OrmModel, layout: DiagramLayout): ViewMembership {
  if (!isScopedView(layout)) {
    return {
      objectTypeIds: new Set(model.objectTypes.map((ot) => ot.id)),
      factTypeIds: new Set(model.factTypes.map((ft) => ft.id)),
      subtypeFactIds: new Set(model.subtypeFacts.map((sf) => sf.id)),
    };
  }
  const objectTypeIds = new Set(
    layout.elements.filter((id) => model.getObjectType(id) !== undefined),
  );
  return { objectTypeIds, ...containedRelations(model, objectTypeIds) };
}
