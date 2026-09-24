/**
 * The 1.1 -> 2.0 migration: diagram references move from element names to
 * element ids (`docs/specs/diagram-references-by-id.spec.md`).
 *
 * Runs on the raw parsed document, before schema validation, so every
 * field is read defensively: a malformed document passes through with its
 * diagrams untouched and the schema reports the fault as it always has.
 *
 * A reference that matches no name is kept verbatim. Dropping it would
 * erase the only evidence that the file carried a broken reference;
 * keeping it lets `structural/diagram-dangling-reference` report it.
 */

type Doc = Record<string, unknown>;

/** name -> id for the entries of one raw element list. */
function nameToId(list: unknown): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(list)) return map;
  for (const entry of list) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, name } = entry as Doc;
    if (typeof id === "string" && typeof name === "string" && !map.has(name)) {
      map.set(name, id);
    }
  }
  return map;
}

function rekey(
  record: unknown,
  resolve: (name: string) => string,
): unknown {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return record;
  const out: Doc = {};
  for (const [key, value] of Object.entries(record as Doc)) {
    out[resolve(key)] = value;
  }
  return out;
}

export function migrateDiagramReferencesToIds(doc: Doc): Doc {
  const model = doc.model;
  if (typeof model !== "object" || model === null) return { ...doc, orm_version: "2.0" };
  const m = model as Doc;
  const diagrams = m.diagrams;
  if (!Array.isArray(diagrams)) return { ...doc, orm_version: "2.0" };

  const objectTypes = nameToId(m.object_types);
  const factTypes = nameToId(m.fact_types);
  // `elements` lists object types; `positions` holds object types and fact
  // types, object types first (the order the 1.x resolver in
  // DiagramSession.seedOverridesFromSavedLayout used); `orientations`
  // holds fact types only.
  const ot = (name: string) => objectTypes.get(name) ?? name;
  const either = (name: string) => objectTypes.get(name) ?? factTypes.get(name) ?? name;
  const ft = (name: string) => factTypes.get(name) ?? name;

  const migrated = diagrams.map((d) => {
    if (typeof d !== "object" || d === null) return d;
    const layout = { ...(d as Doc) };
    if (Array.isArray(layout.elements)) {
      layout.elements = layout.elements.map((e) => (typeof e === "string" ? ot(e) : e));
    }
    if ("positions" in layout) layout.positions = rekey(layout.positions, either);
    if ("orientations" in layout) layout.orientations = rekey(layout.orientations, ft);
    return layout;
  });

  return { ...doc, orm_version: "2.0", model: { ...m, diagrams: migrated } };
}
