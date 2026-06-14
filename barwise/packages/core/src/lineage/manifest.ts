/**
 * Lineage manifest logic (pure).
 *
 * Manifests live in .barwise/lineage.yaml adjacent to the source model.
 * Reading and writing that file is the tool layer's job; core only
 * computes the manifest path, serializes/parses the document, hashes
 * models, and merges entries -- no filesystem access.
 */

import { createHash } from "node:crypto";
import * as path from "node:path";
import * as YAML from "yaml";
import type { OrmModel } from "../model/OrmModel.js";
import { OrmYamlSerializer } from "../serialization/OrmYamlSerializer.js";
import type { LineageManifest, ManifestExport } from "./types.js";

const MANIFEST_DIR = ".barwise";
const MANIFEST_FILE = "lineage.yaml";

/**
 * The path to the lineage manifest for a model directory:
 * `<dir>/.barwise/lineage.yaml`. Pure path construction (no I/O); the
 * tool layer reads/writes this file.
 */
export function manifestPath(dir: string): string {
  return path.join(dir, MANIFEST_DIR, MANIFEST_FILE);
}

/** Serialize a lineage manifest to YAML text. */
export function serializeManifest(manifest: LineageManifest): string {
  return YAML.stringify(manifest, { lineWidth: 0 });
}

/** Parse lineage manifest YAML text into a manifest object. */
export function parseManifest(yamlContent: string): LineageManifest {
  return YAML.parse(yamlContent) as LineageManifest;
}

/**
 * Merge a new export entry into a manifest and return the updated
 * manifest. Pure: the caller reads the existing manifest (if any) and
 * writes the result.
 *
 * If the entry's artifact matches an existing export, that export is
 * replaced; otherwise the entry is appended. When no existing manifest
 * is given, a new one is created.
 */
export function updateManifest(
  entry: ManifestExport,
  existingManifest?: LineageManifest,
): LineageManifest {
  if (!existingManifest) {
    return {
      version: 1,
      sourceModel: "",
      sourceModelHash: entry.modelHash,
      exports: [entry],
    };
  }

  const existingIndex = existingManifest.exports.findIndex(
    (exp) => exp.artifact === entry.artifact,
  );

  const newExports: readonly ManifestExport[] = existingIndex >= 0
    ? [
      ...existingManifest.exports.slice(0, existingIndex),
      entry,
      ...existingManifest.exports.slice(existingIndex + 1),
    ]
    : [...existingManifest.exports, entry];

  return {
    ...existingManifest,
    sourceModelHash: entry.modelHash,
    exports: newExports,
  };
}

/**
 * Hash an ORM model to detect staleness.
 *
 * The model is serialized to YAML and then hashed with SHA-256.
 * Returns the hex digest of the hash.
 */
export function hashModel(model: OrmModel): string {
  const serializer = new OrmYamlSerializer();
  const yamlContent = serializer.serialize(model);

  const hash = createHash("sha256");
  hash.update(yamlContent);
  return hash.digest("hex");
}
