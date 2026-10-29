/**
 * The names a renderer writes for a table's columns, where its format
 * allows fewer characters than a column name holds. A column named from an
 * unresolved reference mode, such as `(ambiguous)`, made an OpenAPI path
 * and an Avro schema that their parsers refuse (barwise-9g3).
 */

import type { Table } from "../RelationalSchema.js";

/**
 * An Avro name: a letter or `_`, then letters, digits and `_` (Avro 1.11
 * specification, "Names"). A namespace is such names joined by dots, which
 * formats' `avroNames.ts` checks with this one rule.
 */
export const AVRO_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * A valid Avro name from free text. Accents are dropped first and the text
 * is read by code point, so "café" gives "cafe" however it is encoded;
 * every other character outside the alphabet becomes `_`, and a name that
 * would start with a digit or be empty gains a leading `_`. A valid name
 * is returned unchanged.
 */
export function toAvroName(text: string): string {
  if (AVRO_NAME.test(text)) return text;
  const cleaned = [...text.normalize("NFKD").replace(/\p{M}/gu, "")]
    .map((ch) => /[A-Za-z0-9_]/.test(ch) ? ch : "_")
    .join("");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `_${cleaned}`;
}

/**
 * A distinct name for each of `names`. A valid one is kept and reserved
 * first, so a repaired name never takes it whatever the order; a repaired
 * name that is taken, by a kept name, an earlier repair or `taken`, gets
 * `_2`, `_3`, and so on.
 */
export function uniqueNames(
  names: readonly string[],
  isValid: (name: string) => boolean,
  repair: (name: string) => string,
  taken: Iterable<string> = [],
): Map<string, string> {
  const result = new Map(names.filter(isValid).map((n) => [n, n]));
  const used = new Set([...taken, ...result.values()]);
  for (const name of names) {
    if (result.has(name)) continue;
    const base = repair(name);
    let unique = base;
    for (let n = 2; used.has(unique); n++) unique = `${base}_${n}`;
    result.set(name, unique);
    used.add(unique);
  }
  return result;
}

/**
 * Each column's Avro field name. The export's annotations name columns, so
 * the exporter reads this to put a column's notes on its field.
 */
export function avroFieldNames(table: Table): Map<string, string> {
  return uniqueNames(table.columns.map((c) => c.name), (n) => AVRO_NAME.test(n), toAvroName);
}
