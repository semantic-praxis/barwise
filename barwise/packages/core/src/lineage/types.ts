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
  /**
   * Written under 3.x ids, by a build before format 4.0 (iri-identity 6e,
   * decision 15 as amended): its sources name elements by ids no 4.0 model
   * holds, so it reads stale ("ids changed to 4.0") and impact analysis
   * says it predates 4.0 rather than finding nothing. Set on every export a
   * version 1 manifest held when it is read, from the version, never
   * guessed from the shape of an id.
   */
  readonly idsBefore40?: true;
}

/** The manifest version a 4.0 build writes. */
export const LINEAGE_MANIFEST_VERSION = 2;

/**
 * Complete lineage manifest for a model directory.
 * Stored as .barwise/lineage.yaml adjacent to the source model.
 *
 * `sourceModel` names the model that exported last. It is kept so an
 * older build reads the manifest as before, and it does not say whose an
 * export is: each export names its own.
 */
export interface LineageManifest {
  /** 2 since iri-identity 6e; a version 1 manifest is read as 2 (`upgradeManifest`). */
  readonly version: 1 | 2;
  readonly sourceModel: string;
  readonly sourceModelHash: string;
  readonly exports: readonly ManifestExport[];
}
