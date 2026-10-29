/**
 * An object type as a format 3.0 file states it, stated once as an Effect
 * Schema, and decoded into main's `ObjectType` record or into every problem
 * with it (docs/specs/effect-adoption.spec.md, 1r, R1).
 *
 * The Schema is written in the file's own keys and makes no transformation:
 * it says what a file may hold, and nothing else. What the record adds -- a
 * trimmed name, the empty alias list, `independent: false`, camelCase -- is
 * `toRecord`'s, a plain mapping after a successful decode. So a decoded value
 * is the raw value, which is what lets the cross-field harness run a rule on
 * raw input (`harness.ts`), and a path in a problem is a path in the file.
 *
 * Nothing on the load path calls this until R4: `OrmYamlSerializer` reads
 * files as it always has. Until then two tests hold it to that reader: every
 * object type in the corpus decodes to the record `createObjectType` builds
 * from `deserializeObjectType`, and every 3.0 malformed object type case is
 * refused at its field.
 *
 * The decoder mints no id (Open decision 8): a 3.0 file states every id, and
 * one without is refused.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import {
  CONCEPTUAL_DATA_TYPE_NAMES,
  type ConceptualDataTypeName,
  type ObjectType,
  VALUE_ONLY_FIELDS,
  type ValueRange,
} from "../model/ObjectType.js";
import { type DecodeOptions, type DecodeProblems, decoderFor, runDecode } from "./decoder.js";
import { crossField } from "./harness.js";
import { type ElementLabel, elementOf } from "./problems.js";

// -- Leaves -----------------------------------------------------------------

// Every `message` below is the predicate of a sentence whose subject and
// field path the decoder supplies:
// `Entity type "Customer": reference_mode must not be empty.`

const nonEmpty = (what: string) =>
  Schema.String.check(Schema.isMinLength(1, { message: `must not be empty${what}.` }));

/** A name `requireName` accepts: something left after trimming. */
const Name = Schema.String.check(
  Schema.makeFilter((name: string) => name.trim() !== "", { message: "must not be blank." }),
);

/**
 * Any non-negative integer, as JSON Schema's `integer` reads one. Not
 * `Schema.Int`, which is `Number.isSafeInteger` and so refused 2^53 + 2,
 * which today's schema and constructor accept (review of R1).
 */
const NonNegativeInt = Schema.Number.check(
  Schema.makeFilter((n: number) => Number.isInteger(n) && n >= 0, {
    message: "must be a non-negative integer.",
  }),
);

// -- Nested definitions -----------------------------------------------------

/**
 * One allowed range of values. A range with neither bound states nothing,
 * so it needs a `min` or a `max`; each inclusive flag defaults to true.
 */
const ValueRangeFile = Schema.Struct({
  min: Schema.optionalKey(Schema.String),
  max: Schema.optionalKey(Schema.String),
  min_inclusive: Schema.optionalKey(Schema.Boolean),
  max_inclusive: Schema.optionalKey(Schema.Boolean),
}).check(
  crossField(
    { id: "value-range-bound", reads: ["min", "max"] },
    (r: { readonly min?: string; readonly max?: string; }) =>
      r.min !== undefined || r.max !== undefined,
    "must have a min or a max.",
  ),
);

/** Enumerated values, ranges, or both, and never neither. */
const ValueConstraintFile = Schema.Struct({
  values: Schema.optionalKey(
    Schema.Array(Schema.String).check(
      Schema.isMinLength(1, { message: "must list at least one value when present." }),
    ),
  ),
  ranges: Schema.optionalKey(
    Schema.Array(ValueRangeFile).check(
      Schema.isMinLength(1, { message: "must list at least one range when present." }),
    ),
  ),
}).check(
  crossField(
    { id: "value-constraint-content", reads: ["values", "ranges"] },
    (vc: { readonly values?: readonly unknown[]; readonly ranges?: readonly unknown[]; }) =>
      vc.values !== undefined || vc.ranges !== undefined,
    "must have at least one value or range.",
  ),
);

const DataTypeFile = Schema.Struct({
  name: Schema.Literals(CONCEPTUAL_DATA_TYPE_NAMES).annotate({
    message: `must name a known data type (one of ${CONCEPTUAL_DATA_TYPE_NAMES.join(", ")}).`,
  }),
  length: Schema.optionalKey(NonNegativeInt),
  scale: Schema.optionalKey(NonNegativeInt),
});

/** How many instances may exist: an inclusive minimum and maximum. */
const CardinalityFile = Schema.Struct({
  min: NonNegativeInt,
  max: Schema.Union([NonNegativeInt, Schema.Literal("unbounded")]).annotate({
    message: 'must be a non-negative integer or "unbounded".',
  }),
}).check(
  crossField(
    { id: "cardinality-order", reads: ["min", "max"] },
    (c: { readonly min: number; readonly max: number | "unbounded"; }) =>
      c.max === "unbounded" || c.max >= c.min,
    "must have a max no smaller than its min.",
  ),
);

/**
 * What a message calls an object type: by its name, or by its id when the
 * name is missing or blank -- which is when the name is the problem.
 */
function describeObjectType(raw: unknown): ElementLabel {
  const doc = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = doc.kind === "entity"
    ? "Entity type"
    : doc.kind === "value"
    ? "Value type"
    : "Object type";
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  if (name !== "") return { label: `${kind} "${name}"`, identity: name };
  if (typeof doc.id === "string" && doc.id !== "") {
    return { label: `${kind} with id "${doc.id}"`, identity: doc.id };
  }
  return { label: `${kind} with no name or id`, identity: "" };
}

// -- The two variants -------------------------------------------------------

const baseFields = {
  id: nonEmpty(""),
  name: Name,
  definition: Schema.optionalKey(Schema.String),
  source_context: Schema.optionalKey(Schema.String),
  aliases: Schema.optionalKey(Schema.Array(nonEmpty(" (an alias)"))),
  independent: Schema.optionalKey(Schema.Boolean),
  note: Schema.optionalKey(Schema.String),
  cardinality: Schema.optionalKey(CardinalityFile),
};

/** A field one variant may not have: refused by name, not as unknown. */
const forbidden = (message: string) => Schema.optionalKey(Schema.Never.annotate({ message }));

/** The value-only fields in the file's spelling, from the model's one list. */
const VALUE_ONLY_FILE_KEYS = {
  dataType: "data_type",
  valueConstraint: "value_constraint",
  defaultValue: "default_value",
} as const;

const forbiddenOnEntity = Object.fromEntries(
  VALUE_ONLY_FIELDS.map(([field, label]) => [
    VALUE_ONLY_FILE_KEYS[field],
    forbidden(
      `is not allowed: an entity type cannot have ${label}; it belongs on the value type its reference mode names.`,
    ),
  ]),
) as {
  readonly [K in (typeof VALUE_ONLY_FILE_KEYS)[keyof typeof VALUE_ONLY_FILE_KEYS]]: ReturnType<
    typeof forbidden
  >;
};

const EntityTypeFile = Schema.Struct({
  ...baseFields,
  kind: Schema.Literal("entity"),
  reference_mode: nonEmpty("").pipe(
    Schema.annotateKey({
      messageMissingKey: "is missing: an entity type must have a reference mode.",
    }),
  ),
  preferred_identifier: Schema.optionalKey(nonEmpty("")),
  ...forbiddenOnEntity,
});

const ValueTypeFile = Schema.Struct({
  ...baseFields,
  kind: Schema.Literal("value"),
  reference_mode: forbidden("is not allowed: a value type has no reference mode."),
  preferred_identifier: forbidden(
    "is not allowed: only an entity type has a preferred identifier.",
  ),
  data_type: Schema.optionalKey(DataTypeFile),
  value_constraint: Schema.optionalKey(ValueConstraintFile),
  default_value: Schema.optionalKey(Schema.String),
});

/**
 * An object type as a 3.0 file states it. Discriminated by `kind`, so a
 * malformed object type is checked against its own variant only.
 */
export const ObjectTypeFile = Schema.Union([EntityTypeFile, ValueTypeFile]).annotate(
  elementOf({
    noun: "Object type",
    badTag: 'must have kind "entity" or "value".',
    describe: describeObjectType,
  }),
);

/** A decoded file object type: exactly what the file states. */
export type ObjectTypeFileValue = typeof ObjectTypeFile.Type;

// -- To the record ------------------------------------------------------------

/** A decoded object type: main's record, and what the file says identifies it. */
export interface DecodedObjectType {
  readonly record: ObjectType;
  /** An entity's `preferred_identifier`: the model stores it, not the record. */
  readonly preferredIdentifier?: string;
}

function rangeRecord(r: (typeof ValueRangeFile)["Type"]): ValueRange {
  return {
    ...(r.min !== undefined ? { min: r.min } : {}),
    ...(r.max !== undefined ? { max: r.max } : {}),
    // A flag the file states true is the default, which the record leaves out.
    ...(r.min_inclusive === false ? { minInclusive: false } : {}),
    ...(r.max_inclusive === false ? { maxInclusive: false } : {}),
  };
}

/**
 * The record a decoded object type stands for, as `createObjectType` builds
 * it: frozen, its name trimmed, its defaults applied, each optional field
 * present only when the file states it.
 */
export function toRecord(file: ObjectTypeFileValue): DecodedObjectType {
  const base = {
    id: file.id,
    name: file.name.trim(),
    aliases: Object.freeze([...(file.aliases ?? [])]),
    independent: file.independent ?? false,
    ...(file.definition !== undefined ? { definition: file.definition } : {}),
    ...(file.source_context !== undefined ? { sourceContext: file.source_context } : {}),
    ...(file.note !== undefined ? { note: file.note } : {}),
    ...(file.cardinality !== undefined
      ? { cardinality: { min: file.cardinality.min, max: file.cardinality.max } }
      : {}),
  };
  if (file.kind === "entity") {
    return {
      record: Object.freeze({ ...base, kind: "entity", referenceMode: file.reference_mode }),
      ...(file.preferred_identifier !== undefined
        ? { preferredIdentifier: file.preferred_identifier }
        : {}),
    };
  }
  const vc = file.value_constraint;
  return {
    record: Object.freeze({
      ...base,
      kind: "value",
      ...(file.data_type !== undefined
        ? {
          dataType: {
            name: file.data_type.name as ConceptualDataTypeName,
            ...(file.data_type.length !== undefined ? { length: file.data_type.length } : {}),
            ...(file.data_type.scale !== undefined ? { scale: file.data_type.scale } : {}),
          },
        }
        : {}),
      ...(vc !== undefined
        ? {
          valueConstraint: {
            values: [...(vc.values ?? [])],
            ...(vc.ranges !== undefined ? { ranges: vc.ranges.map(rangeRecord) } : {}),
          },
        }
        : {}),
      ...(file.default_value !== undefined ? { defaultValue: file.default_value } : {}),
    }),
  };
}

// -- Decoding ---------------------------------------------------------------

const decodeFile = decoderFor(ObjectTypeFile);

/** Decode one object type as a 3.0 file states it. */
export function decodeObjectType(
  doc: unknown,
  options: DecodeOptions = {},
): Effect.Effect<DecodedObjectType, DecodeProblems> {
  return decodeFile(doc, options).pipe(Effect.map(toRecord));
}

/** The synchronous boundary: the decoded object type, or every problem thrown at once. */
export function runObjectTypeDecode(doc: unknown): DecodedObjectType {
  return runDecode(decodeObjectType(doc));
}
