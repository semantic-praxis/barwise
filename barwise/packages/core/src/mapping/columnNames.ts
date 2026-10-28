/**
 * The one rule for naming a column a table does not yet have, shared by
 * the relational mapper and `withSurrogateKeys`, so a generated column is
 * named as every other column is (surrogate-key-export.spec.md).
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
