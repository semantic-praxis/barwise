/**
 * Lineage manifest filesystem I/O for the MCP server.
 *
 * Core keeps the manifest pure (path construction, parse, match); the
 * tool layer owns the file read, the parent-directory walk that locates
 * the manifest, and finding the source model file on disk.
 */

import {
  type ArtifactResolution,
  type LineageManifest,
  manifestPath,
  parseManifest,
  resolveArtifactInManifest,
} from "@barwise/core/lineage";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, parse, resolve } from "node:path";

/** Read the lineage manifest for a directory, or undefined if absent. */
export function readManifest(dir: string): LineageManifest | undefined {
  const filePath = manifestPath(dir);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return parseManifest(readFileSync(filePath, "utf-8"));
}

/**
 * Resolve a generated artifact path back to its source model by walking
 * up parent directories for a `.barwise/lineage.yaml` manifest and
 * matching the artifact against its exports.
 */
export function resolveArtifact(
  artifactPath: string,
): ArtifactResolution | undefined {
  const absolutePath = resolve(artifactPath);
  let currentDir = dirname(absolutePath);
  const root = parse(currentDir).root;

  while (currentDir !== root) {
    const manifest = readManifest(currentDir);
    if (manifest) {
      const resolution = resolveArtifactInManifest(manifest, artifactPath, currentDir);
      if (resolution) {
        return resolution;
      }
    }
    const parentDir = dirname(currentDir);
    if (parentDir === currentDir) break;
    currentDir = parentDir;
  }

  return undefined;
}

/**
 * Find the ORM model file (.orm.yaml) in a directory, using the manifest's
 * source model path if given, else scanning for a `.orm.yaml` file.
 */
export function findOrmModel(
  dir: string,
  manifestSourceModel?: string,
): string | undefined {
  if (manifestSourceModel) {
    const fullPath = isAbsolute(manifestSourceModel)
      ? manifestSourceModel
      : join(dir, manifestSourceModel);
    if (existsSync(fullPath)) {
      return fullPath;
    }
  }

  try {
    const ormFile = readdirSync(dir).find((e) => e.endsWith(".orm.yaml"));
    if (ormFile) {
      return join(dir, ormFile);
    }
  } catch {
    // Directory not readable -- ignore.
  }

  return undefined;
}
