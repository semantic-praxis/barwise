/**
 * Pass 1 of the draft-model parse: create object types.
 */

import type { OrmModel } from "@barwise/core";
import type { ElementProvenance, ExtractedObjectType } from "../ExtractionTypes.js";
import { camelCase, resolveDataType } from "./helpers.js";

/**
 * Create object types in the model from the extracted object-type section.
 * Mutates `model` and `warnings`; returns the object-type provenance.
 */
export function parseObjectTypes(
  section: readonly ExtractedObjectType[],
  model: OrmModel,
  warnings: string[],
): ElementProvenance[] {
  const objectTypeProvenance: ElementProvenance[] = [];

  for (const ext of section) {
    if (!ext.name || ext.name.trim().length === 0) {
      warnings.push("Skipped object type with empty name.");
      continue;
    }

    try {
      model.addObjectType({
        name: ext.name,
        kind: ext.kind ?? "entity",
        referenceMode: ext.kind === "entity"
          ? (ext.reference_mode ?? `${camelCase(ext.name)}_id`)
          : undefined,
        definition: ext.definition,
        valueConstraint: ext.value_constraint?.values?.length
          ? { values: [...ext.value_constraint.values] }
          : undefined,
        dataType: resolveDataType(ext.data_type, ext.name, warnings),
        aliases: ext.aliases?.length ? [...ext.aliases] : undefined,
      });

      objectTypeProvenance.push({
        elementName: ext.name,
        sourceReferences: ext.source_references ?? [],
      });
    } catch (err) {
      warnings.push(
        `Failed to create object type "${ext.name}": ${(err as Error).message}`,
      );
    }
  }

  return objectTypeProvenance;
}
