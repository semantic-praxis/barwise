/**
 * Focus-specific describers: build a DomainDescription for the full
 * model, a single entity, a single fact type, or a constraint type.
 */
import type { Constraint } from "../model/Constraint.js";
import { matchesConstraintType } from "../model/constraintKeyword.js";
import type { FactType } from "../model/FactType.js";
import type { ModelGraph } from "../model/graph.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { ConstraintInView, OrmModel } from "../model/OrmModel.js";
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
  graph: ModelGraph,
  includePopulations: boolean,
): DomainDescription {
  const entitySummaries = model.objectTypes.map(summarizeEntity);
  const factTypeSummaries = model.factTypes.map((ft) => summarizeFactType(model, ft, graph));

  const constraintSummaries = new ConstraintSummarizer(model).wholeModel(() => true);

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
  graph: ModelGraph,
  entity: ObjectType,
  includePopulations: boolean,
): DomainDescription {
  const entitySummary = summarizeEntity(entity);

  // Find all fact types involving this entity.
  const relatedFactTypes = model.factTypes.filter((ft) =>
    ft.roles.some((r) => r.playerId === entity.id)
  );

  const factTypeSummaries = relatedFactTypes.map((ft) => summarizeFactType(model, ft, graph));

  const constraintSummaries = new ConstraintSummarizer(model).touching(relatedFactTypes);

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
  graph: ModelGraph,
  factType: FactType,
  includePopulations: boolean,
): DomainDescription {
  const factTypeSummary = summarizeFactType(model, factType, graph);

  // Find all entities involved in this fact type.
  const involvedEntities = factType.roles
    .map((r) => model.getObjectType(r.playerId))
    .filter((ot): ot is ObjectType => ot !== undefined);

  const entitySummaries = involvedEntities.map(summarizeEntity);

  const constraintSummaries = new ConstraintSummarizer(model).touching([factType]);

  // Find populations for this fact type.
  const populationSummaries = includePopulations
    ? model.populations
      .filter((p) => p.factTypeId === factType.id)
      .map((p) => summarizePopulation(model, p))
    : undefined;

  const summary = buildFactTypeFocusSummary(
    factType,
    graph,
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
  graph: ModelGraph,
  constraintTypeKeyword: string,
  includePopulations: boolean,
): DomainDescription {
  const constraintSummaries = new ConstraintSummarizer(model).wholeModel((c) =>
    matchesConstraintType(c.type, constraintTypeKeyword)
  );
  // Every fact type a matching constraint applies to, in model order.
  const spanned = new Set(constraintSummaries.flatMap((c) => c.factTypeIds));
  const relatedFactTypes = model.factTypes.filter((ft) => spanned.has(ft.id));

  const factTypeSummaries = relatedFactTypes.map((ft) => summarizeFactType(model, ft, graph));

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
 * Constraint summaries by Open decision 9: each says the constraint's own
 * id and the fact types it applies to, read from its verbalization row so
 * describe, query and verbalize cannot disagree about either. The id used
 * to be positional (`${ft.id}-constraint-${i}`) and the fact type the
 * one nesting the constraint, so both moved when a file was reordered.
 */
class ConstraintSummarizer {
  private readonly verbalizer = new Verbalizer();

  constructor(private readonly model: OrmModel) {}

  /** Each fact type's own constraints, then each constraint across fact types once. */
  wholeModel(matches: (c: Constraint) => boolean): ConstraintSummary[] {
    const summaries: ConstraintSummary[] = [];
    for (const ft of this.model.factTypes) {
      for (const c of ft.internalConstraints) {
        if (matches(c)) summaries.push(this.summary([c, ft]));
      }
    }
    for (const c of this.model.constraints) {
      if (matches(c)) summaries.push(this.summary([c, undefined]));
    }
    return summaries;
  }

  /** Every constraint touching these fact types, once even when it spans two of them. */
  touching(factTypes: readonly FactType[]): ConstraintSummary[] {
    return this.model.constraintsTouchingAny(factTypes.map((ft) => ft.id))
      .map((inView) => this.summary(inView));
  }

  /**
   * An internal constraint is verbalized in the fact type it lives in; one
   * across fact types has none.
   */
  private summary([c, ft]: ConstraintInView): ConstraintSummary {
    const row = ft === undefined
      ? this.verbalizer.constraints.verbalizeExternal(c, this.model)
      : this.verbalizer.constraints.verbalize(c, ft, this.model);
    // Every id here came from [ft.id] or factTypesHolding, so each resolves.
    const factTypeIds = row.factTypeIds ?? [];
    return {
      id: row.sourceElementId,
      type: c.type,
      verbalization: row.text,
      factTypes: factTypeIds.map((id) => this.model.getFactType(id)!.name),
      factTypeIds,
    };
  }
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
