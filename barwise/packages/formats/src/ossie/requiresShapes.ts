/**
 * The `requires` expressions barwise recognizes, and their inverses.
 *
 * Ossie's expression language is not parsed here (barwise-pf2.2 owns
 * that). Three shapes are recognized because they are the ones a barwise
 * constraint states exactly, and the pinned example uses all three:
 *
 * - on a value type, an enumeration: `X == 'A' OR X == 'B' ...`, alone
 * - on a value type, a bound: `X >= lo`, `X < hi`, `lo <= X`, one per item,
 *   paired into a range across the concept's items
 * - on an entity type, a bare relationship path `E.rel`: each E plays the
 *   first role of `rel`, a mandatory role
 *
 * Anything else is returned unrecognized, for the caller to keep as text
 * and report. A shape that half-matches (a bound with a non-numeric side)
 * is unrecognized too: a near miss read as a constraint would be a guess.
 */
import type { ValueRange } from "@barwise/core";

export interface ValueShapes {
  /** Enumerated values, in the order written. */
  readonly values: readonly string[];
  /** At most one range, from the bound items; empty beside an enumeration. */
  readonly ranges: readonly ValueRange[];
  /** The items that matched no shape. */
  readonly unrecognized: readonly string[];
  /** Bound items that together admit no value; also in `unrecognized`. */
  readonly contradictory: readonly string[];
}

const IDENT = String.raw`[A-Za-z_][A-Za-z0-9_]*`;
const NUMBER = String.raw`-?\d+(?:\.\d+)?`;
const QUOTED = String.raw`'((?:[^']|'')*)'`;

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read a value type's `requires` items as one value constraint.
 *
 * The items of a `requires` list all hold, but a barwise value constraint
 * is satisfied by a value in its `values` OR in any of its `ranges`. So
 * an enumeration is never combined with another item: `X == '1' OR
 * X == '5'` beside `X >= 3` means {5}, which values [1, 5] plus a range
 * would widen to 1, 3, 4, 5 and up. The first enumeration is the
 * constraint and every other item goes back unrecognized, for the note --
 * a weaker constraint plus the text that narrows it, never a wider one.
 * Bounds alone combine into one range, at most one per side.
 */
export function readValueShapes(concept: string, items: readonly string[]): ValueShapes {
  const name = escape(concept);
  const member = new RegExp(String.raw`^\s*${name}\s*==\s*${QUOTED}\s*$`);
  const right = new RegExp(String.raw`^\s*${name}\s*(<=|>=|<|>)\s*(${NUMBER})\s*$`);
  const left = new RegExp(String.raw`^\s*(${NUMBER})\s*(<=|>=|<|>)\s*${name}\s*$`);

  const enumerated = items.findIndex((item) => enumeration(item, member) !== undefined);
  if (enumerated >= 0) {
    return {
      values: enumeration(items[enumerated]!, member)!,
      ranges: [],
      unrecognized: items.filter((_, i) => i !== enumerated),
      contradictory: [],
    };
  }

  let range: { min?: string; max?: string; minInclusive?: boolean; maxInclusive?: boolean; } = {};
  let ranged = false;
  const unrecognized: string[] = [];
  const bounds: string[] = [];
  for (const item of items) {
    const bound = boundOf(item, right, left);
    const narrowed = bound ? narrow(range, bound) : undefined;
    if (!narrowed) {
      unrecognized.push(item);
      continue;
    }
    range = narrowed;
    ranged = true;
    bounds.push(item);
  }
  // Bounds no value meets (`X >= 10`, `X < 5`) are a mistake in the
  // source, not a constraint: stored, they would refuse every value. They
  // go back as text, like any other near miss.
  if (ranged && empty(range)) {
    return { values: [], ranges: [], unrecognized: [...items], contradictory: bounds };
  }
  return { values: [], ranges: ranged ? [range] : [], unrecognized, contradictory: [] };
}

/** Whether a range admits no value. Both bounds are numbers: `NUMBER` matched them. */
function empty(
  range: { min?: string; max?: string; minInclusive?: boolean; maxInclusive?: boolean; },
): boolean {
  if (range.min === undefined || range.max === undefined) return false;
  const lo = Number(range.min);
  const hi = Number(range.max);
  return lo > hi || (lo === hi && (range.minInclusive === false || range.maxInclusive === false));
}

/** `X == 'A' OR X == 'B'` to `["A", "B"]`, or undefined for any other shape. */
function enumeration(item: string, member: RegExp): string[] | undefined {
  const parts = item.split(/\s+OR\s+/);
  const out: string[] = [];
  for (const part of parts) {
    const m = member.exec(part);
    if (!m) return undefined;
    out.push(m[1]!.replace(/''/g, "'"));
  }
  return out;
}

type Bound = { side: "min" | "max"; value: string; inclusive: boolean; };

/** `X >= 1` or `1 <= X` as a lower bound, and so on; undefined otherwise. */
function boundOf(item: string, right: RegExp, left: RegExp): Bound | undefined {
  const r = right.exec(item);
  if (r) return fromOperator(r[1]!, r[2]!);
  const l = left.exec(item);
  if (!l) return undefined;
  // `1 <= X` reads as `X >= 1`: flip the operator, keep the value.
  const flipped = { "<=": ">=", ">=": "<=", "<": ">", ">": "<" }[l[2]!]!;
  return fromOperator(flipped, l[1]!);
}

function fromOperator(op: string, value: string): Bound {
  switch (op) {
    case ">=":
      return { side: "min", value, inclusive: true };
    case ">":
      return { side: "min", value, inclusive: false };
    case "<=":
      return { side: "max", value, inclusive: true };
    default:
      return { side: "max", value, inclusive: false };
  }
}

/** The range with this bound added, or undefined when that side is already set. */
function narrow(
  range: { min?: string; max?: string; minInclusive?: boolean; maxInclusive?: boolean; },
  bound: Bound,
): typeof range | undefined {
  // A second bound on one side (`X >= 1`, `X >= 2`) is a conjunction a
  // single range could hold as the tighter one, but picking it means
  // comparing decimals as text; reporting it costs a reader one line.
  if (range[bound.side] !== undefined) return undefined;
  return bound.side === "min"
    ? { ...range, min: bound.value, minInclusive: bound.inclusive }
    : { ...range, max: bound.value, maxInclusive: bound.inclusive };
}

/**
 * The relationship a bare `Entity.rel` names, or undefined. This is the
 * mandatory-role shape: each `Entity` plays the first role of `rel`.
 */
export function readMandatoryShape(concept: string, item: string): string | undefined {
  const m = new RegExp(String.raw`^\s*${escape(concept)}\.(${IDENT})\s*$`).exec(item);
  return m?.[1];
}
