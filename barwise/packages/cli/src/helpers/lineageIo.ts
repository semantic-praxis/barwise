/**
 * Lineage manifest filesystem I/O for the CLI.
 *
 * Core keeps the manifest pure (path construction, serialize/parse,
 * merge); the tool layer owns the actual file read and write.
 */

import { type LineageManifest, manifestPath, parseManifest, serializeManifest } from "@barwise/core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Read the lineage manifest for a directory, or undefined if absent. */
export function readManifest(dir: string): LineageManifest | undefined {
  const filePath = manifestPath(dir);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return parseManifest(readFileSync(filePath, "utf-8"));
}

/** Write the lineage manifest for a directory, creating .barwise if needed. */
export function writeManifest(dir: string, manifest: LineageManifest): void {
  const filePath = manifestPath(dir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeManifest(manifest), "utf-8");
}
