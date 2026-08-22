/**
 * Pass 5 of the draft-model parse: create populations.
 */

import type { FactType, OrmModel } from "@barwise/core";
import type { ExtractedPopulation } from "../ExtractionTypes.js";

/**
 * The role a `role_values` key names, or undefined when nothing matches.
 *
 * Role name first (case-insensitively), then player name (exactly),
 * skipping any role already claimed by an earlier key of the same
 * instance. Mirrors `resolveRolesByPlayerName` deliberately: the same
 * package resolving the same kind of name two different ways is how a
 * population came to be unable to express what a constraint could.
 */
function resolveInstanceRole(
  factType: FactType,
  model: OrmModel,
  hint: string,
  claimed: Readonly<Record<string, string>>,
): string | undefined {
  const lower = hint.toLowerCase();

  const byRoleName = factType.roles.find(
    (r) => r.name.toLowerCase() === lower && claimed[r.id] === undefined,
  );
  if (byRoleName) return byRoleName.id;

  const player = model.getObjectTypeByName(hint);
  if (!player) return undefined;
  return factType.rolesForPlayer(player.id)
    .find((r) => claimed[r.id] === undefined)?.id;
}

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
        // Map role hints to role IDs. A hint is a role name or a player
        // name, resolved in that order and consuming the role it
        // matches -- the same discipline `resolveRolesByPlayerName`
        // applies to constraints.
        //
        // Both halves are load-bearing for one shape. On a
        // self-referencing fact type ("Employee mentors Employee") a
        // JSON object cannot carry the key "Employee" twice, so the
        // only way to name both roles is by role name; and resolving
        // without consuming would hand both keys the same role.
        // Player-name-only resolution against `rolesForPlayer(...)[0]`
        // did neither, which made a population of any ring or
        // self-referencing fact type impossible to express -- one
        // spelling lost a role to `population/incomplete-instance`, the
        // other was dropped as unresolvable
        // (docs/specs/population-instance-completeness.spec.md).
        const roleValues: Record<string, string> = {};
        let resolutionFailed = false;

        for (const [hint, value] of Object.entries(instData.role_values)) {
          const role = resolveInstanceRole(factType, model, hint, roleValues);
          if (!role) {
            warnings.push(
              `Population instance for "${ext.fact_type}": could not resolve role "${hint}" in this fact type.`,
            );
            resolutionFailed = true;
            break;
          }
          roleValues[role] = value;
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
