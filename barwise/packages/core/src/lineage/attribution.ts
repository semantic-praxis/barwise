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
 * One model's exports, the exports nobody is known to own, and the exports
 * naming a model file that is gone. An export names its model, or names
 * none and is claimed by `model` when one is given. One naming another
 * model is that model's, unless `presentModels` is given and does not
 * hold it: then its model was renamed, moved or deleted, and leaving it out
 * would let the renamed model's stale artifacts pass as no artifacts at
 * all.
 */
export function exportsForModel(
  manifest: LineageManifest,
  sourceModel: string,
  model?: OrmModel,
  presentModels?: readonly string[],
): {
  readonly own: readonly ManifestExport[];
  readonly unattributed: readonly ManifestExport[];
  readonly orphaned: readonly ManifestExport[];
} {
  const own: ManifestExport[] = [];
  const unattributed: ManifestExport[] = [];
  const orphaned: ManifestExport[] = [];
  for (const exp of manifest.exports) {
    if (exp.sourceModel === sourceModel) own.push(exp);
    else if (exp.sourceModel !== undefined) {
      if (presentModels && !presentModels.includes(exp.sourceModel)) orphaned.push(exp);
    } else if (model && claimsExport(model, exp)) own.push(exp);
    else unattributed.push(exp);
  }
  return { own, unattributed, orphaned };
}

/**
 * The manifest with every export `model` claims stamped with its
 * `sourceModel`, so the first write after exports began naming their model
 * records the attribution. Exports it does not claim are left as they are.
 */
export function claimExports(
  manifest: LineageManifest,
  sourceModel: string,
  model: OrmModel,
): LineageManifest {
  return {
    ...manifest,
    exports: manifest.exports.map((exp) =>
      claimsExport(model, exp) ? { ...exp, sourceModel } : exp
    ),
  };
}
