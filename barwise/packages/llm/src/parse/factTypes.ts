/**
 * Pass 2 of the draft-model parse: create fact types.
 */

import type { OrmModel } from "@barwise/core";
import type { ElementProvenance, ExtractedFactType } from "../ExtractionTypes.js";
import { buildDefaultReading } from "./helpers.js";

/**
 * Create fact types in the model from the extracted fact-type section.
 * Mutates `model` and `warnings`; returns the fact-type provenance.
 */
export function parseFactTypes(
  section: readonly ExtractedFactType[],
  model: OrmModel,
  warnings: string[],
): ElementProvenance[] {
  const factTypeProvenance: ElementProvenance[] = [];

  for (const ext of section) {
    if (!ext.name || ext.name.trim().length === 0) {
      warnings.push("Skipped fact type with empty name.");
      continue;
    }

    if (!ext.roles || ext.roles.length === 0) {
      warnings.push(`Skipped fact type "${ext.name}": no roles defined.`);
      continue;
    }

    // Resolve role player names to object type ids.
    const resolvedRoles: Array<{ name: string; playerId: string; }> = [];
    let resolutionFailed = false;

    for (const role of ext.roles) {
      const ot = model.getObjectTypeByName(role.player);
      if (!ot) {
        warnings.push(
          `Fact type "${ext.name}": role player "${role.player}" `
            + `not found among extracted object types. Skipping this fact type.`,
        );
        resolutionFailed = true;
        break;
      }
      resolvedRoles.push({
        name: role.role_name || role.player.toLowerCase(),
        playerId: ot.id,
      });
    }

    if (resolutionFailed) continue;

    // Ensure at least one reading exists.
    let readings = ext.readings?.length
      ? [...ext.readings]
      : [buildDefaultReading(resolvedRoles)];

    // Validate reading placeholders match role count.
    readings = readings.filter((r) => {
      const maxPlaceholder = resolvedRoles.length - 1;
      for (let i = 0; i <= maxPlaceholder; i++) {
        if (!r.includes(`{${i}}`)) {
          warnings.push(
            `Fact type "${ext.name}": reading "${r}" is missing `
              + `placeholder {${i}}. Discarding this reading.`,
          );
          return false;
        }
      }
      return true;
    });

    if (readings.length === 0) {
      readings = [buildDefaultReading(resolvedRoles)];
    }

    try {
      model.addFactType({
        name: ext.name,
        roles: resolvedRoles.map((r) => ({
          name: r.name,
          playerId: r.playerId,
        })),
        readings,
      });

      factTypeProvenance.push({
        elementName: ext.name,
        sourceReferences: ext.source_references ?? [],
      });
    } catch (err) {
      warnings.push(
        `Failed to create fact type "${ext.name}": ${(err as Error).message}`,
      );
    }
  }

  return factTypeProvenance;
}
