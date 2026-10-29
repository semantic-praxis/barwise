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
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, parse, resolve } from "node:path";

/** Read the lineage manifest for a directory, or undefined if absent. */
export function readManifest(dir: string): LineageManifest | undefined {
  const filePath = manifestPath(dir);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return parseManifest(readFileSync(filePath, "utf-8"));
}

/**
 * The `.orm.yaml` files beside a manifest, sorted: what lineage reads to
 * tell a renamed model's exports, and whether a model is alone in its
 * directory (`ModelScope`). Empty when the directory cannot be read.
 */
export function modelsBeside(dir: string): string[] {
  try {
    return readdirSync(dir).filter((name) => name.endsWith(".orm.yaml")).sort();
  } catch {
    return [];
  }
}

/**
 * Where a model's lineage lives: the directory of the model's real file,
 * which holds its manifest, and the file's name as that directory lists
 * it. Both come from one real path -- through any symlink, in the case the
 * filesystem stores -- because taking the directory from the link and the
 * name from its target put the manifest beside the link under a name the
 * link's directory does not hold (`checkScope` refuses that).
 */
export function modelLocation(
  path: string,
): { readonly dir: string; readonly sourceModel: string; } {
  const real = realpathSync.native(resolve(path));
  return { dir: dirname(real), sourceModel: basename(real) };
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
