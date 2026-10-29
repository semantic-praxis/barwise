/**
 * What every rename surface does around the pure operation, written once
 * here so the CLI, MCP and the editor cannot drift: which files a project
 * rename writes and with what text, and the refusal of a file that is not
 * at the current format. Pure; the surfaces own the reads and the writes.
 */

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
