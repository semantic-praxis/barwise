import { parse, stringify } from "yaml";
import type { OrmModel } from "../../src/model/OrmModel.js";
import { OrmYamlSerializer } from "../../src/serialization/OrmYamlSerializer.js";
import { subtypeFlagsFromConstraints } from "../../src/serialization/subtypeFlags.js";

const yaml = new OrmYamlSerializer();

type RawConstraint = { id?: string; is_preferred?: boolean; subtype_facts?: string[]; };

/**
 * `model` as a 2.0 file that nests every constraint across fact types under
 * fact type `hostId`, loaded back. A model built in code holds those
 * constraints itself and has no host, and a save writes 3.0, which has no
 * host either; a test of "whichever fact type nests it" goes through the
 * one place nesting still exists, a 2.0 file read by the 2.0 reader
 * (orm-format-3 WS3c and WS4b). So the 3.0 document is restated as 2.0:
 * the model's constraints nested under the host, its constraints over
 * subtypes as flags, and each preferred identifier as an `is_preferred`
 * flag on its constraint.
 */
export function loadNestedUnder(model: OrmModel, hostId: string): OrmModel {
  return yaml.deserialize(stringify(as20Document(model, hostId)));
}

/** The 2.0 document `loadNestedUnder` loads, for a test that edits it first. */
export function as20Document(model: OrmModel, hostId: string): Record<string, any> {
  const doc = parse(yaml.serialize(model));
  doc.orm_version = "2.0";
  const factTypes = (doc.model.fact_types ?? []) as {
    id: string;
    constraints?: RawConstraint[];
  }[];
  const host = factTypes.find((ft) => ft.id === hostId);
  if (!host) throw new Error(`No fact type "${hostId}" to nest under.`);

  const modelLevel = (doc.model.constraints ?? []) as RawConstraint[];
  delete doc.model.constraints;
  const moved = modelLevel.filter((c) => c.subtype_facts === undefined);
  if (moved.length > 0) host.constraints = [...(host.constraints ?? []), ...moved];

  const flags = subtypeFlagsFromConstraints(model.constraints);
  for (const sf of (doc.model.subtype_facts ?? []) as Record<string, unknown>[]) {
    const f = flags.get(sf["id"] as string);
    if (f?.exclusive) sf["is_exclusive"] = true;
    if (f?.exhaustive) sf["is_exhaustive"] = true;
  }

  const byId = new Map<string, RawConstraint>();
  for (const ft of factTypes) for (const c of ft.constraints ?? []) if (c.id) byId.set(c.id, c);
  for (const ot of (doc.model.object_types ?? []) as Record<string, unknown>[]) {
    const ref = ot["preferred_identifier"];
    delete ot["preferred_identifier"];
    const c = typeof ref === "string" ? byId.get(ref) : undefined;
    if (c) c.is_preferred = true;
  }
  return doc;
}
