/**
 * Comparing table and column names the way two DDL rules need to: the
 * subtype rule of key-reference-tables.spec.md, which asks whether a
 * child table's name ends in its parent's head noun, and the reference
 * inference of reference-inference.spec.md, which asks whether a column
 * names a table. Both specs require the same answer for the same names,
 * so the number rule lives here once rather than in each (CLAUDE.md: a
 * must-agree copy is shared, never restated; PR #620 review).
 */

/**
 * A name without its quoting and schema: `"CBS"."PARTY"`, `[PARTY]` and
 * `` `party` `` are all `party`.
 */
export function bareName(name: string): string {
  const unqualified = name.split(".").pop() ?? name;
  return unqualified.replace(/["`[\]]/g, "").toLowerCase();
}

/** The last `_`-separated word of a table name, lower case: `ENROLLED_SUBJECT` is `subject`. */
export function headNoun(tableName: string): string {
  const words = bareName(tableName).split("_").filter((w) => w.length > 0);
  return words[words.length - 1] ?? "";
}

/**
 * Whether two words are the same up to number, by exactly these endings
 * and no others: `ies` and `y`, `es` and nothing, `s` and nothing. So
 * `categories` is `category`, `statuses` is `status`, `subjects` is
 * `subject`, and an irregular plural such as `people` is only itself.
 * Case is ignored.
 */
export function sameUpToNumber(a: string, b: string): boolean {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return true;
  const plural = (p: string, s: string) =>
    (p.endsWith("ies") && p.slice(0, -3) + "y" === s)
    || p === s + "es"
    || p === s + "s";
  return plural(x, y) || plural(y, x);
}
