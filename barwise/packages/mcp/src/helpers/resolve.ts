/**
 * Source resolution: determine whether a source string is a file path
 * or inline YAML content, and deserialize accordingly.
 */

import { type OrmModel, OrmYamlSerializer } from "@barwise/core";
import { existsSync, readFileSync } from "node:fs";

const serializer = new OrmYamlSerializer();

/**
 * Resolve a source string to an OrmModel. If the source looks like a
 * file path (no newlines, ends with .yaml/.yml, or file exists on disk),
 * read and deserialize it. Otherwise, treat it as inline YAML content.
 */
export function resolveSource(
  source: string,
  options?: { lenient?: boolean; },
): OrmModel {
  const trimmed = source.trim();

  if (isFilePath(trimmed)) {
    const yaml = readFileSync(trimmed, "utf-8");
    return serializer.deserialize(yaml, options);
  }

  return serializer.deserialize(trimmed, options);
}

/**
 * Read a file as a UTF-8 string. Throws on missing file.
 */
export function readSource(source: string): string {
  const trimmed = source.trim();

  if (isFilePath(trimmed)) {
    return readFileSync(trimmed, "utf-8");
  }

  return trimmed;
}

export function isFilePath(source: string): boolean {
  // Inline YAML will have newlines; file paths won't.
  if (source.includes("\n")) return false;

  // Looks like a YAML file path.
  if (source.endsWith(".yaml") || source.endsWith(".yml")) return true;

  // Check if it actually exists on disk.
  return existsSync(source);
}

export { serializer };
