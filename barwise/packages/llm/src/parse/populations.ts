/**
 * Pass 5 of the draft-model parse: create populations.
 */

import type { OrmModel } from "@barwise/core";
import type { ExtractedPopulation } from "../ExtractionTypes.js";

/**
 * Create populations and their instances in the model from the extracted
 * population section. Mutates `model` and `warnings`. Produces no provenance.
 */
export function parsePopulations(
  section: readonly ExtractedPopulation[],
  model: OrmModel,
  warnings: string[],
): void {
  for (const ext of section) {
    const factType = model.getFactTypeByName(ext.fact_type);
    if (!factType) {
      warnings.push(
        `Population for fact type "${ext.fact_type}" skipped: fact type not found.`,
      );
      continue;
    }

    try {
      const population = model.addPopulation({
        factTypeId: factType.id,
        description: ext.description,
        // A transcript names far more entities than it gives complete
        // facts about, so what an extraction can populate is a sample
        // by construction, never the full extension. Marking it says
        // so: the instances remain evidence a constraint is satisfied,
        // and stop being grounds for reporting one violated. Without
        // this, every entity a long transcript merely mentioned raised
        // a mandatory violation on the draft model -- six of them sank
        // one dev case to zero, and the same errors reached anyone
        // importing a long transcript in the editor
        // (docs/specs/sample-populations.spec.md).
        sample: true,
      });

      // Add instances to the population
      for (const instData of ext.instances) {
        // Map role player names to role IDs
        const roleValues: Record<string, string> = {};
        let resolutionFailed = false;

        for (const [playerName, value] of Object.entries(instData.role_values)) {
          // Find role by player name
          const player = model.getObjectTypeByName(playerName);
          if (!player) {
            warnings.push(
              `Population instance for "${ext.fact_type}": player "${playerName}" not found.`,
            );
            resolutionFailed = true;
            break;
          }

          const roles = factType.rolesForPlayer(player.id);
          if (roles.length === 0) {
            warnings.push(
              `Population instance for "${ext.fact_type}": player "${playerName}" does not play a role in this fact type.`,
            );
            resolutionFailed = true;
            break;
          }

          // Use first matching role (for simplicity)
          roleValues[roles[0]!.id] = value;
        }

        if (!resolutionFailed && Object.keys(roleValues).length > 0) {
          population.addInstance({ roleValues });
        }
      }
    } catch (err) {
      warnings.push(
        `Failed to create population for "${ext.fact_type}": ${(err as Error).message}`,
      );
    }
  }
}
