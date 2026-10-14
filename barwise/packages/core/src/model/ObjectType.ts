import { trimmedName } from "./name.js";

/**
 * Whether the object type is an entity (identified by a reference scheme)
 * or a value (self-identifying, e.g. a string or number).
 */
export type ObjectTypeKind = "entity" | "value";

/**
 * A single allowed value range. A missing bound is open-ended (no lower or
 * no upper limit). Bounds are inclusive unless the corresponding
 * `*Inclusive` flag is `false`. Bounds are strings so the range is
 * data-type agnostic (matching enumerated `values`); numeric comparison is
 * applied when both a bound and the tested value parse as numbers.
 */
export interface ValueRange {
  /** Lower bound; omit for an open-below range. */
  readonly min?: string;
  /** Upper bound; omit for an open-above range. */
  readonly max?: string;
  /** Whether the lower bound is inclusive (default true). */
  readonly minInclusive?: boolean;
  /** Whether the upper bound is inclusive (default true). */
  readonly maxInclusive?: boolean;
}

/**
 * A value constraint restricts the allowed values for a value type or role.
 * Supports enumerated values, value ranges (inclusive/exclusive, possibly
 * open-ended), or both. A value satisfies the constraint if it equals one
 * of `values` or falls within any of `ranges`.
 */
export interface ValueConstraintDef {
  readonly values: readonly string[];
  readonly ranges?: readonly ValueRange[];
}

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
// validation) cannot silently lag the union (barwise-869).
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
 * A conceptual data type definition on a value type.
 *
 * This describes the abstract nature of a value type's data, not its
 * physical storage. The optional `length` and `scale` parameters carry
 * sizing information where relevant (e.g. VARCHAR(50) or DECIMAL(10,2)).
 */
export interface DataTypeDef {
  readonly name: ConceptualDataTypeName;
  readonly length?: number;
  readonly scale?: number;
}

/**
 * A bound on a count: an inclusive minimum and an inclusive maximum, where
 * `max` may be `"unbounded"` for no upper limit. The same shape backs both
 * object-type population cardinality (this module) and unary-role
 * occurrence cardinality (`CardinalityConstraint` in Constraint.ts), so the
 * count semantics live in one type. `min` defaults to 0 conceptually.
 */
export interface CardinalityRange {
  /** Minimum number of instances (inclusive). */
  readonly min: number;
  /** Maximum number of instances (inclusive), or "unbounded" for no limit. */
  readonly max: number | "unbounded";
}

/**
 * Configuration for creating a new ObjectType.
 */
export interface ObjectTypeConfig {
  readonly name: string;
  readonly id?: string;
  readonly kind: ObjectTypeKind;
  /** Required for entity types. The reference mode (e.g. "customer_id"). */
  readonly referenceMode?: string;
  /** Natural-language definition for the ubiquitous language. */
  readonly definition?: string;
  /** The bounded context this object type originates from. */
  readonly sourceContext?: string;
  /** Value constraint for value types. */
  readonly valueConstraint?: ValueConstraintDef;
  /** Conceptual data type for value types (e.g. text, integer, decimal). */
  readonly dataType?: DataTypeDef;
  /** Alternative names for this object type (synonyms from different stakeholders or contexts). */
  readonly aliases?: readonly string[];
  /**
   * Whether the object type is independent: its instances may exist without
   * participating in any non-identifying fact (drawn with an open dot in
   * ORM 2). Default false. Independence exempts the type from the
   * "isolated object type" completeness warning.
   */
  readonly independent?: boolean;
  /**
   * Default value for a value type: the value assumed when none is supplied.
   * Threaded into relational mapping as a SQL column DEFAULT.
   */
  readonly defaultValue?: string;
  /**
   * Free-text note: informal commentary distinct from the formal
   * `definition` (e.g. a TODO, a caveat, a provenance remark).
   */
  readonly note?: string;
  /**
   * Cardinality bound on this object type's population: how many instances
   * of the type may exist (e.g. "at most 50 Departments"). Distinct from a
   * role frequency, which bounds how many times an object plays a role.
   */
  readonly cardinality?: CardinalityRange;
}

/**
 * An ObjectType is a concept in the domain, and it is exactly one of two
 * things.
 *
 * An entity type is identified by a reference scheme (Customer, identified
 * by customer_id); a value type is self-identifying (a Name string, a
 * Rating enumeration). Four fields are required-or-forbidden by which one
 * it is, and until WS1 of `core-branching-load.spec.md` that was enforced
 * by throws in a constructor: one class carried `referenceMode?`,
 * `dataType?`, `valueConstraint?` and `defaultValue?` and rejected the
 * illegal combinations at run time.
 *
 * As a union the compiler enforces it instead. `EntityType` has a
 * `referenceMode: string` that cannot be absent, `ValueType` has no
 * `referenceMode` at all, and a consumer that wants either must say which
 * one it is looking at. That is what removes the defensive branches: a
 * fallback for an entity without a reference mode was unreachable code no
 * reader could tell was dead (the spec's fourth evidenced site).
 */
export interface ObjectTypeBase {
  readonly id: string;
  /** Trimmed and non-empty; `objectTypeRuleProblems` refuses anything else. */
  readonly name: string;
  readonly definition?: string;
  readonly sourceContext?: string;
  /** Always present, possibly empty: the default is applied once, here. */
  readonly aliases: readonly string[];
  /** Always present: the default is applied once, here. */
  readonly independent: boolean;
  readonly note?: string;
  readonly cardinality?: CardinalityRange;
}

/** An object type identified by a reference scheme. */
export interface EntityType extends ObjectTypeBase {
  readonly kind: "entity";
  /**
   * Never absent. The old class allowed `referenceMode?` on both kinds and
   * threw for an entity without one, so every consumer either narrowed by
   * hand or wrote a fallback for a state the constructor forbade.
   */
  readonly referenceMode: string;
}

/**
 * A self-identifying object type.
 *
 * `dataType` is optional, and deliberately so: the spec's target sketch
 * made it required, and 54 of the 302 value types in this repository's
 * models declare none (measured 2026-09-08 across the 59 `.orm.yaml`
 * files that deserialize, including four promptlab eval references).
 * Requiring it would refuse to build them. An unspecified data type is
 * incomplete rather than malformed, which is why
 * `completeness/missing-value-type-data-type` reports it as a warning and
 * keeps doing so.
 */
export interface ValueType extends ObjectTypeBase {
  readonly kind: "value";
  readonly dataType?: DataTypeDef;
  readonly valueConstraint?: ValueConstraintDef;
  readonly defaultValue?: string;
}

/**
 * The sealed set. TypeScript has inheritance but no `sealed`, so the union
 * declaration is how the compiler learns the child list is closed -- which
 * is what makes a match over it exhaustive.
 */
export type ObjectType = EntityType | ValueType;

/** Whether this object type is an entity type, narrowing to `EntityType`. */
export function isEntityType(ot: ObjectType): ot is EntityType {
  return ot.kind === "entity";
}

/** Whether this object type is a value type, narrowing to `ValueType`. */
export function isValueType(ot: ObjectType): ot is ValueType {
  return ot.kind === "value";
}

/**
 * The config fields only a value type may carry, with the words a message
 * uses for each.
 *
 * The one list of them. The JSON Schema forbids the same fields under its
 * entity branch, in their YAML spelling, and
 * `tests/model/valueOnlyFields.test.ts` derives the schema's list from this
 * one, so the two cannot disagree about what a file and a direct caller may
 * put on an entity.
 */
export const VALUE_ONLY_FIELDS = [
  ["dataType", "a data type"],
  ["valueConstraint", "a value constraint"],
  ["defaultValue", "a default value"],
] as const;

/**
 * One thing wrong with one object type.
 *
 * `objectType` is the name as written, or the id when the name is the
 * problem ("" when the input has neither). `field` is the field at fault,
 * spelled as the input spells it: `dataType` from `createObjectType`,
 * `data_type` from `decodeObjectType`, which reads YAML. A problem inside a
 * field is reported against the field that holds it; the message says where.
 */
export interface ObjectTypeProblem {
  readonly objectType: string;
  readonly field: string;
  readonly message: string;
}

/** Either the object type, or every problem with it -- never both. */
export type DecodeResult =
  | { readonly ok: true; readonly value: ObjectType; }
  | { readonly ok: false; readonly problems: readonly ObjectTypeProblem[]; };

/**
 * How problems identify one object type: by its name as written, by its id
 * when the name is what is wrong, and by its kind when that is known.
 * `subject` begins a sentence about the object type; `who` names it inside
 * a sentence about one of its fields.
 */
export interface ObjectTypeIdentity {
  readonly objectType: string;
  readonly subject: string;
  readonly who: string;
}

/** Identify an object type for its problems, from whatever it carries. */
export function identifyObjectType(
  name: unknown,
  id: unknown,
  kind: ObjectTypeKind | undefined,
): ObjectTypeIdentity {
  const named = trimmedName(name) !== undefined ? (name as string) : undefined;
  const knownId = typeof id === "string" && id !== "" ? id : undefined;
  const noun = kind === "entity" ? "Entity type" : kind === "value" ? "Value type" : "Object type";
  if (named !== undefined) {
    return { objectType: named, subject: `${noun} "${named}"`, who: `"${named}"` };
  }
  if (knownId !== undefined) {
    return {
      objectType: knownId,
      subject: `${noun} with id "${knownId}"`,
      who: `the object type with id "${knownId}"`,
    };
  }
  return {
    objectType: "",
    subject: `${noun} with no name or id`,
    who: "an object type with no name or id",
  };
}

/**
 * Every rule an object type config breaks, as problems against config
 * fields -- the rules a typed config can still break, which are the ones
 * the old constructor threw for, plus the value-only fields on an entity
 * type, which it silently dropped (barwise-5fg).
 *
 * `ObjectTypeConfig` is one broad type, so the compiler lets a caller omit
 * an entity's reference mode, give a value type one, or put a value-only
 * field on an entity; those are checked here, at run time, for both entry
 * points. What a typed config cannot get wrong -- a string where a number
 * belongs, an unknown key -- is the decoder's to check, because only a
 * file can carry it.
 *
 * `kind` may be undefined when the decoder could not read one; the rules
 * that depend on it are then skipped. `unsound` names fields the decoder
 * already reported, so a rule does not report the same field again as
 * missing.
 */
export function objectTypeRuleProblems(
  config: Omit<ObjectTypeConfig, "kind"> & { readonly kind?: ObjectTypeKind; },
  unsound: ReadonlySet<keyof ObjectTypeConfig> = new Set(),
): ObjectTypeProblem[] {
  const { objectType, subject, who } = identifyObjectType(config.name, config.id, config.kind);
  const problems: ObjectTypeProblem[] = [];
  const report = (field: keyof ObjectTypeConfig, message: string) => {
    problems.push({ objectType, field, message });
  };

  if (!unsound.has("name") && trimmedName(config.name) === undefined) {
    report("name", `${subject} must have a non-empty name.`);
  }

  if (config.kind === "entity") {
    // Refused rather than ignored. An entity type takes its data type, value
    // constraint and default from the value type its reference mode names;
    // on the entity they mean nothing. Before this, the union dropped them
    // without a word, and a file that carried one lost it on the next save
    // (barwise-5fg, a regression from the one-class model, which stored them
    // for either kind). Checked before the value constraint's contents, so
    // an entity carrying an empty one is told to remove it, not to fill it.
    for (const [field, label] of VALUE_ONLY_FIELDS) {
      if (config[field] !== undefined) {
        report(
          field,
          `${subject} cannot have ${label}; it belongs on the value type its reference mode names.`,
        );
      }
    }
    if (!unsound.has("referenceMode") && !config.referenceMode) {
      report("referenceMode", `${subject} must have a reference mode.`);
    }
  } else if (config.kind === "value" && config.referenceMode) {
    report("referenceMode", `${subject} should not have a reference mode.`);
  }

  if (config.kind !== "entity" && config.valueConstraint) {
    const { values, ranges } = config.valueConstraint;
    if (values.length === 0 && (ranges?.length ?? 0) === 0) {
      report(
        "valueConstraint",
        `Value constraint on ${who} must have at least one value or range.`,
      );
    }
  }

  if (config.cardinality) {
    const { min, max } = config.cardinality;
    if (min < 0) {
      report("cardinality", `Cardinality on ${who} must have a non-negative minimum.`);
    } else if (max !== "unbounded" && max < min) {
      report("cardinality", `Cardinality on ${who} must have max >= min.`);
    }
  }

  return problems;
}

/**
 * The object type a config describes, applying every default. Only for a
 * config `objectTypeRuleProblems` passed: it checks nothing itself.
 *
 * `newId` mints the id when the config has none, and is called at most
 * once. It is a parameter rather than a read of the installed generator so
 * the id source shows at every call: `OrmModel.addObjectType` passes
 * `generateId`, a test passes a counter.
 */
export function buildObjectType(config: ObjectTypeConfig, newId: () => string): ObjectType {
  const base = {
    id: config.id ?? newId(),
    name: trimmedName(config.name)!,
    aliases: Object.freeze([...(config.aliases ?? [])]),
    independent: config.independent ?? false,
    ...(config.definition !== undefined ? { definition: config.definition } : {}),
    ...(config.sourceContext !== undefined ? { sourceContext: config.sourceContext } : {}),
    ...(config.note !== undefined ? { note: config.note } : {}),
    ...(config.cardinality !== undefined ? { cardinality: config.cardinality } : {}),
  };
  if (config.kind === "entity") {
    return Object.freeze({ ...base, kind: "entity", referenceMode: config.referenceMode! });
  }
  return Object.freeze({
    ...base,
    kind: "value",
    ...(config.dataType !== undefined ? { dataType: config.dataType } : {}),
    ...(config.valueConstraint !== undefined ? { valueConstraint: config.valueConstraint } : {}),
    ...(config.defaultValue !== undefined ? { defaultValue: config.defaultValue } : {}),
  });
}

/**
 * Every problem with one object type, thrown by the callers that cannot
 * return them (`createObjectType`, and through it `OrmModel.addObjectType`).
 *
 * The message lists every problem, one per line, so a caller that prints
 * only `message` still shows all of them; `problems` keeps them apart for
 * a caller that reports each one.
 */
export class ObjectTypeError extends Error {
  constructor(readonly problems: readonly ObjectTypeProblem[]) {
    super(problems.map((p) => p.message).join("\n"));
    this.name = "ObjectTypeError";
  }
}

/**
 * Build an object type from a config, or throw every problem with it.
 *
 * The same rules and the same construction `decodeObjectType` applies to a
 * file's object type, minus the shape checks a typed config makes
 * unnecessary, so a direct caller and a `.orm.yaml` cannot drift apart on
 * what an object type may be.
 */
export function createObjectType(config: ObjectTypeConfig, newId: () => string): ObjectType {
  const problems = objectTypeRuleProblems(config);
  if (problems.length > 0) throw new ObjectTypeError(problems);
  return buildObjectType(config, newId);
}

/**
 * The reference mode when this is an entity type, and `undefined`
 * otherwise.
 *
 * For the consumers that genuinely hold either variant -- the diff, which
 * reports a kind change as a change; the synonym matcher, which compares
 * any two object types; the describe summaries, which render whatever they
 * are given. Those read `undefined` for the other kind, which is exactly
 * what the old single class stored, so they mean what they always meant.
 *
 * Not for a consumer that knows the kind. Narrow with `isEntityType` there
 * and get a `string`: reaching for this instead puts back the optional the
 * union exists to remove, and with it the fallback for a case that cannot
 * happen.
 */
export function referenceModeOf(ot: ObjectType): string | undefined {
  return isEntityType(ot) ? ot.referenceMode : undefined;
}

/** The declared data type when this is a value type. See `referenceModeOf`. */
export function dataTypeOf(ot: ObjectType): DataTypeDef | undefined {
  return isValueType(ot) ? ot.dataType : undefined;
}

/** The value constraint when this is a value type. See `referenceModeOf`. */
export function valueConstraintOf(ot: ObjectType): ValueConstraintDef | undefined {
  return isValueType(ot) ? ot.valueConstraint : undefined;
}
