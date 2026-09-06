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
 * The model is serialized to YAML, its ids are canonicalized, and the
 * result is hashed with SHA-256. Returns the hex digest.
 *
 * Ids are canonicalized because they are not all authored: every
 * constraint without an `id` in the source is minted a fresh UUID on
 * load (`FactType`), so two loads of one file serialize differently on
 * every such line and hashed differently -- and `barwise lineage
 * status` reported every export stale on every run for any model with
 * an id-less constraint (barwise-923). Each id string is replaced by
 * its order of first appearance, and every reference to it follows
 * because a reference is the same string. The cost is that renaming an
 * explicit id, with nothing else changed, does not change the hash;
 * lineage guards content, and ids are identity plumbing.
 */
export function hashModel(model: OrmModel): string {
  const serializer = new OrmYamlSerializer();
  const doc: unknown = YAML.parse(serializer.serialize(model));

  const hash = createHash("sha256");
  hash.update(JSON.stringify(canonicalizeIds(doc)));
  return hash.digest("hex");
}

/**
 * Replace every id value, and every string equal to one, with `#n`
 * where n is the id's order of first appearance in document order.
 * Pure over plain YAML data; key order is the serializer's, which is
 * already deterministic.
 */
function canonicalizeIds(doc: unknown): unknown {
  const ids = new Map<string, string>();
  const collect = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(collect);
    } else if (node !== null && typeof node === "object") {
      for (const [key, value] of Object.entries(node)) {
        if (key === "id" && typeof value === "string" && !ids.has(value)) {
          ids.set(value, `#${ids.size + 1}`);
        }
        collect(value);
      }
    }
  };
  const rewrite = (node: unknown): unknown => {
    if (typeof node === "string") return ids.get(node) ?? node;
    if (Array.isArray(node)) return node.map(rewrite);
    if (node !== null && typeof node === "object") {
      return Object.fromEntries(
        Object.entries(node).map(([key, value]) => [key, rewrite(value)]),
      );
    }
    return node;
  };
  collect(doc);
  return rewrite(doc);
}
