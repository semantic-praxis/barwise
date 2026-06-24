/**
 * Pass 6 of the draft-model parse: create objectified fact types.
 */

import type { OrmModel } from "@barwise/core";
import type {
  ExtractedObjectifiedFactType,
  ObjectificationProvenance,
} from "../ExtractionTypes.js";

/**
 * Create objectified fact types in the model from the extracted section.
 * Mutates `model`; returns the objectification provenance.
 */
export function parseObjectifications(
  section: readonly ExtractedObjectifiedFactType[],
  model: OrmModel,
  _warnings: string[],
): ObjectificationProvenance[] {
  const objectificationProvenance: ObjectificationProvenance[] = [];

  for (const ext of section) {
    const ft = model.getFactTypeByName(ext.fact_type);
    if (!ft) {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Fact type "${ext.fact_type}" not found among extracted fact types.`,
      });
      continue;
    }

    const ot = model.getObjectTypeByName(ext.object_type);
    if (!ot) {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Object type "${ext.object_type}" not found among extracted object types.`,
      });
      continue;
    }

    if (ot.kind !== "entity") {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Object type "${ext.object_type}" is a ${ot.kind} type, not an entity type.`,
      });
      continue;
    }

    try {
      model.addObjectifiedFactType({
        factTypeId: ft.id,
        objectTypeId: ot.id,
      });

      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: true,
      });
    } catch (err) {
      objectificationProvenance.push({
        factType: ext.fact_type,
        objectType: ext.object_type,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Failed to create objectification: ${(err as Error).message}`,
      });
    }
  }

  return objectificationProvenance;
}
