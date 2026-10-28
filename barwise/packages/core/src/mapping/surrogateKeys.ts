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
 * The schema with generated keys. Its input is not modified, and a schema
 * with no table keyed on several columns comes back as it was.
 */
export function withSurrogateKeys(schema: RelationalSchema): RelationalSchema {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const { generated, collapsed } = decide(schema.tables, byName);
  if (generated.size === 0) return schema;
  return {
    ...schema,
    tables: schema.tables.map((t) =>
      rewrite(t, generated, collapsed.get(t.name) ?? new Set(), byName)
    ),
  };
}

/** Whether a foreign key's columns are all in its table's key. */
function inKey(fk: ForeignKey, table: Table): boolean {
  return fk.columnNames.every((c) => table.primaryKey.columnNames.includes(c));
}

/**
 * Which tables get a generated key, and for each table the references in
 * its key that collapse to one column. A table is decided after every
 * table its key references, since a key that is one reference to a table
 * with a generated key collapses to one column and needs none of its own.
 * A cycle of key references comes only from an invalid model; its tables
 * are decided in declaration order, and a reference to one not yet
 * decided is left as it is.
 */
function decide(
  tables: readonly Table[],
  byName: ReadonlyMap<string, Table>,
): { generated: Set<string>; collapsed: Map<string, Set<ForeignKey>>; } {
  const generated = new Set<string>();
  const collapsed = new Map<string, Set<ForeignKey>>();
  const done = new Set<string>();
  const visiting = new Set<string>();
  const visit = (table: Table): void => {
    if (done.has(table.name) || visiting.has(table.name)) return;
    visiting.add(table.name);
    const fold = new Set<ForeignKey>();
    for (const fk of table.foreignKeys) {
      const target = byName.get(fk.referencedTable);
      if (!target || target === table || !inKey(fk, table)) continue;
      visit(target);
      if (done.has(target.name) && generated.has(target.name)) fold.add(fk);
    }
    const folded = new Set([...fold].flatMap((fk) => fk.columnNames));
    const width = table.primaryKey.columnNames.filter((c) => !folded.has(c)).length + fold.size;
    collapsed.set(table.name, fold);
    if (width > 1) generated.add(table.name);
    visiting.delete(table.name);
    done.add(table.name);
  };
  for (const table of tables) visit(table);
  return { generated, collapsed };
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
  generated: ReadonlySet<string>,
  collapsedKeyRefs: ReadonlySet<ForeignKey>,
  byName: ReadonlyMap<string, Table>,
): Table {
  const columns: Column[] = [...table.columns];
  let key = [...table.primaryKey.columnNames];
  const foreignKeys: ForeignKey[] = [];
  const keyName = (name: string) => `${name}_key`;
  // The table's own generated key is named first, so a reference to the
  // table itself cannot take its name.
  const own = generated.has(table.name) ? generatedKeyName(table) : undefined;
  const reserved = own ? [{ name: own } as Column] : [];

  for (const fk of table.foreignKeys) {
    const target = byName.get(fk.referencedTable);
    // A reference in the key that the decision did not collapse (one in a
    // cycle) is left as it is, so the key's width matches the decision.
    const rewritten = target && generated.has(target.name)
      && (!inKey(fk, table) || collapsedKeyRefs.has(fk));
    if (!rewritten) {
      foreignKeys.push(fk);
      continue;
    }
    const replaced = columns.filter((c) => fk.columnNames.includes(c.name));
    const name = freeColumnName(
      [...columns, ...reserved],
      `${rolePrefix(fk)}${keyName(target.name)}`,
    );
    const at = columns.findIndex((c) => fk.columnNames.includes(c.name));
    columns.splice(at < 0 ? columns.length : at, 0, {
      name,
      dataType: SURROGATE_KEY_TYPE,
      dataTypeDefaulted: false,
      nullable: replaced.some((c) => c.nullable),
      generatedFrom: [...fk.columnNames],
    });
    foreignKeys.push({
      columnNames: [name],
      referencedTable: target.name,
      referencedColumns: [generatedKeyName(target)],
      ...(fk.sourceConstraintId ? { sourceConstraintId: fk.sourceConstraintId } : {}),
    });
    if (fk.columnNames.every((c) => key.includes(c))) {
      const first = key.findIndex((c) => fk.columnNames.includes(c));
      key = key.filter((c) => !fk.columnNames.includes(c));
      key.splice(first, 0, name);
    }
  }

  if (own === undefined) {
    return { ...table, columns, primaryKey: { columnNames: key }, foreignKeys };
  }
  // Hashed from source columns only: a generated reference column is
  // computed in the same SELECT, which cannot read its own alias.
  const natural = key.flatMap((c) => columns.find((col) => col.name === c)?.generatedFrom ?? [c]);
  const name = own;
  return {
    ...table,
    columns: [
      {
        name,
        dataType: SURROGATE_KEY_TYPE,
        dataTypeDefaulted: false,
        nullable: false,
        generatedFrom: natural,
      },
      ...columns,
    ],
    primaryKey: { columnNames: [name] },
    foreignKeys,
    naturalKey: natural,
  };
}

/**
 * The generated key's name in a table that gets one: `<table>_key`, or a
 * free variant against the table's own columns. Both the table and every
 * reference to it ask this, so they agree.
 */
function generatedKeyName(table: Table): string {
  return freeColumnName(table.columns, `${table.name}_key`);
}
