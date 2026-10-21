import { parse, stringify } from "yaml";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";

const yaml = new OrmYamlSerializer();

/**
 * `model` as a 2.0 file that nests every constraint across fact types under
 * fact type `hostId`, loaded back. Since WS3c a model built in code holds
 * those constraints itself and has no host, so a test of "whichever fact
 * type nests it" builds the same model on every pass unless it goes through
 * the one place nesting still exists: the file (orm-format-3 WS3c).
 */
export function loadNestedUnder(model: OrmModel, hostId: string): OrmModel {
  const across = new Set(model.constraints.map((c) => c.id));
  const doc = parse(yaml.serialize(model));
  const factTypes = doc.model.fact_types as { id: string; constraints?: { id: string; }[]; }[];
  const moved = factTypes.flatMap((ft) => (ft.constraints ?? []).filter((c) => across.has(c.id)));
  for (const ft of factTypes) {
    const own = (ft.constraints ?? []).filter((c) => !across.has(c.id));
    const list = ft.id === hostId ? [...own, ...moved] : own;
    if (list.length > 0) ft.constraints = list;
    else delete ft.constraints;
  }
  if (!factTypes.some((ft) => ft.id === hostId)) {
    throw new Error(`No fact type "${hostId}" to nest under.`);
  }
  return yaml.deserialize(stringify(doc));
}
