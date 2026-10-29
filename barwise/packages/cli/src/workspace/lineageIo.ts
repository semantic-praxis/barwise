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
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";

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

/** Write the lineage manifest for a directory, creating .barwise if needed. */
export function writeManifest(dir: string, manifest: LineageManifest): void {
  const filePath = manifestPath(dir);
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, serializeManifest(manifest), "utf-8");
}
