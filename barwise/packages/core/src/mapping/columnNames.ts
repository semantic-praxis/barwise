/**
 * Naming rules for columns. `freeColumnName` names a column a table does
 * not yet have, shared by the relational mapper and `withSurrogateKeys`, so
 * a generated column is named as every other column is
 * (surrogate-key-export.spec.md). `toSnake` is the mapper's case rule.
 */

import type { Column } from "./RelationalSchema.js";

/**
 * `name` when no column holds it; else `alternative` when that is free;
 * else the first of `<stem>_2`, `<stem>_3`, ... that is free, the stem
 * being `alternative` if given. The tail is unbounded, so the function is
 * total.
 */
export function freeColumnName(
  columns: readonly Column[],
  name: string,
  alternative?: string,
): string {
  const taken = new Set(columns.map((c) => c.name));
  if (!taken.has(name)) return name;
  const stem = alternative ?? name;
  let candidate = stem;
  for (let i = 2; taken.has(candidate); i += 1) candidate = `${stem}_${i}`;
  return candidate;
}

/**
 * A name in snake case, as the relational mapper writes column and table
 * names and as it matches an entity's `reference_mode` against a value
 * type's name. `renameInModel` rewrites a reference mode by the same rule,
 * so the two share this one function (iri-identity WS5).
 */
export function toSnake(name: string): string {
  return name
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}
