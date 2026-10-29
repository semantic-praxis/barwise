/**
 * Which model each export in a lineage manifest belongs to (pure).
 *
 * One `.barwise/lineage.yaml` serves a directory, and `project init` puts
 * every domain in one `domains/` directory, so a manifest can hold the
 * exports of several models. An export records its own `sourceModel`; the
 * manifest's top-level field names whichever model exported last and so
 * cannot say whose an older export is (iri-identity, WS6 6a). An export
 * written before exports named their model is attributed by its sources
 * instead: to a model that holds every source id and owns at least one.
 *
 * Holding is not enough, because `split` gives a shadow its owner's id, so
 * a domain holds the ids of every type it references; a shadow
 * (`sourceContext` set) does not own. Owning one is enough, with one model
 * loaded, because `split` homes each fact type and subtype fact in exactly
 * one domain, so an owned id has one owner. A model copied whole into a
 * second file breaks that, and no rule over one loaded model can tell the
 * copies apart.
 */

import type { OrmModel } from "../model/OrmModel.js";
import type { LineageManifest, ManifestExport } from "./types.js";

/**
 * Whether an export that names no model belongs to this one: the model
 * holds every source id and owns at least one, so an export with no
 * sources is nobody's.
 */
export function claimsExport(model: OrmModel, exp: ManifestExport): boolean {
  if (exp.sourceModel !== undefined) return false;
  let owns = false;
  for (const { elementId } of exp.sources) {
    const held = holding(model, elementId);
    if (held === "none") return false;
    if (held === "owns") owns = true;
  }
  return owns;
}

function holding(model: OrmModel, id: string): "owns" | "shadow" | "none" {
  const ot = model.getObjectType(id);
  if (ot) return ot.sourceContext === undefined ? "owns" : "shadow";
  const held = model.getFactType(id) ?? model.findRole(id) ?? model.getConstraint(id)
    ?? model.getSubtypeFact(id);
  return held ? "owns" : "none";
}

/** The models a manifest's exports name, sorted; an unattributed export names none. */
export function exportModels(manifest: LineageManifest): readonly string[] {
  const named = new Set<string>();
  for (const exp of manifest.exports) {
    if (exp.sourceModel !== undefined) named.add(exp.sourceModel);
  }
  return [...named].sort();
}

/**
 * Which model the lineage commands are reading for, and the model files
 * beside it. The two travel together because neither answers alone: an
 * export naming a file that is no longer there is a renamed or deleted
 * model's, and a model alone in its directory owns every export that names
 * none. Reading the directory is the caller's; core takes the list.
 */
export interface ModelScope {
  /** The model's file, relative to the manifest's directory. */
  readonly sourceModel: string;
  /** The `.orm.yaml` files in the manifest's directory, this one included. */
  readonly modelsBeside: readonly string[];
}

/** Whether the model is the only one its manifest can serve. */
function alone(scope: ModelScope): boolean {
  return scope.modelsBeside.length === 1 && scope.modelsBeside[0] === scope.sourceModel;
}

/**
 * One model's exports, the exports nobody is known to own, and the exports
 * naming a model file that is gone. An export names this model; or names
 * none and is this model's when the model is alone in its directory or
 * claims it; or names another model, which is that model's while its file
 * is there and orphaned once it is not -- leaving it out would let a
 * renamed model's stale artifacts pass as no artifacts at all.
 */
export function exportsForModel(
  manifest: LineageManifest,
  scope: ModelScope,
  model?: OrmModel,
): {
  readonly own: readonly ManifestExport[];
  readonly unattributed: readonly ManifestExport[];
  readonly orphaned: readonly ManifestExport[];
} {
  const own: ManifestExport[] = [];
  const unattributed: ManifestExport[] = [];
  const orphaned: ManifestExport[] = [];
  for (const exp of manifest.exports) {
    if (exp.sourceModel === scope.sourceModel) own.push(exp);
    else if (exp.sourceModel !== undefined) {
      if (!scope.modelsBeside.includes(exp.sourceModel)) orphaned.push(exp);
    } else if (alone(scope) || (model && claimsExport(model, exp))) own.push(exp);
    else unattributed.push(exp);
  }
  return { own, unattributed, orphaned };
}

/**
 * The manifest with every export this model owns but that names no model
 * stamped with its `sourceModel`, and the exports stamped, so the first
 * write after exports began naming their model records the attribution.
 * A model alone in its directory owns them all, sources or none.
 */
export function claimExports(
  manifest: LineageManifest,
  scope: ModelScope,
  model: OrmModel,
): { readonly manifest: LineageManifest; readonly claimed: readonly ManifestExport[]; } {
  const claimed: ManifestExport[] = [];
  const exports = manifest.exports.map((exp) => {
    if (exp.sourceModel !== undefined || !(alone(scope) || claimsExport(model, exp))) return exp;
    claimed.push(exp);
    return { ...exp, sourceModel: scope.sourceModel };
  });
  return { manifest: { ...manifest, exports }, claimed };
}
