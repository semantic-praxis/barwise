/**
 * Artifact resolution (pure): given a generated file path and the lineage
 * manifest from the directory that owns it, find the source ORM model and
 * the elements that produced the artifact.
 *
 * The parent-directory walk that locates the manifest, and finding the
 * source model file on disk, live in the tool layer (cli/mcp).
 */

import * as path from "node:path";
import type { LineageManifest, ManifestExport, SourceReference } from "./types.js";

/**
 * Result of resolving an artifact through the lineage manifest.
 */
export interface ArtifactResolution {
  /** Directory containing the .barwise/lineage.yaml manifest. */
  readonly manifestDir: string;
  /** Path to the source ORM model (from manifest.sourceModel). */
  readonly sourceModel: string;
  /** The matching export entry from the manifest. */
  readonly exportEntry: ManifestExport;
  /** Source references from the manifest (ORM elements that produced this artifact). */
  readonly sources: readonly SourceReference[];
}

/**
 * Match a generated artifact path against a manifest's exports.
 *
 * Compares the artifact path against each export entry using absolute
 * path comparison.
 *
 * @param manifest - The lineage manifest read from `manifestDir`
 * @param artifactPath - Absolute or relative path to a generated file
 * @param manifestDir - The directory the manifest was read from
 * @returns Resolution if an export matches the artifact path, else undefined
 */
export function resolveArtifactInManifest(
  manifest: LineageManifest,
  artifactPath: string,
  manifestDir: string,
): ArtifactResolution | undefined {
  const absolutePath = path.resolve(artifactPath);

  const match = manifest.exports.find(
    (exp) => path.resolve(exp.artifact) === absolutePath,
  );
  if (!match) {
    return undefined;
  }

  return {
    manifestDir,
    sourceModel: manifest.sourceModel,
    exportEntry: match,
    sources: match.sources,
  };
}
