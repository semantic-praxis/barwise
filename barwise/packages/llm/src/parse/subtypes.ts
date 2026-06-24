/**
 * Pass 4 of the draft-model parse: create subtype facts.
 */

import type { OrmModel } from "@barwise/core";
import type { ExtractedSubtype, SubtypeProvenance } from "../ExtractionTypes.js";

/**
 * Create subtype facts in the model from the extracted subtype section.
 * Mutates `model`; returns the subtype provenance.
 */
export function parseSubtypes(
  section: readonly ExtractedSubtype[],
  model: OrmModel,
  _warnings: string[],
): SubtypeProvenance[] {
  const subtypeProvenance: SubtypeProvenance[] = [];

  for (const ext of section) {
    const subtypeOt = model.getObjectTypeByName(ext.subtype);
    if (!subtypeOt) {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Subtype entity "${ext.subtype}" not found among extracted object types.`,
      });
      continue;
    }

    const supertypeOt = model.getObjectTypeByName(ext.supertype);
    if (!supertypeOt) {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Supertype entity "${ext.supertype}" not found among extracted object types.`,
      });
      continue;
    }

    if (subtypeOt.kind !== "entity") {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Subtype "${ext.subtype}" is a ${subtypeOt.kind} type, not an entity type.`,
      });
      continue;
    }

    if (supertypeOt.kind !== "entity") {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason:
          `Supertype "${ext.supertype}" is a ${supertypeOt.kind} type, not an entity type.`,
      });
      continue;
    }

    try {
      model.addSubtypeFact({
        subtypeId: subtypeOt.id,
        supertypeId: supertypeOt.id,
        providesIdentification: ext.provides_identification ?? true,
      });

      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: true,
      });
    } catch (err) {
      subtypeProvenance.push({
        subtype: ext.subtype,
        supertype: ext.supertype,
        sourceReferences: ext.source_references ?? [],
        applied: false,
        skipReason: `Failed to create subtype fact: ${(err as Error).message}`,
      });
    }
  }

  return subtypeProvenance;
}
