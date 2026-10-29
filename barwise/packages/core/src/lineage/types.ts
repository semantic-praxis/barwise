/**
 * Lineage tracking types for tracing conceptual model elements to
 * generated artifacts (DDL, dbt, Avro, etc.).
 */

/**
 * Reference to a specific model element that contributed to an artifact.
 */
export interface SourceReference {
  readonly elementId: string;
  readonly elementType:
    | "EntityType"
    | "ValueType"
    | "FactType"
    | "Constraint"
    | "SubtypeFact"
    | "Role";
  readonly elementName: string;
}

/**
 * Lineage information for a single generated artifact.
 */
export interface LineageEntry {
  readonly artifact: string;
  readonly sources: readonly SourceReference[];
}

/**
 * Export manifest entry describing a single artifact export with its lineage.
 */
export interface ManifestExport {
  readonly artifact: string;
  readonly format: string;
  readonly exportedAt: string;
  readonly modelHash: string;
  readonly sources: readonly SourceReference[];
  /**
   * The model file this export was made from, relative to the manifest's
   * directory. Absent on an export written before exports named their
   * model; `attribution.ts` decides whose such an export is.
   */
  readonly sourceModel?: string;
}

/**
 * Complete lineage manifest for a model directory.
 * Stored as .barwise/lineage.yaml adjacent to the source model.
 *
 * `sourceModel` names the model that exported last. It is kept so an
 * older build reads the manifest as before, and it does not say whose an
 * export is: each export names its own.
 */
export interface LineageManifest {
  readonly version: 1;
  readonly sourceModel: string;
  readonly sourceModelHash: string;
  readonly exports: readonly ManifestExport[];
}
