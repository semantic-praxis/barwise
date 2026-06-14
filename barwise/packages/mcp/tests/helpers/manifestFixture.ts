/**
 * Test-only helper to write a lineage manifest fixture to disk.
 *
 * The MCP server only reads manifests in production, so there is no
 * production writeManifest in this package; the tool tests need one to
 * set up fixtures.
 */

import { type LineageManifest, manifestPath, serializeManifest } from "@barwise/core";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Write a lineage manifest to `<dir>/.barwise/lineage.yaml`. */
export function writeManifest(dir: string, manifest: LineageManifest): void {
  const filePath = manifestPath(dir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeManifest(manifest), "utf-8");
}
