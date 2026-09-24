/**
 * Read a kernel .orm.yaml into the handful of views the generators need:
 * entities with their reference schemes, the fact types that bind them,
 * value constraints, subtypes. This is the trial's own reader on
 * purpose: reading the kernel through @barwise/core would let a core
 * bug shape the input meant to test it.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { parse, stringify } from "yaml";

export function readModel(path) {
  return parse(readFileSync(path, "utf8"));
}

export function writeModel(path, doc) {
  writeFileSync(path, stringify(doc, { lineWidth: 0 }));
}

export function objectTypes(doc) {
  return doc.model?.object_types ?? [];
}

export function factTypes(doc) {
  return doc.model?.fact_types ?? [];
}

export function byId(doc) {
  const map = new Map();
  for (const ot of objectTypes(doc)) map.set(ot.id, ot);
  return map;
}

export function byName(doc) {
  const map = new Map();
  for (const ot of objectTypes(doc)) map.set(ot.name, ot);
  return map;
}

export function entities(doc) {
  return objectTypes(doc).filter((ot) => ot.kind === "entity");
}

export function valueTypes(doc) {
  return objectTypes(doc).filter((ot) => ot.kind === "value");
}

/**
 * A relational view of the kernel: one table per entity, one column per
 * binary fact type whose first role is played by the entity and whose
 * other player is a value type (an attribute) or an entity (a foreign
 * key). Ternaries and many-to-many binaries become their own tables.
 * This is the generator's ground truth: what an importer should give back.
 */
export function relationalView(doc) {
  const ids = byId(doc);
  const tables = new Map();
  for (const e of entities(doc)) {
    tables.set(e.id, {
      id: e.id,
      entity: e.name,
      columns: [],
      pk: [],
      fks: [],
      checks: [],
    });
  }
  const supertypeOf = new Map();
  for (const sf of doc.model?.subtype_facts ?? []) supertypeOf.set(sf.subtype, sf.supertype);

  for (const ft of factTypes(doc)) {
    const roles = ft.roles ?? [];
    const players = roles.map((r) => ids.get(r.player));
    if (players.some((p) => !p)) continue;
    const uniq = (ft.constraints ?? []).filter((c) => c.type === "internal_uniqueness");
    const mandatoryRoles = new Set(
      (ft.constraints ?? []).filter((c) => c.type === "mandatory").map((c) => c.role),
    );
    if (roles.length === 2) {
      const [r0, r1] = roles;
      const [p0, p1] = players;
      const single0 = uniq.some((u) => u.roles?.length === 1 && u.roles[0] === r0.id);
      const single1 = uniq.some((u) => u.roles?.length === 1 && u.roles[0] === r1.id);
      const preferred = uniq.find((u) => u.is_preferred);
      if (p0.kind === "entity" && p1.kind === "value" && single0) {
        const t = tables.get(p0.id);
        const col = {
          name: columnName(p1.name),
          valueType: p1,
          factType: ft,
          nullable: !mandatoryRoles.has(r0.id),
          check: p1.value_constraint?.values ?? null,
        };
        t.columns.push(col);
        if (
          preferred
          || p1.name.replace(/[^a-z]/gi, "").toLowerCase()
            === (p0.reference_mode ?? "").replace(/[^a-z]/gi, "").toLowerCase()
        ) {
          t.pk.push(col.name);
        }
        continue;
      }
      if (p0.kind === "entity" && p1.kind === "entity" && single0) {
        const t = tables.get(p0.id);
        const col = {
          name: `${columnName(p1.name)}_id`,
          ref: tables.get(p1.id),
          factType: ft,
          nullable: !mandatoryRoles.has(r0.id),
        };
        t.columns.push(col);
        t.fks.push({ column: col.name, ref: tables.get(p1.id) });
        continue;
      }
      if (p1.kind === "entity" && p0.kind === "entity" && single1) {
        const t = tables.get(p1.id);
        const col = {
          name: `${columnName(p0.name)}_id`,
          ref: tables.get(p0.id),
          factType: ft,
          nullable: !mandatoryRoles.has(r1.id),
        };
        t.columns.push(col);
        t.fks.push({ column: col.name, ref: tables.get(p0.id) });
        continue;
      }
      if (p0.kind === "value" && p1.kind === "entity" && single1) {
        const t = tables.get(p1.id);
        const col = {
          name: columnName(p0.name),
          valueType: p0,
          factType: ft,
          nullable: !mandatoryRoles.has(r1.id),
          check: p0.value_constraint?.values ?? null,
        };
        t.columns.push(col);
        continue;
      }
    }
    // Many-to-many or n-ary: its own table with one column per role.
    const t = {
      id: ft.id,
      entity: null,
      factType: ft,
      columns: [],
      pk: [],
      fks: [],
      checks: [],
    };
    roles.forEach((r, i) => {
      const p = players[i];
      const name = p.kind === "entity" ? `${columnName(p.name)}_id` : columnName(p.name);
      const col = p.kind === "entity"
        ? { name, ref: tables.get(p.id), factType: ft, nullable: false }
        : {
          name,
          valueType: p,
          factType: ft,
          nullable: false,
          check: p.value_constraint?.values ?? null,
        };
      t.columns.push(col);
      if (p.kind === "entity") t.fks.push({ column: name, ref: tables.get(p.id) });
      t.pk.push(name);
    });
    tables.set(ft.id, t);
  }
  // Every entity table needs a key; a subtype inherits its supertype's.
  for (const t of tables.values()) {
    if (t.entity && t.pk.length === 0) {
      const sup = supertypeOf.get(t.id);
      const supTable = sup ? tables.get(sup) : undefined;
      if (supTable && supTable.pk.length) {
        const col = {
          name: `${columnName(supTable.entity)}_id`,
          ref: supTable,
          nullable: false,
          inherited: true,
        };
        t.columns.unshift(col);
        t.fks.push({ column: col.name, ref: supTable });
        t.pk.push(col.name);
      } else {
        const col = {
          name: `${columnName(t.entity)}_id`,
          valueType: { name: "Id", data_type: { name: "text" } },
          nullable: false,
          synthetic: true,
        };
        t.columns.unshift(col);
        t.pk.push(col.name);
      }
    }
  }
  return [...tables.values()];
}

export function columnName(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^A-Za-z0-9]+/g, "_").toLowerCase();
}

export function tableName(t) {
  return t.entity ? columnName(t.entity) : columnName(t.factType.name);
}
