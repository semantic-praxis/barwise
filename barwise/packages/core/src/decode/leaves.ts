/**
 * The leaves more than one element's Schema is built from
 * (docs/specs/effect-adoption.spec.md, 1r): an object type's value
 * constraint and a role's value constraint state the same range, and
 * cardinalities, frequencies and join projections the same integers.
 *
 * Every `message` below is the predicate of a sentence whose subject and
 * field path the decoder supplies:
 * `Entity type "Customer": reference_mode must not be empty.`
 */
import * as Schema from "effect/Schema";
import type { ValueRange } from "../model/ObjectType.js";
import { crossField } from "./harness.js";

/** Any string, and only a string: `what` names the field's role, " (a role id)". */
const aString = (what: string) => Schema.String.annotate({ message: `must be a string${what}.` });

/** Free text: any string, and only a string. */
export const Text = aString("");

/** A flag: true or false, and nothing else. */
export const Flag = Schema.Boolean.annotate({ message: "must be true or false." });

/** A string with something in it; one of another type is refused as not a string. */
export const nonEmpty = (what: string) =>
  aString(what).check(Schema.isMinLength(1, { message: `must not be empty${what}.` }));

/**
 * Text `requireName` accepts: something left after trimming. A name -- an
 * object type's, a fact type's, a role's -- and a reading.
 */
export const notBlank = (what: string) =>
  aString(what).check(
    Schema.makeFilter((text: string) => text.trim() !== "", {
      message: `must not be blank${what}.`,
      // Not blank implies a length of at least one: the schema's minLength.
      arbitraryConstraint: { minLength: 1 },
    }),
  );
export const Name = notBlank("");

/**
 * An integer no smaller than `min`, as JSON Schema's `integer` with a
 * `minimum` reads one. Not `Schema.Int`, which is `Number.isSafeInteger`
 * and so refused 2^53 + 2, which today's schema and constructor accept
 * (review of R1). The arbitrary constraint only steers derivation (M1) to
 * draw integers in range rather than discard almost every number it draws.
 * `message` is for a leaf with alternatives, a maximum's "unbounded".
 */
/** Any integer, as JSON Schema's `integer` reads one: a diagram position. */
export const Integer = Schema.Number.annotate({ message: "must be an integer." }).check(
  Schema.makeFilter((n: number) => Number.isInteger(n), {
    message: "must be an integer.",
    arbitraryConstraint: { number: "integer" },
  }),
);

export const intAtLeast = (
  min: number,
  message = min === 0
    ? "must be a non-negative integer."
    : `must be an integer of at least ${min}.`,
) =>
  Schema.Number.check(
    Schema.makeFilter((n: number) => Number.isInteger(n) && n >= min, {
      message,
      arbitraryConstraint: { number: "integer", minimum: min },
    }),
  );

/**
 * One allowed range of values. A range with neither bound states nothing,
 * so it needs a `min` or a `max`; each inclusive flag defaults to true.
 */
export const ValueRangeFile = Schema.Struct({
  min: Schema.optionalKey(Text),
  max: Schema.optionalKey(Text),
  min_inclusive: Schema.optionalKey(Flag),
  max_inclusive: Schema.optionalKey(Flag),
}).check(
  crossField(
    { id: "value-range-bound", reads: ["min", "max"] },
    (r: { readonly min?: string; readonly max?: string; }) =>
      r.min !== undefined || r.max !== undefined,
    "must have a min or a max.",
  ),
);

/**
 * A value constraint's two lists, the object type's and a role's alike:
 * each may be left out, and is never empty when present.
 */
export const ValuesFile = Schema.Array(Text).check(
  Schema.isMinLength(1, { message: "must list at least one value when present." }),
);
export const RangesFile = Schema.Array(ValueRangeFile).check(
  Schema.isMinLength(1, { message: "must list at least one range when present." }),
);

/** Enumerated values, ranges, or both, and never neither: the rule both carry. */
export const valuesOrRanges = crossField(
  { id: "value-constraint-content", reads: ["values", "ranges"] },
  (vc: { readonly values?: unknown; readonly ranges?: unknown; }) =>
    vc.values !== undefined || vc.ranges !== undefined,
  "must have at least one value or range.",
);

/** A range as the record holds it: a flag the file states true is the default, left out. */
export function rangeRecord(r: (typeof ValueRangeFile)["Type"]): ValueRange {
  return {
    ...(r.min !== undefined ? { min: r.min } : {}),
    ...(r.max !== undefined ? { max: r.max } : {}),
    ...(r.min_inclusive === false ? { minInclusive: false } : {}),
    ...(r.max_inclusive === false ? { maxInclusive: false } : {}),
  };
}
