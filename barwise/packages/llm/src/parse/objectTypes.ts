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

    const kind = ext.kind ?? "entity";
    // An entity type takes its data type and value constraint from its
    // reference mode's value type, and core refuses them on the entity
    // (barwise-5fg). A model that attaches one anyway has still described a
    // real entity: drop the field and say so, rather than lose the entity
    // and every fact type that names it.
    const isEntity = kind === "entity";
    if (isEntity) {
      const dropped = [
        ...(ext.data_type !== undefined ? ["data_type"] : []),
        ...(ext.value_constraint?.values?.length ? ["value_constraint"] : []),
      ];
      if (dropped.length > 0) {
        warnings.push(
          `Dropped ${
            dropped.join(" and ")
          } from entity type "${ext.name}": an entity type takes these from its reference mode's value type.`,
        );
      }
    }

    try {
      model.addObjectType({
        name: ext.name,
        kind,
        referenceMode: ext.kind === "entity"
          ? (ext.reference_mode ?? `${camelCase(ext.name)}_id`)
          : undefined,
        definition: ext.definition,
        valueConstraint: !isEntity && ext.value_constraint?.values?.length
          ? { values: [...ext.value_constraint.values] }
          : undefined,
        dataType: isEntity ? undefined : resolveDataType(ext.data_type, ext.name, warnings),
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
