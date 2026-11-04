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
   * Exports written under 3.x ids that impact could not read (iri-identity
   * 6e): every one it missed when the element's 3.x id is unknown (a 4.0
   * model, or none), else those holding a 3.x id more than one element
   * stated. They may depend on the element under its old id, so they are
   * listed rather than left out. Re-exporting answers it.
   */
  readonly exportsBefore40: readonly string[];
  /**
   * The 4.0 ids of the elements the asked id names, present when it is a
   * 3.x id the file stated for more than one element, which 3.x allowed and
   * no lookup by the id alone can tell apart (iri-identity 6e). Exports
   * written under 3.x ids are then not matched by it, and those holding it
   * are listed in `exportsBefore40`; exports written under 4.0 ids still
   * match the element whose 4.0 id it is, if any.
   */
  readonly ambiguous?: readonly string[];
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
  const { now, before, unknownIds, ambiguous } = idsByGeneration(elementId, model);
  const exportsBefore40: string[] = [];

  if (scope) checkScope(scope);
  const affectedArtifacts: AffectedArtifact[] = [];

  // Check each export to see if it references the changed element
  for (const exp of manifest.exports) {
    if (
      scope !== undefined && exp.sourceModel !== undefined
      && exp.sourceModel !== scope.sourceModel && scope.modelsBeside.includes(exp.sourceModel)
    ) continue;
    // An export is matched by the id of its own generation: one 3.x id can
    // be another element's 4.0 id, so the two are never pooled.
    const id = exp.idsBefore40 ? before : now;
    const sourceRef = id === undefined
      ? undefined
      : exp.sources.find((src) => src.elementId === id);
    // A marked export that cannot be read is listed as unknown: every one
    // when no 3.x id is known, else those holding an id that cannot be read.
    const unreadable = unknownIds === undefined
      || exp.sources.some((src) => unknownIds.has(src.elementId));
    if (!sourceRef && exp.idsBefore40 && unreadable) exportsBefore40.push(exp.artifact);

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
    ...(ambiguous !== undefined ? { ambiguous } : {}),
  };
}

/**
 * The element's id in each generation an export can record (iri-identity
 * 6e, barwise-wcg.v5k), and the 3.x ids that cannot be read.
 *
 * For a model replayed from a 3.x file: an id the file states for one
 * element is read as that element's 3.x id (its 4.0 id from
 * `idFromPrior`); else the id is read as a 4.0 id, and the element's 3.x
 * id comes from `priorIds`. The file's reading wins where an id is both,
 * since the file is what the caller is looking at.
 *
 * 3.x let elements of different kinds state one id. Such an id says nothing
 * about which element an export meant, so it is never matched, and the
 * marked exports holding it are listed as unknown (`unknownIds`); this is
 * the owner's call on 6e, after attempts to tell the elements apart by kind
 * kept missing cases. Asked by the shared id itself, the elements it names
 * are returned as `ambiguous`, and exports a 4.0 build wrote still match
 * whichever element holds that id now.
 *
 * A 4.0 model, or none (inline MCP, or a file that does not load), knows
 * no 3.x id: the id is a 4.0 id, and every marked export it misses is
 * listed (`unknownIds` undefined). Trying the id as a 3.x id too would pool
 * the generations, and could name another element's export.
 */
function idsByGeneration(
  elementId: string,
  model: OrmModel | undefined,
): {
  now: string | undefined;
  before: string | undefined;
  unknownIds: ReadonlySet<string> | undefined;
  ambiguous: readonly string[] | undefined;
} {
  if (model?.priorIds === undefined) {
    return { now: elementId, before: undefined, unknownIds: undefined, ambiguous: undefined };
  }
  const priorIds = model.priorIds;
  const fromFile = model.idFromPrior(elementId);
  if (fromFile !== undefined) {
    return { now: fromFile, before: elementId, unknownIds: new Set(), ambiguous: undefined };
  }
  const unknownIds = new Set<string>();
  const sharing = [...priorIds].filter(([, p]) => p === elementId).map(([id]) => id);
  const ambiguous = sharing.length > 1 ? sharing : undefined;
  if (ambiguous !== undefined) unknownIds.add(elementId);
  // The element asked for as a 4.0 id, if the model holds one by it.
  const now = ambiguous === undefined || priorIds.has(elementId) ? elementId : undefined;
  const prior = now === undefined ? undefined : priorIds.get(now);
  // `idFromPrior` is undefined for a prior id exactly when it is shared.
  const unique = prior !== undefined && model.idFromPrior(prior) !== undefined;
  if (prior !== undefined && !unique) unknownIds.add(prior);
  return { now, before: unique ? prior : undefined, unknownIds, ambiguous };
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
