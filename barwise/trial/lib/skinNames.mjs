/**
 * An import's names, mapped back to the kernel's through the skin that
 * renamed them (docs/specs/trial-skin-name-mapping.spec.md).
 *
 * A persona's checks name kernel concepts; a skinned DDL artifact spells
 * them its own way (`SGBSTDN` for Student, `pc_policy` for Policy, an
 * 8-character truncation), and the import names each object type after
 * the physical name. Grading the import as it stands measured whether it
 * guessed a vendor dictionary, which nothing can. This runs the skin's
 * naming forward over every kernel name -- through `skinNamer`, the
 * function the generator wrote the artifact with -- and renames each
 * imported object type whose name is that spelling, so the checks grade
 * the structure the import recovered. Forward, because the rules are not
 * invertible: a truncated name cannot be expanded back.
 */
import { skinNamer } from "./generators/ddl.mjs";
import { columnName } from "./model.mjs";

/**
 * Case and separators dropped: what is left of a physical name once the
 * importer has turned `GRADUATE_SGBSTDN` into `GraduateSgbstdn`.
 */
const key = (name) => name.toLowerCase().replace(/[\s\-_.]/g, "");

/**
 * The renames, as `importedName -> kernelName`. An entity is spelled as
 * the skin writes its table, a value type as the skin writes a column
 * named after it. A spelling two kernel concepts share, or two imported
 * object types share, maps nothing: guessing between them would grade a
 * concept the import never named. So does a kernel name the import
 * already uses, which needs no mapping and must not be taken twice.
 */
export function skinRenames(kernelDoc, skin, importedDoc) {
  const namer = skinNamer(skin);
  const kernel = kernelDoc.model?.object_types ?? [];
  const imported = importedDoc.model?.object_types ?? [];
  const spelledAs = new Map();
  for (const ot of kernel) {
    const raw = columnName(ot.name);
    const k = key(ot.kind === "entity" ? namer.table(raw) : namer.column(raw));
    spelledAs.set(k, spelledAs.has(k) && spelledAs.get(k) !== ot.name ? null : ot.name);
  }
  const importedNames = new Set(imported.map((ot) => ot.name));
  const byKey = new Map();
  for (const ot of imported) {
    const k = key(ot.name);
    byKey.set(k, byKey.has(k) ? null : ot.name);
  }
  const renames = new Map();
  for (const [k, importedName] of byKey) {
    const kernelName = spelledAs.get(k);
    if (!importedName || !kernelName || importedName === kernelName) continue;
    if (importedNames.has(kernelName)) continue;
    renames.set(importedName, kernelName);
  }
  return renames;
}

/**
 * The imported document with each rename applied: the kernel name
 * becomes the object type's name, and the name the import gave it stays
 * as an alias. Readings name players by position, so they follow.
 */
export function renameImported(importedDoc, renames) {
  const copy = structuredClone(importedDoc);
  for (const ot of copy.model?.object_types ?? []) {
    const to = renames.get(ot.name);
    if (!to) continue;
    ot.aliases = [...new Set([...(ot.aliases ?? []), ot.name])];
    ot.name = to;
  }
  return copy;
}
