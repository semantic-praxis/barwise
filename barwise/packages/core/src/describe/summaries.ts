/**
 * Structured element summaries and the human-readable text summaries
 * derived from them.
 */
import type { FactType } from "../model/FactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import type { Population } from "../model/Population.js";
import { Verbalizer } from "../verbalization/Verbalizer.js";
import type {
  ConstraintSummary,
  EntitySummary,
  FactTypeSummary,
  PopulationSummary,
} from "./types.js";

/**
 * Summarize an entity type.
 */
export function summarizeEntity(entity: ObjectType): EntitySummary {
  return {
    id: entity.id,
    name: entity.name,
    definition: entity.definition,
    kind: entity.kind,
    referenceMode: entity.referenceMode,
  };
}

/**
 * Summarize a fact type.
 */
export function summarizeFactType(
  model: OrmModel,
  factType: FactType,
): FactTypeSummary {
  const verbalizer = new Verbalizer();
  const primaryVerbalization = verbalizer.factTypes.verbalizePrimary(
    factType,
    model,
  );
  const primaryReading = primaryVerbalization.text;

  const involvedEntities = factType.roles
    .map((r) => {
      const ot = model.getObjectType(r.playerId);
      return ot?.name ?? r.playerId;
    })
    .filter((name, idx, arr) => arr.indexOf(name) === idx); // unique

  return {
    id: factType.id,
    name: factType.name,
    arity: factType.roles.length,
    primaryReading,
    involvedEntities,
    constraintCount: factType.constraints.length,
  };
}

/**
 * Summarize a population.
 */
export function summarizePopulation(
  model: OrmModel,
  population: Population,
): PopulationSummary {
  const factType = model.getFactType(population.factTypeId);
  const factTypeName = factType?.name ?? population.factTypeId;

  // Limit sample instances to 5 for brevity.
  const sampleInstances = population.instances.slice(0, 5);

  return {
    factTypeId: population.factTypeId,
    factTypeName,
    description: population.description,
    instanceCount: population.instances.length,
    sampleInstances,
  };
}

/**
 * Build a human-readable summary for the full model.
 */
export function buildFullSummary(
  model: OrmModel,
  entities: readonly EntitySummary[],
  factTypes: readonly FactTypeSummary[],
  constraints: readonly ConstraintSummary[],
  populations: readonly PopulationSummary[] | undefined,
): string {
  const parts: string[] = [];

  parts.push(`Domain Model: ${model.name}`);
  if (model.domainContext) {
    parts.push(`Context: ${model.domainContext}`);
  }

  parts.push(`\nEntities: ${entities.length}`);
  parts.push(`Fact Types: ${factTypes.length}`);
  parts.push(`Constraints: ${constraints.length}`);

  if (populations && populations.length > 0) {
    const totalInstances = populations.reduce(
      (sum, p) => sum + p.instanceCount,
      0,
    );
    parts.push(`Populations: ${populations.length} (${totalInstances} instances)`);
  }

  parts.push("\nKey Entities:");
  for (const e of entities.slice(0, 10)) {
    // Show first 10
    const defPart = e.definition ? ` - ${e.definition}` : "";
    parts.push(`  - ${e.name}${defPart}`);
  }

  if (entities.length > 10) {
    parts.push(`  ... and ${entities.length - 10} more`);
  }

  return parts.join("\n");
}

/**
 * Build a human-readable summary for entity focus.
 */
export function buildEntityFocusSummary(
  entity: ObjectType,
  factTypes: readonly FactTypeSummary[],
  constraints: readonly ConstraintSummary[],
  populations: readonly PopulationSummary[] | undefined,
): string {
  const parts: string[] = [];

  parts.push(`Entity: ${entity.name}`);
  if (entity.definition) {
    parts.push(`Definition: ${entity.definition}`);
  }
  parts.push(`Kind: ${entity.kind}`);
  if (entity.referenceMode) {
    parts.push(`Reference Mode: ${entity.referenceMode}`);
  }

  parts.push(`\nRelated Fact Types: ${factTypes.length}`);
  for (const ft of factTypes) {
    parts.push(`  - ${ft.primaryReading}`);
  }

  parts.push(`\nConstraints: ${constraints.length}`);
  for (const c of constraints.slice(0, 10)) {
    // Show first 10
    parts.push(`  - ${c.verbalization}`);
  }

  if (constraints.length > 10) {
    parts.push(`  ... and ${constraints.length - 10} more`);
  }

  if (populations && populations.length > 0) {
    parts.push(`\nPopulations: ${populations.length}`);
    for (const p of populations) {
      parts.push(`  - ${p.factTypeName}: ${p.instanceCount} instances`);
    }
  }

  return parts.join("\n");
}

/**
 * Build a human-readable summary for fact type focus.
 */
export function buildFactTypeFocusSummary(
  factType: FactType,
  entities: readonly ObjectType[],
  constraints: readonly ConstraintSummary[],
  populations: readonly PopulationSummary[] | undefined,
): string {
  const parts: string[] = [];

  parts.push(`Fact Type: ${factType.name}`);
  parts.push(`Arity: ${factType.roles.length}`);

  parts.push(`\nRoles:`);
  for (const role of factType.roles) {
    const entity = entities.find((e) => e.id === role.playerId);
    const entityName = entity?.name ?? role.playerId;
    parts.push(`  - ${role.name} (played by ${entityName})`);
  }

  parts.push(`\nConstraints: ${constraints.length}`);
  for (const c of constraints) {
    parts.push(`  - ${c.verbalization}`);
  }

  if (populations && populations.length > 0) {
    parts.push(`\nPopulation Examples:`);
    for (const p of populations) {
      parts.push(`  Description: ${p.description ?? "Sample data"}`);
      parts.push(`  Instances: ${p.instanceCount}`);
      if (p.sampleInstances.length > 0) {
        parts.push(`  Sample:`);
        for (const inst of p.sampleInstances.slice(0, 3)) {
          const values = Object.entries(inst.roleValues)
            .map(([roleId, value]) => `${roleId}=${value}`)
            .join(", ");
          parts.push(`    - { ${values} }`);
        }
      }
    }
  }

  return parts.join("\n");
}

/**
 * Build a human-readable summary for constraint type focus.
 */
export function buildConstraintTypeFocusSummary(
  constraintType: string,
  constraints: readonly ConstraintSummary[],
): string {
  const parts: string[] = [];

  parts.push(`Constraint Type: ${constraintType}`);
  parts.push(`Total Constraints: ${constraints.length}`);

  parts.push(`\nConstraints:`);
  for (const c of constraints) {
    parts.push(`  - [${c.affectedFactType}] ${c.verbalization}`);
  }

  return parts.join("\n");
}
