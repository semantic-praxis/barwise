/**
 * A value constraint as a CHECK predicate, and back.
 *
 * The DDL export writes a value type's constraint as
 * `col IN (...)`, `col >= lo`, `col <= hi` or `(col >= lo AND col <= hi)`,
 * joined by OR. The DDL import reads exactly that grammar back, so the two
 * live together and a round-trip test pins them: the import used to read
 * no CHECK at all, and every value constraint the export wrote came back
 * as a bare value type (ddl-round-trip-fixed-point.spec.md, R2).
 */
import type { ValueConstraintDef, ValueRange } from "@barwise/core";

export function renderValuePredicate(
  column: string,
  values: readonly string[],
  ranges:
    | readonly { min?: string; max?: string; minInclusive?: boolean; maxInclusive?: boolean; }[]
    | undefined,
): string {
  const parts: string[] = [];

  if (values.length > 0) {
    parts.push(`${column} IN (${values.map(sqlLiteral).join(", ")})`);
  }

  for (const r of ranges ?? []) {
    const conds: string[] = [];
    if (r.min !== undefined) {
      conds.push(`${column} >${r.minInclusive === false ? "" : "="} ${sqlLiteral(r.min)}`);
    }
    if (r.max !== undefined) {
      conds.push(`${column} <${r.maxInclusive === false ? "" : "="} ${sqlLiteral(r.max)}`);
    }
    if (conds.length === 2) {
      parts.push(`(${conds.join(" AND ")})`);
    } else if (conds.length === 1) {
      parts.push(conds[0]!);
    }
  }

  if (parts.length === 0) return "";
  return parts.length === 1 ? parts[0]! : parts.join(" OR ");
}

/**
 * Render a constraint value as a SQL literal: numeric and boolean
 * values bare, everything else single-quoted with embedded quotes
 * doubled (same convention as core's DEFAULT rendering).
 */
function sqlLiteral(value: string): string {
  if (/^-?\d+(\.\d+)?$/.test(value) || value === "TRUE" || value === "FALSE") {
    return value;
  }
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The value constraint a CHECK predicate states on one column, or
 * undefined when the predicate is anything but the grammar
 * `renderValuePredicate` writes -- another column, a function call, NOT,
 * a LIKE. Undefined means "not read", and the caller says so.
 */
export function parseValuePredicate(
  predicate: string,
): { column: string; constraint: ValueConstraintDef; } | undefined {
  let column: string | undefined;
  const sameColumn = (c: string) => {
    const name = c.toLowerCase();
    if (column === undefined) column = name;
    return column === name;
  };
  const values: string[] = [];
  const ranges: ValueRange[] = [];
  for (const raw of splitTopLevel(predicate.trim(), /\s+OR\s+/i)) {
    const part = stripParens(raw.trim());
    const inList = /^(\w+)\s+IN\s*\(([\s\S]*)\)$/i.exec(part);
    if (inList) {
      const literals = parseLiterals(inList[2]!);
      if (!sameColumn(inList[1]!) || !literals) return undefined;
      values.push(...literals);
      continue;
    }
    const range: { min?: string; max?: string; minInclusive?: boolean; maxInclusive?: boolean; } =
      {};
    for (const cond of splitTopLevel(part, /\s+AND\s+/i)) {
      const cmp = /^(\w+)\s*(>=|<=|>|<)\s*(.+)$/.exec(cond.trim());
      const literal = cmp ? parseLiterals(cmp[3]!) : undefined;
      if (!cmp || !sameColumn(cmp[1]!) || literal?.length !== 1) return undefined;
      if (cmp[2]!.startsWith(">")) {
        if (range.min !== undefined) return undefined;
        range.min = literal[0]!;
        if (cmp[2] === ">") range.minInclusive = false;
      } else {
        if (range.max !== undefined) return undefined;
        range.max = literal[0]!;
        if (cmp[2] === "<") range.maxInclusive = false;
      }
    }
    ranges.push(range);
  }
  if (column === undefined || (values.length === 0 && ranges.length === 0)) return undefined;
  return { column, constraint: ranges.length > 0 ? { values, ranges } : { values } };
}

/** `a, 'b', 'it''s'` as ["a", "b", "it's"], or undefined if not literals. */
function parseLiterals(list: string): string[] | undefined {
  const out: string[] = [];
  const re = /\s*(?:'((?:[^']|'')*)'|(-?\d+(?:\.\d+)?|TRUE|FALSE))\s*(,|$)/iy;
  let at = 0;
  while (at < list.length) {
    re.lastIndex = at;
    const m = re.exec(list);
    if (!m) return undefined;
    out.push(m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]!);
    at = re.lastIndex;
    if (m[3] === "") break;
  }
  return out.length > 0 ? out : undefined;
}

/** Split on a separator that is not inside parentheses or a string. */
function splitTopLevel(text: string, separator: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inString = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'") inString = !inString;
    if (inString) continue;
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0) {
      const m = new RegExp(separator.source, "iy");
      m.lastIndex = i;
      const hit = m.exec(text);
      if (hit) {
        parts.push(text.slice(start, i));
        start = i + hit[0].length;
        i = start - 1;
      }
    }
  }
  parts.push(text.slice(start));
  return parts;
}

/** `(x)` as `x`, when the outer parentheses enclose the whole text. */
function stripParens(text: string): string {
  if (!text.startsWith("(") || !text.endsWith(")")) return text;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    // A quoted `)` is a value, as in `(score >= ')' AND score <= 'z')`.
    if (text[i] === "'") inString = !inString;
    if (inString) continue;
    if (text[i] === "(") depth++;
    else if (text[i] === ")" && --depth === 0 && i < text.length - 1) return text;
  }
  return text.slice(1, -1).trim();
}
