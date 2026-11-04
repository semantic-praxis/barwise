/**
 * Two things every rename surface does around the pure operation, written
 * once here so the CLI, MCP and the editor do not each restate them: which
 * files a project rename writes and with what text, and the refusal of a
 * file that is not at the current format. Each surface still parses its own
 * target arguments, because they arrive differently (strings from a command
 * line, typed values from a tool call). Pure; the surfaces own the reads
 * and the writes.
 */

import { basename, dirname } from "node:path";
import { manifestPath, renameInManifest, serializeManifest } from "../lineage/manifest.js";
import type { LineageManifest } from "../lineage/types.js";
import type { OrmModel } from "../model/OrmModel.js";
import { MappingSerializer } from "../serialization/MappingSerializer.js";
import { OrmYamlSerializer } from "../serialization/OrmYamlSerializer.js";
import { CURRENT_ORM_VERSION } from "../serialization/schemaVersion.js";
import { RenameError } from "./renameInModel.js";
import type { ProjectRenameResult } from "./renameInProject.js";

/** A file a rename writes: its path as the manifest names it, and its text. */
export interface RenameWrite {
  readonly path: string;
  readonly text: string;
}

/**
 * Load a model for renaming, refusing one that is not at the current
 * format. A rename writes the file back at the current format, so renaming
 * an older file would also migrate it, silently: `barwise migrate` reports
 * what reading a 2.x file changed, and refuses a file whose `is_preferred`
 * flags cannot be placed, and a rename that migrated would do neither.
 * Loaded leniently, as `renameInModel` expects.
 *
 * @throws {RenameError} naming the file and its format.
 */
export function modelForRename(yaml: string, label: string): OrmModel {
  const { model, from } = new OrmYamlSerializer().migrate(yaml, { lenient: true });
  if (from !== CURRENT_ORM_VERSION) {
    throw new RenameError(
      `${label} is format ${from}. Run \`barwise migrate\` on it first, which reports what `
        + `migrating it changes, then rename.`,
    );
  }
  return model;
}

/** The files a project rename changed, each with the text to write. */
export function projectRenameWrites(result: ProjectRenameResult): readonly RenameWrite[] {
  const models = new OrmYamlSerializer();
  const mappings = new MappingSerializer();
  return result.files.map((path) => {
    const domain = result.project.domains.find((d) => d.path === path);
    if (domain) return { path, text: models.serialize(domain.model!) };
    const mapping = result.project.mappings.find((m) => m.path === path)!;
    return { path, text: mappings.serialize(mapping) };
  });
}

/**
 * A lineage manifest a rename rewrites (iri-identity 6e): the directory
 * whose `.barwise/lineage.yaml` it is, as the caller names paths, and the
 * ids each model file there changed. One entry per directory, because
 * domains share one and a staged write refuses two writes naming one file.
 */
export interface LineageRename {
  readonly dir: string;
  readonly models: readonly {
    readonly sourceModel: string;
    readonly ids: ReadonlyMap<string, string>;
  }[];
}

/** The lineage a model file's rename rewrites: `path` as the caller names it. */
export function modelLineageRenames(
  path: string,
  ids: ReadonlyMap<string, string>,
): readonly LineageRename[] {
  return ids.size === 0
    ? []
    : [{ dir: dirname(path), models: [{ sourceModel: basename(path), ids }] }];
}

/** The lineage a project rename rewrites, folded by directory. */
export function projectLineageRenames(result: ProjectRenameResult): readonly LineageRename[] {
  const byDir = new Map<string, { sourceModel: string; ids: ReadonlyMap<string, string>; }[]>();
  for (const domain of result.project.domains) {
    const ids = result.ids.get(domain.context);
    if (ids === undefined || ids.size === 0) continue;
    const dir = dirname(domain.path);
    byDir.set(dir, [...(byDir.get(dir) ?? []), { sourceModel: basename(domain.path), ids }]);
  }
  return [...byDir].map(([dir, models]) => ({ dir, models }));
}

/**
 * The manifest with every model's rename applied (`renameInManifest`), or
 * undefined when there is no manifest or nothing in it changes, so the
 * caller writes nothing.
 */
export function renameLineage(
  manifest: LineageManifest | undefined,
  rename: LineageRename,
): LineageManifest | undefined {
  if (manifest === undefined) return undefined;
  let current = manifest;
  let changed = false;
  for (const { sourceModel, ids } of rename.models) {
    const next = renameInManifest(current, ids, sourceModel);
    if (next !== undefined) {
      current = next;
      changed = true;
    }
  }
  return changed ? current : undefined;
}

/**
 * The manifest writes a rename stages, and a line for each (iri-identity
 * 6e): every surface's lineage step, so the CLI and MCP do not each spell
 * it. `read` is the surface's own manifest read, given a directory as the
 * rename names it resolved by `resolveDir`; core reads no file.
 */
export function lineageRenameWrites(
  renames: readonly LineageRename[],
  resolveDir: (dir: string) => string,
  read: (dir: string) => LineageManifest | undefined,
): { readonly writes: readonly RenameWrite[]; readonly changes: readonly string[]; } {
  const writes: RenameWrite[] = [];
  const changes: string[] = [];
  for (const rename of renames) {
    const dir = resolveDir(rename.dir);
    const next = renameLineage(read(dir), rename);
    if (next === undefined) continue;
    const path = manifestPath(dir);
    writes.push({ path, text: serializeManifest(next) });
    changes.push(
      `Rewrote ${path}: its sources name the new ids. The artifacts stay stale until re-exported.`,
    );
  }
  return { writes, changes };
}
