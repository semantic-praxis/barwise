/**
 * Impact analysis: determine which artifacts depend on a changed model element.
 */

import type { OrmModel } from "../model/OrmModel.js";
import { checkScope, type ModelScope } from "./attribution.js";
import type { LineageManifest } from "./types.js";

/**
 * Information about an artifact affected by a change.
 */
export interface AffectedArtifact {
  readonly artifact: string;
  readonly format: string;
  readonly relationship: string;
  /** The model the export names; absent when it names none. */
  readonly sourceModel?: string;
}

/**
 * Impact report showing which artifacts depend on a changed element.
 */
export interface ImpactReport {
  readonly changedElement: string;
  readonly affectedArtifacts: readonly AffectedArtifact[];
  /**
   * Exports written under 3.x ids that named no id this one is known by
   * (iri-identity 6e): they may depend on the element under its old id, so
   * they are listed rather than left out. Re-exporting answers it.
   */
  readonly exportsBefore40: readonly string[];
}

/**
 * Analyze impact of changing a model element.
 *
 * Given a model element ID, find all exported artifacts that depend on it
 * by checking which artifacts reference this element in their sources.
 *
 * @param manifest - The lineage manifest (read by the caller), or
 *   undefined when no manifest exists
 * @param elementId - ID of the changed element (entity, fact type, constraint, etc.)
 * @param scope - The model's file and the model files beside it. An
 *   export naming another model whose file is there is skipped, because
 *   two models can each have an element with one id once ids are local
 *   names; one naming a file that is gone is read, since it is likely this
 *   model's before a rename. An export naming no model is read either
 *   way, and the report says which model each export names.
 * @returns Impact report with affected artifacts
 */
export function analyzeImpact(
  manifest: LineageManifest | undefined,
  elementId: string,
  scope?: ModelScope,
  model?: OrmModel,
): ImpactReport {
  if (!manifest) {
    return {
      changedElement: elementId,
      affectedArtifacts: [],
      exportsBefore40: [],
    };
  }
  // The ids the element is known by: as asked, and, for a model replayed
  // from a 3.x file, its 4.0 id for a 3.x one the file states and its 3.x
  // id for a 4.0 one (barwise-wcg.v5k). An export records the ids of the
  // model that wrote it, so either can be the one it holds.
  const known = new Set([elementId]);
  const now = model?.idFromPrior(elementId);
  if (now !== undefined) known.add(now);
  const before = model?.priorIds?.get(elementId);
  if (before !== undefined) known.add(before);
  const exportsBefore40: string[] = [];

  if (scope) checkScope(scope);
  const affectedArtifacts: AffectedArtifact[] = [];

  // Check each export to see if it references the changed element
  for (const exp of manifest.exports) {
    if (
      scope !== undefined && exp.sourceModel !== undefined
      && exp.sourceModel !== scope.sourceModel && scope.modelsBeside.includes(exp.sourceModel)
    ) continue;
    const sourceRef = exp.sources.find((src) => known.has(src.elementId));
    if (!sourceRef && exp.idsBefore40) exportsBefore40.push(exp.artifact);

    if (sourceRef) {
      affectedArtifacts.push({
        artifact: exp.artifact,
        format: exp.format,
        relationship: buildRelationshipDescription(sourceRef),
        ...(exp.sourceModel !== undefined ? { sourceModel: exp.sourceModel } : {}),
      });
    }
  }

  return {
    changedElement: elementId,
    affectedArtifacts,
    exportsBefore40,
  };
}

/**
 * Build a human-readable description of the relationship between
 * an artifact and a source element.
 */
function buildRelationshipDescription(sourceRef: {
  elementType: string;
  elementName: string;
}): string {
  switch (sourceRef.elementType) {
    case "EntityType":
      return `derived from entity type ${sourceRef.elementName}`;
    case "ValueType":
      return `uses value type ${sourceRef.elementName}`;
    case "FactType":
      return `derived from fact type ${sourceRef.elementName}`;
    case "Constraint":
      // "states", not "enforces": a DDL table also lists a constraint its
      // dialect could not enforce and only comments (barwise-20o).
      return `states constraint ${sourceRef.elementName}`;
    case "SubtypeFact":
      return `involves subtype relationship ${sourceRef.elementName}`;
    case "Role":
      return `includes role ${sourceRef.elementName}`;
    default:
      return `references ${sourceRef.elementName}`;
  }
}
