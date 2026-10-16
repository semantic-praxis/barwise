import { generateId } from "./id.js";
import { decodeObjectTypeConfig, runObjectTypeDecode } from "./objectTypeDecoder.js";
import type {
  CardinalityRange,
  DataTypeDef,
  EntityType,
  KeysAgree,
  ObjectType,
  ObjectTypeKind,
  ObjectTypeModelCodec,
  ValueConstraintDef,
  ValueType,
} from "./objectTypeSchema.js";

// The record types, the data type names and the value-only list are derived
// from or stated in the schema; this module is where consumers have always
// found them.
export {
  type CardinalityRange,
  CONCEPTUAL_DATA_TYPE_NAMES,
  type ConceptualDataTypeName,
  type DataTypeDef,
  type EntityType,
  type ObjectType,
  type ObjectTypeBase,
  type ObjectTypeKind,
  VALUE_ONLY_FIELDS,
  type ValueConstraintDef,
  type ValueRange,
  type ValueType,
} from "./objectTypeSchema.js";

/**
 * Configuration for creating a new ObjectType.
 *
 * Hand-written rather than derived, because it is deliberately broader than
 * either variant: one type for both kinds, which is what lets a caller build
 * a config from data without first deciding the kind. Its keys are the
 * decoder's all the same -- `_configKeysAgree` below fails to compile when
 * either side gains or loses one.
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

const _configKeysAgree: KeysAgree<ObjectTypeConfig, typeof ObjectTypeModelCodec.Encoded> = true;

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
 * every malformed combination -- all of them at once, as an `ObjectTypeError`
 * whose `problems` list one per problem.
 *
 * The checks are the schema's (`objectTypeSchema.ts`), run through the
 * decoder: `ObjectTypeConfig` is one broad type, so the compiler lets a
 * caller omit an entity's reference mode, give a value type one, or put a
 * value-only field on an entity, and only a run-time check can refuse them.
 * A config without an id gets one from the installed generator, supplied
 * here because the decoder does not reach it.
 */
export function createObjectType(config: ObjectTypeConfig): ObjectType {
  return runObjectTypeDecode(decodeObjectTypeConfig(config), generateId);
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
