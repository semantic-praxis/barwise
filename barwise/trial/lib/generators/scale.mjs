/**
 * Amplify a kernel .orm.yaml into a model of k modules: every object
 * type, fact type, subtype fact and objectification duplicated with a
 * module suffix and fresh ids, plus one cross-module fact type per
 * module so the graph is connected (a diagram of k islands is not the
 * layout problem an enterprise model poses). Value types are shared
 * across modules, which is how a real model behaves: one Currency, a
 * thousand facts that use it.
 *
 * Deterministic: same kernel, same k, same output. The result is a
 * valid model if the kernel was.
 */
import { factTypes, objectTypes } from "../model.mjs";

export function scaleModel(doc, k) {
  const out = structuredClone(doc);
  const m = out.model;
  const baseOts = objectTypes(doc);
  const baseFts = factTypes(doc);
  const entityIds = new Set(baseOts.filter((o) => o.kind === "entity").map((o) => o.id));
  m.object_types = [];
  m.fact_types = [];
  m.subtype_facts = [];
  m.objectified_fact_types = [];
  m.populations = [];
  const shared = baseOts.filter((o) => o.kind === "value");
  m.object_types.push(...shared.map((o) => structuredClone(o)));
  const firstEntityOfModule = [];
  for (let i = 0; i < k; i++) {
    const sfx = i === 0 ? "" : `${i + 1}`;
    const rid = (id) => (i === 0 ? id : `${id}-m${i + 1}`);
    const rename = (name) => (i === 0 ? name : `${name}${sfx}`);
    for (const o of baseOts) {
      if (o.kind !== "entity") continue;
      const c = structuredClone(o);
      c.id = rid(o.id);
      c.name = rename(o.name);
      m.object_types.push(c);
    }
    firstEntityOfModule.push(rid(baseOts.find((o) => o.kind === "entity").id));
    for (const ft of baseFts) {
      const c = structuredClone(ft);
      c.id = rid(ft.id);
      c.name = c.name.replace(/[A-Z][A-Za-z0-9]*/g, (w) => {
        const isEntity = baseOts.some((o) => o.kind === "entity" && o.name === w);
        return isEntity ? rename(w) : w;
      });
      if (i > 0 && c.name === ft.name) c.name = `${ft.name} (${i + 1})`;
      for (const r of c.roles ?? []) {
        r.id = rid(r.id);
        if (entityIds.has(r.player)) r.player = rid(r.player);
      }
      for (const con of c.constraints ?? []) {
        if (con.id) con.id = rid(con.id);
        for (const key of ["roles", "subset_roles", "superset_roles", "roles_1", "roles_2"]) {
          if (Array.isArray(con[key])) con[key] = con[key].map(rid);
        }
        for (const key of ["role", "role_1", "role_2"]) {
          if (typeof con[key] === "string") con[key] = rid(con[key]);
        }
      }
      m.fact_types.push(c);
    }
    for (const sf of doc.model.subtype_facts ?? []) {
      m.subtype_facts.push({
        ...sf,
        id: rid(sf.id),
        subtype: rid(sf.subtype),
        supertype: rid(sf.supertype),
      });
    }
    for (const of of doc.model.objectified_fact_types ?? []) {
      m.objectified_fact_types.push({
        ...of,
        id: rid(of.id),
        fact_type: rid(of.fact_type),
        object_type: rid(of.object_type),
      });
    }
    for (const p of doc.model.populations ?? []) {
      m.populations.push({ ...structuredClone(p), id: rid(p.id), fact_type: rid(p.fact_type) });
    }
    // Bridge to the previous module so the whole thing is one graph.
    if (i > 0) {
      const a = firstEntityOfModule[i - 1];
      const b = firstEntityOfModule[i];
      m.fact_types.push({
        id: `ft-bridge-${i + 1}`,
        name: `Bridge ${i} links ${i + 1}`,
        roles: [
          { id: `r-bridge-${i + 1}-a`, player: a, role_name: "links" },
          { id: `r-bridge-${i + 1}-b`, player: b, role_name: "is linked by" },
        ],
        readings: ["{0} links {1}", "{1} is linked by {0}"],
        constraints: [{ type: "internal_uniqueness", roles: [`r-bridge-${i + 1}-a`] }],
      });
    }
  }
  if (!m.subtype_facts.length) delete m.subtype_facts;
  if (!m.objectified_fact_types.length) delete m.objectified_fact_types;
  if (!m.populations.length) delete m.populations;
  return out;
}
