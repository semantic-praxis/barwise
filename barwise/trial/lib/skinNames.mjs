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
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { skinNamer } from "./generators/ddl.mjs";
import { columnName, readModel, writeModel } from "./model.mjs";

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
 *
 * `declaredTwice` is the physical names the artifact creates more than
 * once. The importer keeps the first such table and drops the rest, so
 * the import shows one object type where the artifact is ambiguous: C10's
 * skin adds vendor tables named SPRIDEN, SFRSTCR and STVTERM beside the
 * generated ones (barwise-rlv), and mapping them graded a schema no
 * database would load as if it were Person, Enrollment and Term (PR #611
 * review).
 */
export function skinRenames(kernelDoc, skin, importedDoc, { declaredTwice = [] } = {}) {
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
  const ambiguous = new Set([...declaredTwice].map(key));
  const renames = new Map();
  for (const [k, importedName] of byKey) {
    if (ambiguous.has(k)) continue;
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

/**
 * The model the acceptance checks grade for one candidate: for an import
 * of a skinned DDL artifact, a renamed copy written beside it; for
 * anything else, the import itself. Returns the path to grade and how
 * many names were mapped, which the step's detail reports.
 */
export function gradedCandidate(customer, gen, label, path, kind) {
  const art = (customer.artifacts ?? []).find((a) => a.id === label);
  if (kind !== "ddl" || !art?.skin) return { path, mapped: 0 };
  const skin = parse(readFileSync(join(customer.dir, art.skin), "utf8")) ?? {};
  const manifestPath = join(gen, `${label}.manifest.json`);
  const tables = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8")).tables ?? []
    : [];
  const seen = new Set();
  const declaredTwice = new Set();
  for (const t of tables) {
    const k = key(t.name);
    if (seen.has(k)) declaredTwice.add(t.name);
    seen.add(k);
  }
  const imported = readModel(path);
  const renames = skinRenames(readModel(customer.kernelPath), skin, imported, { declaredTwice });
  if (renames.size === 0) return { path, mapped: 0 };
  const graded = join(gen, `${label}.graded.orm.yaml`);
  writeModel(graded, renameImported(imported, renames));
  return { path: graded, mapped: renames.size };
}
