import { generateId } from "./id.js";
import { requireName } from "./name.js";

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
  /** Trimmed and non-empty; `createObjectType` refuses anything else. */
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
 * Build an object type from a config, applying every default and refusing
 * every combination the old constructor threw for.
 *
 * The refusals are unchanged in wording and in what they reject; what
 * changes is that two of them are now unreachable from typed code, since
 * a caller with an `EntityTypeConfig` cannot omit the reference mode and
 * one with a `ValueTypeConfig` cannot supply it. They stay because
 * `ObjectTypeConfig` is also built from parsed YAML, where the compiler
 * has no say.
 */
export function createObjectType(config: ObjectTypeConfig): ObjectType {
  const name = requireName(config.name);

  if (config.valueConstraint) {
    const { values, ranges } = config.valueConstraint;
    if (values.length === 0 && (ranges?.length ?? 0) === 0) {
      throw new Error(
        `Value constraint on "${name}" must have at least one value or range.`,
      );
    }
  }

  if (config.cardinality) {
    const { min, max } = config.cardinality;
    if (min < 0) {
      throw new Error(
        `Cardinality on "${name}" must have a non-negative minimum.`,
      );
    }
    if (max !== "unbounded" && max < min) {
      throw new Error(`Cardinality on "${name}" must have max >= min.`);
    }
  }

  const base = {
    id: config.id ?? generateId(),
    name,
    aliases: Object.freeze([...(config.aliases ?? [])]),
    independent: config.independent ?? false,
    ...(config.definition !== undefined ? { definition: config.definition } : {}),
    ...(config.sourceContext !== undefined ? { sourceContext: config.sourceContext } : {}),
    ...(config.note !== undefined ? { note: config.note } : {}),
    ...(config.cardinality !== undefined ? { cardinality: config.cardinality } : {}),
  };

  if (config.kind === "entity") {
    if (!config.referenceMode) {
      throw new Error(`Entity type "${name}" must have a reference mode.`);
    }
    return Object.freeze({ ...base, kind: "entity", referenceMode: config.referenceMode });
  }

  if (config.referenceMode) {
    throw new Error(`Value type "${name}" should not have a reference mode.`);
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
