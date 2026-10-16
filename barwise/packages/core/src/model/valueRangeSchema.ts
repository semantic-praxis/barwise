/**
 * A value range, shared by the two schemas that hold one -- an object type's
 * value constraint and a role's value constraint in `ConstraintYamlCodec` --
 * so those two cannot drift (on main, the readers they replace had).
 *
 * The sharing reaches only as far as the schemas are wired. On this branch
 * both are decoded through it on load, and the object type at construction
 * too. A role's value constraint built in code is not: `FactType` takes its
 * constraints as given, so one keeps whatever flags its caller gave,
 * `minInclusive: true` included, until fact types are decoded at
 * construction as object types are.
 *
 * The record has one canonical form. A bound is inclusive unless it says
 * otherwise, and only a file can say otherwise: reading a file drops
 * `min_inclusive: true`. So an inclusive bound is an absent key, and `true`
 * is refused in the record. A range must also have a min or a max, as the
 * file format requires, so a record never serializes to a file that will not
 * load.
 *
 * Two readers fill the record. A file's range is read with its flags
 * canonicalized. A config's range (a caller of `createObjectType`) is
 * canonicalized the same way rather than refused, because callers have always
 * been allowed to say `minInclusive: true`.
 */
import * as Schema from "effect/Schema";
import * as SchemaTransformation from "effect/SchemaTransformation";
import { missingOneOf } from "./problemWording.js";

const ExclusiveFlag = Schema.Boolean.check(
  Schema.makeFilter((b: boolean) => b === false, { message: "is inclusive by default." }),
);

/** What a range with neither bound is told; the constraint decoder says it too. */
export const RANGE_BOUND_MESSAGE = missingOneOf([], ["min", "max"]);

export const ValueRangeSchema = Schema.Struct({
  min: Schema.optionalKey(Schema.String),
  max: Schema.optionalKey(Schema.String),
  minInclusive: Schema.optionalKey(ExclusiveFlag),
  maxInclusive: Schema.optionalKey(ExclusiveFlag),
}).check(
  Schema.makeFilter(
    (r: { readonly min?: string; readonly max?: string; }) =>
      r.min !== undefined || r.max !== undefined,
    { message: RANGE_BOUND_MESSAGE },
  ),
);

/** A value range in its record form. */
export type ValueRange = typeof ValueRangeSchema.Type;

/** The YAML key of every value range key that is not spelled the same. */
export const RANGE_YAML_KEYS = {
  minInclusive: "min_inclusive",
  maxInclusive: "max_inclusive",
} as const;

const FileRange = Schema.Struct({
  min: Schema.optionalKey(Schema.String),
  max: Schema.optionalKey(Schema.String),
  min_inclusive: Schema.optionalKey(Schema.Boolean),
  max_inclusive: Schema.optionalKey(Schema.Boolean),
});

const ConfigRange = Schema.Struct({
  min: Schema.optionalKey(Schema.String),
  max: Schema.optionalKey(Schema.String),
  minInclusive: Schema.optionalKey(Schema.Boolean),
  maxInclusive: Schema.optionalKey(Schema.Boolean),
});

/** The record, from any bounds and flags: only an exclusive flag is kept. */
function canonical(r: {
  readonly min?: string | undefined;
  readonly max?: string | undefined;
  readonly minInclusive?: boolean | undefined;
  readonly maxInclusive?: boolean | undefined;
}): ValueRange {
  return {
    ...(r.min !== undefined ? { min: r.min } : {}),
    ...(r.max !== undefined ? { max: r.max } : {}),
    ...(r.minInclusive === false ? { minInclusive: false } : {}),
    ...(r.maxInclusive === false ? { maxInclusive: false } : {}),
  };
}

/** A value range as a file spells it, read into the record. */
export const ValueRangeFromFile = FileRange.pipe(
  Schema.decodeTo(
    ValueRangeSchema,
    SchemaTransformation.transform({
      decode: (f: typeof FileRange.Type) =>
        canonical({
          min: f.min,
          max: f.max,
          minInclusive: f.min_inclusive,
          maxInclusive: f.max_inclusive,
        }),
      encode: (r: ValueRange): typeof FileRange.Type => ({
        ...(r.min !== undefined ? { min: r.min } : {}),
        ...(r.max !== undefined ? { max: r.max } : {}),
        ...(r.minInclusive === false ? { min_inclusive: false } : {}),
        ...(r.maxInclusive === false ? { max_inclusive: false } : {}),
      }),
    }),
  ),
);

/** A value range as a config spells it, canonicalized into the record. */
export const ValueRangeFromConfig = ConfigRange.pipe(
  Schema.decodeTo(
    ValueRangeSchema,
    SchemaTransformation.transform({
      decode: (c: typeof ConfigRange.Type) => canonical(c),
      encode: (r: ValueRange): typeof ConfigRange.Type => r,
    }),
  ),
);
