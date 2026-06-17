/**
 * Focus-specific describers: build a DomainDescription for the full
 * model, a single entity, a single fact type, or a constraint type.
 */
import type { FactType } from "../model/FactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { OrmModel } from "../model/OrmModel.js";
import { Verbalizer } from "../verbalization/Verbalizer.js";
import {
  buildConstraintTypeFocusSummary,
  buildEntityFocusSummary,
  buildFactTypeFocusSummary,
  buildFullSummary,
  summarizeEntity,
  summarizeFactType,
  summarizePopulation,
} from "./summaries.js";
import type { ConstraintSummary, DomainDescription } from "./types.js";

/**
 * Describe the full model without focus.
 */
export function describeFullModel(
  model: OrmModel,
  includePopulations: boolean,
): DomainDescription {
  const entitySummaries = model.objectTypes.map(summarizeEntity);
  const factTypeSummaries = model.factTypes.map((ft) => summarizeFactType(model, ft));

  const verbalizer = new Verbalizer();
  const constraintSummaries: ConstraintSummary[] = [];
  for (const ft of model.factTypes) {
    for (let i = 0; i < ft.constraints.length; i++) {
      const c = ft.constraints[i]!;
      const v = verbalizer.constraints.verbalize(c, ft, model);
      constraintSummaries.push({
        id: `${ft.id}-constraint-${i}`, // Generate ID from fact type + index
        type: c.type, // Use constraint type, not verbalization category
        verbalization: v.text,
        affectedFactType: ft.name,
      });
    }
  }

  const populationSummaries = includePopulations
    ? model.populations.map((p) => summarizePopulation(model, p))
    : undefined;

  const summary = buildFullSummary(
    model,
    entitySummaries,
    factTypeSummaries,
    constraintSummaries,
    populationSummaries,
  );

  return {
    summary,
    entityTypes: entitySummaries,
    factTypes: factTypeSummaries,
    constraints: constraintSummaries,
    populations: populationSummaries,
  };
}

/**
 * Describe a single entity and related elements.
 */
export function describeEntity(
  model: OrmModel,
  entity: ObjectType,
  includePopulations: boolean,
): DomainDescription {
  const entitySummary = summarizeEntity(entity);

  // Find all fact types involving this entity.
  const relatedFactTypes = model.factTypes.filter((ft) =>
    ft.roles.some((r) => r.playerId === entity.id)
  );

  const factTypeSummaries = relatedFactTypes.map((ft) => summarizeFactType(model, ft));

  // Find all constraints on those fact types.
  const verbalizer = new Verbalizer();
  const constraintSummaries: ConstraintSummary[] = [];
  for (const ft of relatedFactTypes) {
    for (let i = 0; i < ft.constraints.length; i++) {
      const c = ft.constraints[i]!;
      const v = verbalizer.constraints.verbalize(c, ft, model);
      constraintSummaries.push({
        id: `${ft.id}-constraint-${i}`,
        type: c.type,
        verbalization: v.text,
        affectedFactType: ft.name,
      });
    }
  }

  // Find populations for related fact types.
  const populationSummaries = includePopulations
    ? model.populations
      .filter((p) => relatedFactTypes.some((ft) => ft.id === p.factTypeId))
      .map((p) => summarizePopulation(model, p))
    : undefined;

  const summary = buildEntityFocusSummary(
    entity,
    factTypeSummaries,
    constraintSummaries,
    populationSummaries,
  );

  return {
    summary,
    entityTypes: [entitySummary],
    factTypes: factTypeSummaries,
    constraints: constraintSummaries,
    populations: populationSummaries,
  };
}

/**
 * Describe a single fact type and related elements.
 */
export function describeFactType(
  model: OrmModel,
  factType: FactType,
  includePopulations: boolean,
): DomainDescription {
  const factTypeSummary = summarizeFactType(model, factType);

  // Find all entities involved in this fact type.
  const involvedEntities = factType.roles
    .map((r) => model.getObjectType(r.playerId))
    .filter((ot): ot is ObjectType => ot !== undefined);

  const entitySummaries = involvedEntities.map(summarizeEntity);

  // Get constraint verbalizations for this fact type.
  const verbalizer = new Verbalizer();
  const constraintSummaries: ConstraintSummary[] = factType.constraints.map(
    (c, i) => {
      const v = verbalizer.constraints.verbalize(c, factType, model);
      return {
        id: `${factType.id}-constraint-${i}`,
        type: c.type,
        verbalization: v.text,
        affectedFactType: factType.name,
      };
    },
  );

  // Find populations for this fact type.
  const populationSummaries = includePopulations
    ? model.populations
      .filter((p) => p.factTypeId === factType.id)
      .map((p) => summarizePopulation(model, p))
    : undefined;

  const summary = buildFactTypeFocusSummary(
    factType,
    involvedEntities,
    constraintSummaries,
    populationSummaries,
  );

  return {
    summary,
    entityTypes: entitySummaries,
    factTypes: [factTypeSummary],
    constraints: constraintSummaries,
    populations: populationSummaries,
  };
}

/**
 * Describe all constraints of a specific type.
 */
export function describeConstraintType(
  model: OrmModel,
  constraintTypeKeyword: string,
  includePopulations: boolean,
): DomainDescription {
  const verbalizer = new Verbalizer();
  const constraintSummaries: ConstraintSummary[] = [];
  const relatedFactTypes: FactType[] = [];

  for (const ft of model.factTypes) {
    for (let i = 0; i < ft.constraints.length; i++) {
      const c = ft.constraints[i]!;
      if (matchesConstraintType(c.type, constraintTypeKeyword)) {
        const v = verbalizer.constraints.verbalize(c, ft, model);
        constraintSummaries.push({
          id: `${ft.id}-constraint-${i}`,
          type: c.type,
          verbalization: v.text,
          affectedFactType: ft.name,
        });
        if (!relatedFactTypes.some((f) => f.id === ft.id)) {
          relatedFactTypes.push(ft);
        }
      }
    }
  }

  const factTypeSummaries = relatedFactTypes.map((ft) => summarizeFactType(model, ft));

  // Get entities involved in related fact types.
  const involvedEntityIds = new Set<string>();
  for (const ft of relatedFactTypes) {
    for (const role of ft.roles) {
      involvedEntityIds.add(role.playerId);
    }
  }

  const entitySummaries = Array.from(involvedEntityIds)
    .map((id) => model.getObjectType(id))
    .filter((ot): ot is ObjectType => ot !== undefined)
    .map(summarizeEntity);

  const populationSummaries = includePopulations
    ? model.populations
      .filter((p) => relatedFactTypes.some((ft) => ft.id === p.factTypeId))
      .map((p) => summarizePopulation(model, p))
    : undefined;

  const summary = buildConstraintTypeFocusSummary(
    constraintTypeKeyword,
    constraintSummaries,
  );

  return {
    summary,
    entityTypes: entitySummaries,
    factTypes: factTypeSummaries,
    constraints: constraintSummaries,
    populations: populationSummaries,
  };
}

/**
 * Check if a string is a constraint type keyword.
 */
export function isConstraintTypeKeyword(keyword: string): boolean {
  const types = [
    "uniqueness",
    "mandatory",
    "value",
    "frequency",
    "exclusion",
    "subset",
    "equality",
    "ring",
    "disjunctive",
    "exclusive-or",
  ];
  return types.includes(keyword);
}

/**
 * Check if a verbalization type matches a constraint type keyword.
 */
function matchesConstraintType(
  verbalizationType: string | undefined,
  keyword: string,
): boolean {
  if (!verbalizationType) return false;
  const normalized = verbalizationType.toLowerCase();
  const keywordNormalized = keyword.toLowerCase();

  // Direct match.
  if (normalized === keywordNormalized) return true;

  // Handle variations.
  if (keywordNormalized === "uniqueness" && normalized.includes("uniqueness")) {
    return true;
  }
  if (keywordNormalized === "mandatory" && normalized.includes("mandatory")) {
    return true;
  }
  if (keywordNormalized === "value" && normalized.includes("value")) {
    return true;
  }
  if (keywordNormalized === "frequency" && normalized.includes("frequency")) {
    return true;
  }
  if (keywordNormalized === "exclusion" && normalized.includes("exclusion")) {
    return true;
  }
  if (keywordNormalized === "subset" && normalized.includes("subset")) {
    return true;
  }
  if (keywordNormalized === "equality" && normalized.includes("equality")) {
    return true;
  }
  if (keywordNormalized === "ring" && normalized.includes("ring")) return true;
  if (
    keywordNormalized === "disjunctive"
    && normalized.includes("disjunctive")
  ) {
    return true;
  }
  if (
    keywordNormalized === "exclusive-or"
    && normalized.includes("exclusive")
  ) {
    return true;
  }

  return false;
}
