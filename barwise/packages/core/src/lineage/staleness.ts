/**
 * Staleness detection: determine which artifacts are out of date after model changes.
 */

import type { OrmModel } from "../model/OrmModel.js";
import { exportsForModel } from "./attribution.js";
import { hashModel } from "./manifest.js";
import type { LineageManifest } from "./types.js";

/**
 * Information about a stale artifact.
 */
export interface StaleArtifact {
  readonly artifact: string;
  readonly format: string;
  readonly exportedAt: string;
  readonly reason: string;
}

/**
 * Staleness report comparing current model against manifest.
 */
export interface StalenessReport {
  readonly staleArtifacts: readonly StaleArtifact[];
  readonly freshArtifacts: readonly string[];
  /**
   * Exports that name no model and that this model does not claim: written
   * before exports named their model, with no sources, or with a source
   * this model no longer holds. Neither fresh nor stale can be said of
   * them; re-exporting from their model records whose they are.
   */
  readonly unattributedArtifacts: readonly string[];
  readonly manifestFound: boolean;
}

/**
 * Check staleness by comparing current model hash against manifest.
 *
 * @param manifest - The lineage manifest (read by the caller), or
 *   undefined when no manifest exists
 * @param model - Current ORM model to check against manifest
 * @param sourceModel - The model's file, relative to the manifest's
 *   directory: only that model's exports are read. Without it every
 *   export is, which is right only when the exports name one model; the
 *   caller checks that with `exportModels`.
 * @returns Staleness report with stale and fresh artifacts
 */
export function checkStaleness(
  manifest: LineageManifest | undefined,
  model: OrmModel,
  sourceModel?: string,
): StalenessReport {
  if (!manifest) {
    return {
      staleArtifacts: [],
      freshArtifacts: [],
      unattributedArtifacts: [],
      manifestFound: false,
    };
  }
  const { own, unattributed } = sourceModel === undefined
    ? { own: manifest.exports, unattributed: [] }
    : exportsForModel(manifest, sourceModel, model);

  const currentHash = hashModel(model);
  const staleArtifacts: StaleArtifact[] = [];
  const freshArtifacts: string[] = [];

  for (const exp of own) {
    // An artifact is stale if its model hash differs from the current model hash
    if (exp.modelHash !== currentHash) {
      staleArtifacts.push({
        artifact: exp.artifact,
        format: exp.format,
        exportedAt: exp.exportedAt,
        reason: `model hash changed from ${exp.modelHash.substring(0, 8)}... to ${
          currentHash.substring(0, 8)
        }...`,
      });
    } else {
      freshArtifacts.push(exp.artifact);
    }
  }

  return {
    staleArtifacts,
    freshArtifacts,
    unattributedArtifacts: unattributed.map((exp) => exp.artifact),
    manifestFound: true,
  };
}
