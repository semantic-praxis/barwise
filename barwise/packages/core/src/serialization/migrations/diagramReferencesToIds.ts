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
 *
 * One exception: an unmatched key that is spelled like the id a matched
 * name resolves to would land on the same key. The matched reference wins
 * and the unmatched one is dropped, because it pointed at nothing in 1.x
 * and keeping it would overwrite a real position with a stale one that
 * then looks valid.
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

/** A name's id, or undefined when the name matches no element. */
type Resolver = (name: string) => string | undefined;

function rekey(record: unknown, resolve: Resolver): unknown {
  if (typeof record !== "object" || record === null || Array.isArray(record)) return record;
  const entries = Object.entries(record as Doc);
  const out: Doc = {};
  for (const [key, value] of entries) {
    const id = resolve(key);
    if (id !== undefined) out[id] = value;
  }
  for (const [key, value] of entries) {
    if (resolve(key) === undefined && !(key in out)) out[key] = value;
  }
  return out;
}

function reList(list: readonly unknown[], resolve: Resolver): unknown[] {
  const resolved = new Set(
    list.flatMap((e) => (typeof e === "string" && resolve(e) !== undefined ? [resolve(e)] : [])),
  );
  const out: unknown[] = [];
  const seen = new Set<unknown>();
  for (const e of list) {
    if (typeof e !== "string") {
      out.push(e);
      continue;
    }
    const id = resolve(e);
    const key = id ?? e;
    if (id === undefined && resolved.has(e)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
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
  const ot: Resolver = (name) => objectTypes.get(name);
  const either: Resolver = (name) => objectTypes.get(name) ?? factTypes.get(name);
  const ft: Resolver = (name) => factTypes.get(name);

  const migrated = diagrams.map((d) => {
    if (typeof d !== "object" || d === null) return d;
    const layout = { ...(d as Doc) };
    // In 1.x an empty list meant "show every element", which 2.0 spells
    // by leaving the field out; 2.0's [] is an empty view.
    if (Array.isArray(layout.elements) && layout.elements.length === 0) {
      delete layout.elements;
    } else if (Array.isArray(layout.elements)) {
      layout.elements = reList(layout.elements, ot);
    }
    if ("positions" in layout) layout.positions = rekey(layout.positions, either);
    if ("orientations" in layout) layout.orientations = rekey(layout.orientations, ft);
    return layout;
  });

  return { ...doc, orm_version: "2.0", model: { ...m, diagrams: migrated } };
}
