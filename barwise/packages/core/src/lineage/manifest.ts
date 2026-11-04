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
import { LINEAGE_MANIFEST_VERSION, type LineageManifest, type ManifestExport } from "./types.js";

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

/**
 * Parse lineage manifest YAML text into a manifest object, upgraded to the
 * current version (`upgradeManifest`), so every reader sees the marker on
 * an export written under 3.x ids.
 */
export function parseManifest(yamlContent: string): LineageManifest {
  return upgradeManifest(YAML.parse(yamlContent) as LineageManifest);
}

/**
 * A manifest as version 2 (iri-identity 6e): a version 1 manifest was
 * written by a build before format 4.0, so each of its exports names
 * elements by 3.x ids, and is marked `idsBefore40`. The marker is per
 * export because `updateManifest` keeps every export it does not replace,
 * so one manifest holds both. Any other manifest is returned as it is.
 */
export function upgradeManifest(manifest: LineageManifest): LineageManifest {
  // An empty file parses to null, which every reader takes as no manifest;
  // a version this build does not know is left as written, never relabelled.
  if (manifest === null || typeof manifest !== "object" || manifest.version !== 1) {
    return manifest;
  }
  return {
    ...manifest,
    version: LINEAGE_MANIFEST_VERSION,
    exports: (manifest.exports ?? []).map((exp) =>
      exp.idsBefore40 ? exp : { ...exp, idsBefore40: true }
    ),
  };
}

/**
 * Merge a new export entry into a manifest and return the updated
 * manifest. Pure: the caller reads the existing manifest (if any) and
 * writes the result.
 *
 * If the entry's artifact matches an existing export, that export is
 * replaced; otherwise the entry is appended. When no existing manifest
 * is given, a new one is created.
 *
 * `sourceModel` names the model file relative to the manifest's
 * directory, which is how `resolveArtifact` finds it. It was never
 * passed, so every manifest recorded "" (barwise-ofb). The entry records
 * it too, because a manifest serves every model in its directory and the
 * top-level field names only the last to export (iri-identity 6a).
 */
export function updateManifest(
  given: ManifestExport,
  existingManifest?: LineageManifest,
  sourceModel?: string,
): LineageManifest {
  const entry = sourceModel !== undefined ? { ...given, sourceModel } : given;
  if (!existingManifest) {
    return {
      version: LINEAGE_MANIFEST_VERSION,
      sourceModel: sourceModel ?? "",
      sourceModelHash: entry.modelHash,
      exports: [entry],
    };
  }

  const existing = upgradeManifest(existingManifest);
  const existingIndex = existing.exports.findIndex(
    (exp) => exp.artifact === entry.artifact,
  );

  const newExports: readonly ManifestExport[] = existingIndex >= 0
    ? [
      ...existing.exports.slice(0, existingIndex),
      entry,
      ...existing.exports.slice(existingIndex + 1),
    ]
    : [...existing.exports, entry];

  return {
    ...existing,
    ...(sourceModel !== undefined ? { sourceModel } : {}),
    sourceModelHash: entry.modelHash,
    exports: newExports,
  };
}

/**
 * Hash an ORM model to detect staleness: the serialized model, SHA-256,
 * hex digest. The model's own `namespace` and `imports` are in it; the
 * project file's `iri_base` and contexts are not (iri-identity 6e).
 *
 * Ids used to be canonicalized first, because a constraint without an id
 * took a fresh UUID on every load (barwise-923), and the canonicalization
 * stayed so every recorded hash still matched. Under format 4.0 an id is
 * the element's name or sentence, the same on every load, and a manifest
 * written before 4.0 reads stale anyway (`idsBefore40`), so the hash is
 * of the model as written. A rename now changes the hash, which is right:
 * the names an artifact was generated from have changed.
 */
export function hashModel(model: OrmModel): string {
  const hash = createHash("sha256");
  hash.update(new OrmYamlSerializer().serialize(model));
  return hash.digest("hex");
}

/**
 * The manifest with each source id in `ids` read as its new id, in the
 * exports `sourceModel` made (iri-identity 6e): what a rename does to the
 * lineage it can see. The hash is never restamped, because the artifacts
 * really are stale. Undefined when no source changes, so the caller writes
 * nothing. An export that names another model, or none, is left: whose it
 * is is `attribution.ts`'s question, and a rename does not answer it.
 */
export function renameInManifest(
  manifest: LineageManifest,
  ids: ReadonlyMap<string, string>,
  sourceModel: string,
): LineageManifest | undefined {
  let changed = false;
  const exports = manifest.exports.map((exp) => {
    // A marked export names 3.x ids, which a 4.0 rename map can collide
    // with; it reads stale until re-exported anyway, so it is left.
    if (exp.sourceModel !== sourceModel || exp.idsBefore40) return exp;
    const sources = exp.sources.map((src) => {
      const now = ids.get(src.elementId);
      if (now === undefined || now === src.elementId) return src;
      changed = true;
      return { ...src, elementId: now };
    });
    return sources.some((src, i) => src !== exp.sources[i]) ? { ...exp, sources } : exp;
  });
  return changed ? { ...manifest, exports } : undefined;
}
