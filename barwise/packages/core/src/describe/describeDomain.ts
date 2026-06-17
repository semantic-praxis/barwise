/**
 * Domain description: structured context about an ORM model for
 * AI-assisted development and human review. This entry dispatches on the
 * focus option; the describers, summaries, and types live in siblings.
 */
import type { OrmModel } from "../model/OrmModel.js";
import {
  describeConstraintType,
  describeEntity,
  describeFactType,
  describeFullModel,
  isConstraintTypeKeyword,
} from "./describers.js";
import type { DescribeDomainOptions, DomainDescription } from "./types.js";

export type {
  ConstraintSummary,
  DescribeDomainOptions,
  DomainDescription,
  EntitySummary,
  FactTypeSummary,
  PopulationSummary,
} from "./types.js";

/**
 * Describe a domain model with optional focus.
 *
 * @param model - The ORM model to describe.
 * @param options - Focus and population options.
 * @returns Structured domain description.
 */
export function describeDomain(
  model: OrmModel,
  options: DescribeDomainOptions = {},
): DomainDescription {
  const focus = options.focus?.toLowerCase();
  const includePopulations = options.includePopulations ?? true;

  // If no focus, return full summary.
  if (!focus) {
    return describeFullModel(model, includePopulations);
  }

  // Try to match focus to an entity name.
  const entityMatch = model.objectTypes.find(
    (ot) => ot.name.toLowerCase() === focus,
  );
  if (entityMatch) {
    return describeEntity(model, entityMatch, includePopulations);
  }

  // Try to match focus to a fact type name.
  const factTypeMatch = model.factTypes.find(
    (ft) => ft.name.toLowerCase() === focus,
  );
  if (factTypeMatch) {
    return describeFactType(model, factTypeMatch, includePopulations);
  }

  // Try to match focus to a constraint type keyword.
  if (isConstraintTypeKeyword(focus)) {
    return describeConstraintType(model, focus, includePopulations);
  }

  // No match - return empty description with a message.
  return {
    summary:
      `No matching entity, fact type, or constraint type found for focus: "${options.focus}"`,
    entityTypes: [],
    factTypes: [],
    constraints: [],
    populations: includePopulations ? [] : undefined,
  };
}
