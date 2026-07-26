/**
 * Phase 5 of the NORMA mapping: diagram geometry (norma-export spec,
 * workstream 2). Each ORMDiagram section becomes a saved DiagramLayout:
 * shape centers convert from NORMA's inch coordinates to barwise's pixel
 * space (96 px/inch), keyed by element name as the `diagrams:` section
 * requires. Connector shapes are not persisted on either side.
 */
import type { NormaMappingContext } from "./context.js";

const PX_PER_INCH = 96;

export function mapDiagrams(ctx: NormaMappingContext): void {
  const { doc, model, objectTypeIdMap, factTypeIdMap } = ctx;
  for (const diagram of doc.diagrams ?? []) {
    const positions: Record<string, { x: number; y: number; }> = {};
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
      positions[element.name] = {
        x: Math.round((shape.x + shape.width / 2) * PX_PER_INCH),
        y: Math.round((shape.y + shape.height / 2) * PX_PER_INCH),
      };
    }
    if (Object.keys(positions).length === 0) continue;
    model.addDiagramLayout({
      name: diagram.name,
      positions,
      orientations: {},
    });
  }
}
