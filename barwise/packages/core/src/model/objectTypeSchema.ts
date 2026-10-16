/**
 * The object type, stated once: the record types, the rules a model and a
 * file must satisfy, and the YAML spelling, as one Effect Schema definition
 * (docs/specs/effect-comparison.spec.md, the Effect arm).
 *
 * Before this the same object type was described four times: the record
 * interfaces, the refusals in `createObjectType`, the YAML shape with its
 * mapping functions, and the JSON Schema. The first three now derive from the
 * structs below -- `EntityType` and `ValueType` are their decoded types, the
 * refusals are their checks, and the YAML codec renames their keys. The JSON
 * Schema stays hand-written for the editor and the LLM, and
 * `tests/model/objectTypeSchemaDrift.test.ts` compares it with this one.
 *
 * Decoding is where the record's defaults are applied (an empty alias list,
 * `independent: false`), so a decoded value is a finished record. The id is
 * required, not defaulted: a caller whose input may lack one fills it at the
 * boundary before decoding (effect-adoption.spec.md, decision 8), so nothing
 * here mints an id.
 */
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as SchemaAST from "effect/SchemaAST";
import * as SchemaTransformation from "effect/SchemaTransformation";

/**
 * Portable conceptual data type names, independent of any specific tool
 * (NORMA, SQL dialect, etc.). These describe the abstract nature of a
 * value type's data, not its storage representation.
 *
 * The relational mapper and DDL renderer translate these into concrete
 * SQL types (e.g. "text" -> VARCHAR, "auto_counter" -> SERIAL).
 */
export type ConceptualDataTypeName =
  | "text"
  | "integer"
  | "decimal"
  | "money"
  | "float"
  | "boolean"
  | "date"
  | "time"
  | "datetime"
  | "timestamp"
  | "auto_counter"
  | "binary"
  | "uuid"
  | "other";

// Record-typed for the same reason as RING_TYPE_MEMBERS in
// Constraint.ts: completeness is compile-checked, so the runtime list
// every consumer derives from (LLM response schema, output
// validation, the decoder below) cannot silently lag the union
// (barwise-869).
const CONCEPTUAL_DATA_TYPE_MEMBERS: Record<ConceptualDataTypeName, true> = {
  text: true,
  integer: true,
  decimal: true,
  money: true,
  float: true,
  boolean: true,
  date: true,
  time: true,
  datetime: true,
  timestamp: true,
  auto_counter: true,
  binary: true,
  uuid: true,
  other: true,
};

/** Every ConceptualDataTypeName member, in declaration order. */
export const CONCEPTUAL_DATA_TYPE_NAMES = Object.keys(
  CONCEPTUAL_DATA_TYPE_MEMBERS,
) as readonly ConceptualDataTypeName[];

/**
 * The fields only a value type may carry, with the words a message uses for
 * each.
 *
 * The one list of them. The entity struct below forbids each one, and the
 * JSON Schema forbids the same fields under its entity branch, in their YAML
 * spelling; `tests/model/valueOnlyFields.test.ts` derives the schema's list
 * from this one.
 */
export const VALUE_ONLY_FIELDS = [
  ["dataType", "a data type"],
  ["valueConstraint", "a value constraint"],
  ["defaultValue", "a default value"],
] as const;

type ValueOnlyField = (typeof VALUE_ONLY_FIELDS)[number][0];

// -- Field schemas ----------------------------------------------------------

// Every `message` below is the predicate of a sentence whose subject the
// decoder supplies ("Entity type "Customer" must have a reference mode."):
// an annotation is a fixed string, and only the decoder knows which object
// type it is reporting on.

const NonNegativeInt = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0, { message: "must not be negative." }),
);
// length and scale each get their own sentence, so two problems on one data
// type name the field they are about.
const NonNegativeLength = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0, { message: "must have a non-negative length." }),
);
const NonNegativeScale = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(0, { message: "must have a non-negative scale." }),
);

/**
 * The element-naming rule of `requireName` (`name.ts`): stored trimmed,
 * refused when nothing is left. Stated in schema terms because the decoder
 * must report it as a problem rather than throw it;
 * `tests/model/objectTypeDecoder.test.ts` checks the two accept the same
 * names.
 */
const NameSchema = Schema.Trim.check(
  Schema.makeFilter((name: string) => name !== "", { message: "must have a non-empty name." }),
);

/**
 * A single allowed value range. A missing bound is open-ended. Bounds are
 * inclusive unless the `*Inclusive` flag is `false`, and are strings so the
 * range is data-type agnostic.
 */
const ValueRangeSchema = Schema.Struct({
  min: Schema.optionalKey(Schema.String),
  max: Schema.optionalKey(Schema.String),
  minInclusive: Schema.optionalKey(Schema.Boolean),
  maxInclusive: Schema.optionalKey(Schema.Boolean),
});

/** The YAML key of every value range key that is not spelled the same. */
export const RANGE_YAML_KEYS = {
  minInclusive: "min_inclusive",
  maxInclusive: "max_inclusive",
} as const;

/**
 * What the two spellings check differently, besides their key names.
 *
 * A file is checked as strictly as the JSON Schema checks it: a data type
 * name from the list, sizes and counts that are non-negative integers. A
 * direct caller of `OrmModel.addObjectType` is checked only as
 * `createObjectType` always checked one, because callers outside this
 * package build configs from importers and tests, and some pass a data type
 * the list does not know (a test builds `{ name: "Text" }`): tightening that
 * here would refuse models that build today. There `ObjectTypeConfig`'s
 * TypeScript type is what holds a caller to the list, as it always was, so
 * the lenient leaves declare the strict type.
 */
const FILE_LEAVES = {
  dataTypeName: Schema.Literals(CONCEPTUAL_DATA_TYPE_NAMES).annotate({
    message: `must name a known data type (one of ${CONCEPTUAL_DATA_TYPE_NAMES.join(", ")}).`,
  }),
  size: NonNegativeInt,
  length: NonNegativeLength,
  scale: NonNegativeScale,
  count: Schema.Int,
  range: ValueRangeSchema.pipe(Schema.encodeKeys(RANGE_YAML_KEYS)),
};

// A config may name a data type outside the list, so this leaf checks only
// that the value is a string. The link lets Arbitrary.schema derive over it
// (without it, derivation throws "unsupported Declaration"); the check and the
// TypeScript type are unchanged. Spec: effect-adoption.spec.md, open decision 5.
const CONFIG_LEAVES = {
  dataTypeName: Schema.declare((u: unknown): u is ConceptualDataTypeName => typeof u === "string", {
    toCodecArbitrary: () =>
      ({
        to: Schema.String.ast,
        transformation: SchemaTransformation.passthrough<string>(),
      }) as SchemaAST.Link,
  }),
  size: Schema.Number,
  length: Schema.Number,
  scale: Schema.Number,
  count: Schema.Number,
  range: ValueRangeSchema,
};

type Leaves = typeof FILE_LEAVES | typeof CONFIG_LEAVES;

/** A conceptual data type definition on a value type. */
function dataTypeDefSchema(leaves: Leaves) {
  return Schema.Struct({
    name: leaves.dataTypeName,
    length: Schema.optionalKey(leaves.length),
    scale: Schema.optionalKey(leaves.scale),
  });
}

/**
 * A bound on a count: an inclusive minimum and an inclusive maximum, where
 * `max` may be `"unbounded"`. The same shape backs unary-role occurrence
 * cardinality (`CardinalityConstraint` in Constraint.ts).
 */
function cardinalityRangeSchema(leaves: Leaves) {
  return Schema.Struct({
    min: leaves.count.check(
      Schema.isGreaterThanOrEqualTo(0, {
        message: "must have a non-negative cardinality minimum.",
      }),
    ),
    max: Schema.Union([leaves.size, Schema.Literal("unbounded")]),
  }).check(
    Schema.makeFilter(
      (c: { readonly min: number; readonly max: number | "unbounded"; }) =>
        c.max === "unbounded" || c.max >= c.min,
      { message: "must have a cardinality max >= min." },
    ),
  );
}

/**
 * A value constraint: enumerated values, ranges, or both, and never neither.
 * `values` defaults to the empty list because a file omits it when a
 * constraint has only ranges.
 */
function valueConstraintSchema(leaves: Leaves) {
  return Schema.Struct({
    values: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(emptyList())),
    ranges: Schema.optionalKey(Schema.Array(leaves.range)),
  }).check(
    Schema.makeFilter(
      (vc: { readonly values: readonly string[]; readonly ranges?: readonly unknown[]; }) =>
        vc.values.length > 0 || (vc.ranges?.length ?? 0) > 0,
      { message: "must have at least one value or range in its value constraint." },
    ),
  );
}

function emptyList() {
  return Effect.succeed([] as readonly string[]);
}

// -- The two variants -------------------------------------------------------

function baseFields(leaves: Leaves) {
  return {
    /** Required: a boundary whose caller may omit it fills it first. */
    id: Schema.String,
    /** Trimmed and non-empty. */
    name: NameSchema,
    definition: Schema.optionalKey(Schema.String),
    sourceContext: Schema.optionalKey(Schema.String),
    /** Always present, possibly empty: the default is applied once, here. */
    aliases: Schema.Array(Schema.String).pipe(Schema.withDecodingDefaultKey(emptyList())),
    /**
     * Whether the object type is independent: its instances may exist without
     * participating in any non-identifying fact. Always present.
     */
    independent: Schema.Boolean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
    /** Free-text note, distinct from the formal `definition`. */
    note: Schema.optionalKey(Schema.String),
    /** Bound on how many instances of the type may exist. */
    cardinality: Schema.optionalKey(cardinalityRangeSchema(leaves)),
  };
}

/**
 * The value-only fields, each forbidden on an entity type. Refused rather
 * than ignored: an entity type takes its data type, value constraint and
 * default from the value type its reference mode names, and a union that
 * dropped them lost them on the next save (barwise-5fg).
 */
const forbiddenOnEntity = Object.fromEntries(
  VALUE_ONLY_FIELDS.map(([field, label]) => [
    field,
    Schema.optionalKey(
      Schema.Never.annotate({
        message: `cannot have ${label}; it belongs on the value type its reference mode names.`,
      }),
    ),
  ]),
) as { readonly [K in ValueOnlyField]: Schema.optionalKey<Schema.Never>; };

/** An object type identified by a reference scheme. */
function entityTypeSchema(leaves: Leaves) {
  return Schema.Struct({
    ...baseFields(leaves),
    kind: Schema.Literal("entity"),
    referenceMode: Schema.String.check(
      Schema.makeFilter((mode: string) => mode !== "", { message: "must have a reference mode." }),
    ).pipe(Schema.annotateKey({ messageMissingKey: "must have a reference mode." })),
    ...forbiddenOnEntity,
  });
}

/**
 * A self-identifying object type. `dataType` is optional, and deliberately
 * so: 54 of the 302 value types in this repository's models declare none
 * (measured 2026-09-08), and `completeness/missing-value-type-data-type`
 * reports that as a warning, not a malformed file.
 */
function valueTypeSchema(leaves: Leaves) {
  return Schema.Struct({
    ...baseFields(leaves),
    kind: Schema.Literal("value"),
    referenceMode: Schema.optionalKey(
      Schema.Never.annotate({ message: "should not have a reference mode." }),
    ),
    dataType: Schema.optionalKey(dataTypeDefSchema(leaves)),
    valueConstraint: Schema.optionalKey(valueConstraintSchema(leaves)),
    /** Threaded into relational mapping as a SQL column DEFAULT. */
    defaultValue: Schema.optionalKey(Schema.String),
  });
}

/** The YAML key of every object type key that is not spelled the same. */
export const YAML_KEYS = {
  referenceMode: "reference_mode",
  sourceContext: "source_context",
  dataType: "data_type",
  valueConstraint: "value_constraint",
  defaultValue: "default_value",
} as const;

const EntityTypeSchema = entityTypeSchema(CONFIG_LEAVES);
const ValueTypeSchema = valueTypeSchema(CONFIG_LEAVES);

/**
 * An object type as a caller of `OrmModel.addObjectType` spells it, decoded
 * into the record. The union is discriminated by `kind`, so a malformed
 * object type is checked against its own variant only.
 */
export const ObjectTypeModelCodec = Schema.Union([EntityTypeSchema, ValueTypeSchema]);

/**
 * An object type as an `.orm.yaml` file spells it (snake_case keys), decoded
 * into the same record.
 */
export const ObjectTypeYamlCodec = Schema.Union([
  entityTypeSchema(FILE_LEAVES).pipe(Schema.encodeKeys(YAML_KEYS)),
  valueTypeSchema(FILE_LEAVES).pipe(Schema.encodeKeys(YAML_KEYS)),
]);

/**
 * `true` when a hand-written input type names exactly the keys of a codec's
 * encoded side (either variant), and `never` -- so the annotated constant
 * fails to compile -- when they differ. For the input types kept broader
 * than the codec on purpose: `ObjectTypeConfig` and `OrmYamlObjectType`.
 */
export type KeysAgree<Input, Encoded> = [keyof Input] extends [KeysOf<Encoded>]
  ? [KeysOf<Encoded>] extends [keyof Input] ? true : never
  : never;

type KeysOf<T> = T extends unknown ? keyof T : never;

// -- The record types, derived ----------------------------------------------

/** Whether the object type is an entity or a value type. */
export type ObjectTypeKind = "entity" | "value";

/** A single allowed value range; see `ValueRangeSchema`. */
export type ValueRange = typeof ValueRangeSchema.Type;

/** Enumerated values, ranges, or both; see `valueConstraintSchema`. */
export type ValueConstraintDef = NonNullable<ValueType["valueConstraint"]>;

/** A conceptual data type with optional sizing (VARCHAR(50), DECIMAL(10,2)). */
export type DataTypeDef = NonNullable<ValueType["dataType"]>;

/** A count bound; see `cardinalityRangeSchema`. */
export type CardinalityRange = NonNullable<ValueType["cardinality"]>;

// The forbidden fields are left out of the record types. They exist in the
// structs only to be refused; kept in the types as `?: never`, they would let
// a consumer read `ot.referenceMode` off the union without narrowing, which
// is the optional the union exists to remove.

/**
 * An object type identified by a reference scheme. `referenceMode` is never
 * absent: the old class allowed it on both kinds and threw for an entity
 * without one, so every consumer narrowed by hand or wrote a fallback for a
 * state the constructor forbade.
 */
export type EntityType = Omit<typeof EntityTypeSchema.Type, ValueOnlyField>;

/** A self-identifying object type. See `valueTypeSchema`. */
export type ValueType = Omit<typeof ValueTypeSchema.Type, "referenceMode">;

/** The fields both variants carry. */
export type ObjectTypeBase = Omit<EntityType, "kind" | "referenceMode">;

/**
 * An ObjectType is a concept in the domain, and it is exactly one of two
 * things: an entity type, identified by a reference scheme (Customer, by
 * customer_id), or a value type, self-identifying (a Name string, a Rating
 * enumeration). Four fields are required-or-forbidden by which one it is.
 *
 * As a union the compiler enforces that for a consumer: `EntityType` has a
 * `referenceMode: string` that cannot be absent, `ValueType` has no
 * `referenceMode` at all, and a consumer that wants either must say which
 * one it is looking at. The sealed set is closed, which is what makes a
 * match over it exhaustive.
 */
export type ObjectType = EntityType | ValueType;
