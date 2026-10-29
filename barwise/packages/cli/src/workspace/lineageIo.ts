/**
 * Lineage manifest filesystem I/O for the CLI.
 *
 * Core keeps the manifest pure (path construction, serialize/parse,
 * merge); the tool layer owns the actual file read and write.
 */

import {
  type LineageManifest,
  manifestPath,
  parseManifest,
  serializeManifest,
} from "@barwise/core/lineage";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

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

/** Write the lineage manifest for a directory, creating .barwise if needed. */
export function writeManifest(dir: string, manifest: LineageManifest): void {
  const filePath = manifestPath(dir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeManifest(manifest), "utf-8");
}
