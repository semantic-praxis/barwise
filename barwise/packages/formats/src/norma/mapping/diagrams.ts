/**
 * Phase 5 of the NORMA mapping: diagram geometry (norma-export spec,
 * workstream 2). Each ORMDiagram section becomes a saved DiagramLayout:
 * shape centers convert from NORMA's inch coordinates to barwise's pixel
 * space (96 px/inch), keyed by element id as the `diagrams:` section
 * requires (orm_version 2.0). Connector shapes are not persisted on either side.
 *
 * A NORMA diagram draws only its shapes, so it imports as a scoped view:
 * its object-type shapes become `elements`. A diagram that shows every
 * object type the panel would draw imports as show-all instead, so a model
 * exported from a show-all view comes back as one
 * (`docs/specs/norma-export-view-scope.spec.md`).
 */
import { absorbedReferenceModes, pureObjectifyingEntityIds } from "@barwise/core";
import type { NormaMappingContext } from "./context.js";

const PX_PER_INCH = 96;

export function mapDiagrams(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, factTypeIdMap } = ctx;
  // Object types a diagram never draws as their own shape: the panel and
  // the exporter fold them away, so their absence does not narrow a view.
  const neverShown = new Set([
    ...pureObjectifyingEntityIds(model),
    ...absorbedReferenceModes(model).valueTypeIds,
  ]);
  for (const diagram of doc.diagrams ?? []) {
    const positions: Record<string, { x: number; y: number; }> = {};
    // A Set: NORMA allows several shapes of one object type on a diagram.
    const shown = new Set<string>();
    for (const shape of diagram.shapes) {
      // Object-type ids pass through the mapper; fact types get fresh
      // model ids, so both resolve through the context id maps.
      const mappedId = shape.kind === "object_type"
        ? objectTypeIdMap.get(shape.subjectRef) ?? shape.subjectRef
        : factTypeIdMap.get(shape.subjectRef);
      const element = mappedId === undefined
        ? undefined
        : shape.kind === "object_type"
        ? model.getObjectType(mappedId)
        : model.getFactType(mappedId);
      if (!element) continue;
      if (shape.kind === "object_type") shown.add(element.id);
      // NORMA draws an objectification as its fact type's shape, never as an
      // object-type shape, so a shown objectified fact type shows its entity.
      if (shape.kind === "fact_type") {
        const objectifier = model.objectifiedFactTypes.find((o) => o.factTypeId === element.id);
        if (objectifier) shown.add(objectifier.objectTypeId);
      }
      positions[element.id] = {
        x: Math.round((shape.x + shape.width / 2) * PX_PER_INCH),
        y: Math.round((shape.y + shape.height / 2) * PX_PER_INCH),
      };
    }
    if (Object.keys(positions).length === 0) continue;
    const showsAll = model.objectTypes.every((ot) => neverShown.has(ot.id) || shown.has(ot.id));
    model.addDiagramLayout({
      name: diagram.name,
      ...(showsAll ? {} : { elements: [...shown] }),
      positions,
      orientations: {},
    });
  }
}
