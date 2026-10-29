/**
 * A warehouse's physical key design over a mapped schema: every table
 * keyed on several columns gets one generated key, the hash of its natural
 * key, and every reference to such a table becomes one column, hashed from
 * the natural foreign key columns it keeps beside it
 * (surrogate-key-export.spec.md, barwise-td6).
 *
 * One pure function after the mapper, not a rule inside it: the mapper
 * decides the logical tables from the model, and a generated key is a
 * choice the model does not make. What it changes, the schema states
 * (`Column.generatedFrom`, `Table.naturalKey`), so routing, the renderers
 * and the annotations read it rather than re-deriving it.
 */

import { freeColumnName } from "./columnNames.js";
import type { Column, ForeignKey, RelationalSchema, Table } from "./RelationalSchema.js";

/** The type of a generated key: the MD5 hex digest `generate_surrogate_key` returns. */
export const SURROGATE_KEY_TYPE = "VARCHAR(32)";

/**
 * What an export with generated keys writes in place of its population
 * rows or seeds: barwise computes no hash, so a row would lack its key.
 */
export const SURROGATE_POPULATION_NOTE =
  "Population rows are not written with generated keys: barwise computes no hash, and a\n"
  + "row without its key would violate its table (surrogate-key-export.spec.md).";

/** Whether a schema has a generated column, which a population row cannot fill. */
export function hasGeneratedKeys(schema: RelationalSchema): boolean {
  return schema.tables.some((t) => t.columns.some((c) => c.generatedFrom));
}

/**
 * The schema with generated keys. Its input is not modified, and a schema
 * with no table keyed on several columns comes back as it was.
 */
export function withSurrogateKeys(schema: RelationalSchema): RelationalSchema {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const { changed, generated, collapsed, order } = decide(schema.tables, byName);
  if (changed.size === 0) return schema;
  // Each table in decision order; a rewritten reference names its target's
  // new key once every table has one, since a reference outside the key
  // can point at a table decided later.
  const rewritten = new Map<string, Table>();
  // Each rewritten reference, to the foreign key it replaced.
  const pending = new Map<ForeignKey, ForeignKey>();
  for (const name of order) {
    const table = byName.get(name)!;
    rewritten.set(name, rewrite(table, changed, generated, collapsed.get(name)!, byName, pending));
  }
  const keyOf = (name: string) => rewritten.get(name)!.primaryKey.columnNames[0]!;

  // The columns a changed table's key hashes, in hashing order: a generated
  // key's natural key, or, for a key collapsed to one reference, that
  // reference's hash. A reference hashes its own columns in the order its
  // target's key hashes the columns they stand for, so the two agree
  // whatever order the foreign key listed them in.
  const hashes = new Map<string, readonly string[]>();
  const through = (target: readonly string[], replaced: ForeignKey): readonly string[] => {
    const mapped = target.map((c) => replaced.columnNames[replaced.referencedColumns.indexOf(c)]);
    return mapped.every((c) => c !== undefined) ? mapped as string[] : replaced.columnNames;
  };
  const keyHash = (name: string): readonly string[] => {
    const known = hashes.get(name);
    if (known) return known;
    const table = rewritten.get(name)!;
    const ref = table.foreignKeys.find((fk) =>
      fk.columnNames[0] === keyOf(name) && pending.has(fk)
    );
    const cols = table.naturalKey
      ?? (ref ? through(keyHash(ref.referencedTable), pending.get(ref)!) : []);
    hashes.set(name, cols);
    return cols;
  };

  return {
    ...schema,
    tables: schema.tables.map((t) => {
      const table = rewritten.get(t.name)!;
      const hashOf = new Map(
        table.foreignKeys.filter((fk) => pending.has(fk)).map((fk) => [
          fk.columnNames[0]!,
          through(keyHash(fk.referencedTable), pending.get(fk)!),
        ]),
      );
      return {
        ...table,
        columns: table.columns.map((c) =>
          hashOf.has(c.name) ? { ...c, generatedFrom: [...hashOf.get(c.name)!] } : c
        ),
        foreignKeys: table.foreignKeys.map((fk) =>
          pending.has(fk) ? { ...fk, referencedColumns: [keyOf(fk.referencedTable)] } : fk
        ),
      };
    }),
  };
}

/** Whether a foreign key's columns are all in its table's key. */
function inKey(fk: ForeignKey, table: Table): boolean {
  return fk.columnNames.every((c) => table.primaryKey.columnNames.includes(c));
}

/**
 * Which tables get a generated key, which have their key changed at all
 * (a generated one, or one reference collapsed to its one column: a
 * shared-key subtype of a table with a generated key), and for each table
 * the references in its key that collapse. Every reference to a table
 * whose key changed must become one column, since the old columns are no
 * longer its key. A table is decided after every table its key
 * references. A cycle of key references comes only from an invalid model;
 * its tables are decided in declaration order, and a reference to one not
 * yet decided is left as it is.
 */
function decide(
  tables: readonly Table[],
  byName: ReadonlyMap<string, Table>,
): {
  changed: Set<string>;
  generated: Set<string>;
  collapsed: Map<string, Set<ForeignKey>>;
  order: string[];
} {
  const changed = new Set<string>();
  const generated = new Set<string>();
  const collapsed = new Map<string, Set<ForeignKey>>();
  const order: string[] = [];
  const visiting = new Set<string>();
  const visit = (table: Table): void => {
    if (collapsed.has(table.name) || visiting.has(table.name)) return;
    visiting.add(table.name);
    const fold = new Set<ForeignKey>();
    for (const fk of table.foreignKeys) {
      const target = byName.get(fk.referencedTable);
      if (!target || target === table || !inKey(fk, table)) continue;
      visit(target);
      if (changed.has(target.name)) fold.add(fk);
    }
    const folded = new Set([...fold].flatMap((fk) => fk.columnNames));
    const width = table.primaryKey.columnNames.filter((c) => !folded.has(c)).length + fold.size;
    if (width > 1) generated.add(table.name);
    if (width > 1 || fold.size > 0) changed.add(table.name);
    collapsed.set(table.name, fold);
    visiting.delete(table.name);
    order.push(table.name);
  };
  for (const table of tables) visit(table);
  return { changed, generated, collapsed, order };
}

/**
 * The prefix the mapper put before the referenced key's column names
 * (`origin_` in `origin_building_code`, `origin_room_nr`), or "" when the
 * columns do not share one.
 */
function rolePrefix(fk: ForeignKey): string {
  const prefixes = fk.columnNames.map((c, i) => {
    const ref = fk.referencedColumns[i] ?? "";
    return c.endsWith(ref) ? c.slice(0, c.length - ref.length) : undefined;
  });
  const first = prefixes[0];
  return first !== undefined && prefixes.every((p) => p === first) ? first : "";
}

function rewrite(
  table: Table,
  changed: ReadonlySet<string>,
  generated: ReadonlySet<string>,
  collapsedKeyRefs: ReadonlySet<ForeignKey>,
  byName: ReadonlyMap<string, Table>,
  pending: Map<ForeignKey, ForeignKey>,
): Table {
  const columns: Column[] = [...table.columns];
  let key = [...table.primaryKey.columnNames];
  const foreignKeys: ForeignKey[] = [];
  // The table's own generated key is named first, so a reference to the
  // table itself cannot take its name.
  const own = generated.has(table.name) ? generatedKeyName(table) : undefined;
  const reserved = own ? [{ name: own } as Column] : [];

  for (const fk of table.foreignKeys) {
    const target = byName.get(fk.referencedTable);
    // A reference in the key that the decision did not collapse (one in a
    // cycle) is left as it is, so the key's width matches the decision.
    const rewritten = target && changed.has(target.name)
      && (!inKey(fk, table) || collapsedKeyRefs.has(fk));
    if (!rewritten) {
      foreignKeys.push(fk);
      continue;
    }
    const replaced = columns.filter((c) => fk.columnNames.includes(c.name));
    const name = freeColumnName([...columns, ...reserved], `${rolePrefix(fk)}${target.name}_key`);
    const at = columns.findIndex((c) => fk.columnNames.includes(c.name));
    columns.splice(at < 0 ? columns.length : at, 0, {
      name,
      dataType: SURROGATE_KEY_TYPE,
      dataTypeDefaulted: false,
      nullable: replaced.some((c) => c.nullable),
      // Put in the target's hashing order once every key is settled.
      generatedFrom: [...fk.columnNames],
    });
    const reference: ForeignKey = {
      columnNames: [name],
      referencedTable: target.name,
      referencedColumns: [],
      ...(fk.sourceConstraintId ? { sourceConstraintId: fk.sourceConstraintId } : {}),
    };
    pending.set(reference, fk);
    foreignKeys.push(reference);
    if (fk.columnNames.every((c) => key.includes(c))) {
      const first = key.findIndex((c) => fk.columnNames.includes(c));
      key = key.filter((c) => !fk.columnNames.includes(c));
      key.splice(first, 0, name);
    }
  }

  if (own === undefined) {
    return { ...table, columns, primaryKey: { columnNames: key }, foreignKeys };
  }
  // Hashed from the table's original key, in its order: those are source
  // columns (a generated reference is computed in the same SELECT, which
  // cannot read its own alias), and a reference to this table hashes its
  // columns in this same order (`referencedColumns`), so the two agree.
  const natural = [...table.primaryKey.columnNames];
  return {
    ...table,
    columns: [
      {
        name: own,
        dataType: SURROGATE_KEY_TYPE,
        dataTypeDefaulted: false,
        nullable: false,
        generatedFrom: natural,
      },
      ...columns,
    ],
    primaryKey: { columnNames: [own] },
    foreignKeys,
    naturalKey: natural,
  };
}

/**
 * The generated key's name in a table that gets one: `<table>_key`, or a
 * free variant against the table's own columns.
 */
function generatedKeyName(table: Table): string {
  return freeColumnName(table.columns, `${table.name}_key`);
}
