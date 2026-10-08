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
 * key). Ternaries and many-to-many binaries become their own tables, and
 * an objectified fact type becomes its entity's table, keyed on the fact
 * type's uniqueness (trial-generator-objectification.spec.md).
 * This is the generator's ground truth: what an importer should give back.
 *
 * Each column records the roles it holds (`roles`), so an external
 * uniqueness can find its columns, and the role name it is renamed by
 * (`role`) when another column of its table has the same name.
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
      uniques: [],
    });
  }
  const supertypeOf = new Map();
  for (const sf of doc.model?.subtype_facts ?? []) supertypeOf.set(sf.subtype, sf.supertype);
  const ftById = new Map(factTypes(doc).map((ft) => [ft.id, ft]));
  const objectifier = new Map();
  for (const o of doc.model?.objectified_fact_types ?? []) {
    if (ftById.has(o.fact_type) && tables.has(o.object_type)) {
      objectifier.set(o.fact_type, o.object_type);
    }
  }
  const uniquenesses = (ft) =>
    (ft.constraints ?? []).filter((c) => c.type === "internal_uniqueness");

  // The columns that reference an entity's table. A table keyed on more
  // than one column -- an objectification, settled first -- is referenced
  // by one column per key column, each naming the column it references;
  // any other table by one column, whose referenced column the generators
  // read from the table's key once every key is settled.
  const referenceColumns = (ref, base, extra) =>
    ref.settled && ref.pk.length > 1
      ? ref.pk.map((k) => ({ name: `${base}_${k}`, ref, refColumn: k, ...extra }))
      : [{ name: `${base}_id`, ref, ...extra }];

  // Two columns of one table may not share a name: every self-reference
  // and every pair of roles with one player used to write the same column
  // twice (barwise-rlv). A column from a role is renamed after that role;
  // one already in the key keeps its name, since another table may have
  // been built against it.
  const renamed = (col, n) => `${columnName(col.role)}_${n}`;
  const renameClash = (t, name) => {
    const clash = t.columns.find((c) => c.name === name);
    if (!clash?.role || clash.renamedByRole || t.pk.includes(name)) return;
    clash.name = renamed(clash, name);
    clash.renamedByRole = true;
    for (const fk of t.fks) fk.columns = fk.columns.map((c) => (c === name ? clash.name : c));
  };
  const addColumns = (t, cols) => {
    for (const col of cols) {
      const clash = t.columns.find((c) => c.name === col.name);
      renameClash(t, col.name);
      if (clash && col.role) {
        col.name = renamed(col, col.name);
        col.renamedByRole = true;
      }
      t.columns.push(col);
    }
    const fkCols = cols.filter((c) => c.ref);
    if (fkCols.length) t.fks.push({ columns: fkCols.map((c) => c.name), ref: fkCols[0].ref });
    return cols.map((c) => c.name);
  };

  // An objectification first, its players' objectifications before it
  // (C04's Fulfillment objectifies a fact type OrderLine plays in), since
  // its key decides how every other table references it.
  const settle = (ftId, visiting = new Set()) => {
    const t = tables.get(objectifier.get(ftId));
    if (t.settled || visiting.has(ftId)) return;
    visiting.add(ftId);
    const ft = ftById.get(ftId);
    const roles = ft.roles ?? [];
    for (const r of roles) {
      for (const [other, entityId] of objectifier) {
        if (entityId === r.player) settle(other, visiting);
      }
    }
    const players = roles.map((r) => ids.get(r.player));
    const repeated = (p) => players.filter((q) => q === p).length > 1;
    const roleColumns = new Map();
    roles.forEach((r, i) => {
      const p = players[i];
      if (!p) return;
      const extra = { factType: ft, roles: [r.id], role: r.role_name, nullable: false };
      const base = repeated(p)
        ? `${columnName(r.role_name)}_${columnName(p.name)}`
        : columnName(p.name);
      const cols = p.kind === "entity"
        ? referenceColumns(tables.get(p.id), base, extra)
        : [{ name: base, valueType: p, check: p.value_constraint?.values ?? null, ...extra }];
      roleColumns.set(r.id, addColumns(t, cols));
    });
    const chosen = uniquenesses(ft).find((u) => u.is_preferred) ?? uniquenesses(ft)[0];
    const keyed = (chosen?.roles ?? []).flatMap((id) => roleColumns.get(id) ?? []);
    t.pk.push(...(keyed.length ? keyed : [...roleColumns.values()].flat()));
    t.objectifies = ft;
    t.settled = true;
  };
  for (const ftId of objectifier.keys()) settle(ftId);

  for (const ft of factTypes(doc)) {
    if (objectifier.has(ft.id)) continue;
    const roles = ft.roles ?? [];
    const players = roles.map((r) => ids.get(r.player));
    if (players.some((p) => !p)) continue;
    const uniq = uniquenesses(ft);
    const mandatoryRoles = new Set(
      (ft.constraints ?? []).filter((c) => c.type === "mandatory").map((c) => c.role),
    );
    if (roles.length === 2) {
      const [r0, r1] = roles;
      const [p0, p1] = players;
      const single0 = uniq.some((u) => u.roles?.length === 1 && u.roles[0] === r0.id);
      const single1 = uniq.some((u) => u.roles?.length === 1 && u.roles[0] === r1.id);
      const preferred = uniq.find((u) => u.is_preferred);
      const both = [r0.id, r1.id];
      if (p0.kind === "entity" && p1.kind === "value" && single0) {
        const t = tables.get(p0.id);
        const col = {
          name: columnName(p1.name),
          valueType: p1,
          factType: ft,
          roles: both,
          role: r0.role_name,
          nullable: !mandatoryRoles.has(r0.id),
          check: p1.value_constraint?.values ?? null,
        };
        addColumns(t, [col]);
        if (
          preferred
          || p1.name.replace(/[^a-z]/gi, "").toLowerCase()
            === (p0.reference_mode ?? "").replace(/[^a-z]/gi, "").toLowerCase()
        ) {
          // An objectification is keyed on its roles; its own identifier
          // is still an identifier, so it is unique.
          if (t.objectifies) t.uniques.push([col.name]);
          else t.pk.push(col.name);
        }
        continue;
      }
      // A reference to the table's own entity is named after its role
      // wherever it lands: `determination_case_id` inside Determination's
      // own table would read as its key.
      const self = p0.id === p1.id;
      if (p0.kind === "entity" && p1.kind === "entity" && single0) {
        addColumns(
          tables.get(p0.id),
          referenceColumns(
            tables.get(p1.id),
            self ? `${columnName(r0.role_name)}_${columnName(p1.name)}` : columnName(p1.name),
            {
              factType: ft,
              roles: both,
              role: r0.role_name,
              nullable: !mandatoryRoles.has(r0.id),
            },
          ),
        );
        continue;
      }
      if (p1.kind === "entity" && p0.kind === "entity" && single1) {
        addColumns(
          tables.get(p1.id),
          referenceColumns(
            tables.get(p0.id),
            self ? `${columnName(r1.role_name)}_${columnName(p0.name)}` : columnName(p0.name),
            {
              factType: ft,
              roles: both,
              role: r1.role_name,
              nullable: !mandatoryRoles.has(r1.id),
            },
          ),
        );
        continue;
      }
      if (p0.kind === "value" && p1.kind === "entity" && single1) {
        addColumns(tables.get(p1.id), [{
          name: columnName(p0.name),
          valueType: p0,
          factType: ft,
          roles: both,
          role: r1.role_name,
          nullable: !mandatoryRoles.has(r1.id),
          check: p0.value_constraint?.values ?? null,
        }]);
        continue;
      }
    }
    // Many-to-many or n-ary: its own table with one column per role (more
    // than one for a role whose player is keyed on several).
    const t = {
      id: ft.id,
      entity: null,
      factType: ft,
      columns: [],
      pk: [],
      fks: [],
      checks: [],
      uniques: [],
    };
    const repeated = (p) => players.filter((q) => q === p).length > 1;
    const roleColumns = roles.map((r, i) => {
      const p = players[i];
      const extra = { factType: ft, roles: [r.id], role: r.role_name, nullable: false };
      const base = repeated(p)
        ? `${columnName(r.role_name)}_${columnName(p.name)}`
        : columnName(p.name);
      return addColumns(
        t,
        p.kind === "entity"
          ? referenceColumns(tables.get(p.id), base, extra)
          : [{ name: base, valueType: p, check: p.value_constraint?.values ?? null, ...extra }],
      );
    });
    // Keyed on the fact type's preferred (else first) uniqueness, else on
    // every role. It was every role whatever the kernel said, so C06's
    // "Shipment travels Leg on Vehicle", unique on shipment and leg, was
    // written with a key that allows two vehicles for one leg, and the
    // acceptance check for that rule graded an artifact that never stated
    // it (barwise-1077 triage).
    const chosen = uniq.find((u) => u.is_preferred) ?? uniq[0];
    const keyed = chosen
      ? roles.flatMap((r, i) => ((chosen.roles ?? []).includes(r.id) ? roleColumns[i] : []))
      : [];
    t.pk.push(...(keyed.length ? keyed : roleColumns.flat()));
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
        renameClash(t, col.name);
        t.columns.unshift(col);
        t.fks.push({ columns: [col.name], ref: supTable });
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
  // A combination of an entity's attributes that is unique -- an external
  // uniqueness whose roles all became columns of one table -- is that
  // table's UNIQUE clause. The generator used to write none, so an
  // acceptance check for "the combination of Study, Site and SubjectNumber
  // is unique" graded an artifact that never stated it (barwise-1077).
  const columnsOfRole = new Map();
  for (const t of tables.values()) {
    for (const col of t.columns) {
      for (const r of col.roles ?? []) {
        const at = columnsOfRole.get(r) ?? { table: t, columns: [] };
        at.columns.push(col.name);
        columnsOfRole.set(r, at);
      }
    }
  }
  for (const ft of factTypes(doc)) {
    for (const c of ft.constraints ?? []) {
      // A deontic uniqueness is an obligation a row may break: an enforced
      // UNIQUE would reject what the model allows (PR #601 review).
      if (c.type !== "external_uniqueness" || c.modality === "deontic") continue;
      const at = (c.roles ?? []).map((id) => columnsOfRole.get(id));
      if (at.length < 2 || at.some((x) => !x) || at.some((x) => x.table !== at[0].table)) continue;
      at[0].table.uniques.push(at.flatMap((x) => x.columns));
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
