/**
 * Staleness detection: determine which artifacts are out of date after model changes.
 */

import type { OrmModel } from "../model/OrmModel.js";
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
  readonly manifestFound: boolean;
}

/**
 * Check staleness by comparing current model hash against manifest.
 *
 * @param manifest - The lineage manifest (read by the caller), or
 *   undefined when no manifest exists
 * @param model - Current ORM model to check against manifest
 * @returns Staleness report with stale and fresh artifacts
 */
export function checkStaleness(
  manifest: LineageManifest | undefined,
  model: OrmModel,
): StalenessReport {
  if (!manifest) {
    return {
      staleArtifacts: [],
      freshArtifacts: [],
      manifestFound: false,
    };
  }

  const currentHash = hashModel(model);
  const staleArtifacts: StaleArtifact[] = [];
  const freshArtifacts: string[] = [];

  for (const exp of manifest.exports) {
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
    manifestFound: true,
  };
}
