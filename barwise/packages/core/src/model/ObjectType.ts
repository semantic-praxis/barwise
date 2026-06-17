import { ModelElement } from "./ModelElement.js";

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
}

/**
 * An ObjectType represents a concept in the domain.
 *
 * Entity types are identified by a reference scheme (e.g. Customer identified
 * by customer_id). Value types are self-identifying (e.g. a Name string or
 * a Rating enumeration).
 */
export class ObjectType extends ModelElement {
  readonly kind: ObjectTypeKind;
  private _referenceMode: string | undefined;
  private _definition: string | undefined;
  private _sourceContext: string | undefined;
  private _valueConstraint: ValueConstraintDef | undefined;
  private _dataType: DataTypeDef | undefined;
  private _aliases: readonly string[] | undefined;

  constructor(config: ObjectTypeConfig) {
    super(config.name, config.id);
    this.kind = config.kind;
    this._referenceMode = config.referenceMode;
    this._definition = config.definition;
    this._sourceContext = config.sourceContext;
    this._valueConstraint = config.valueConstraint;
    this._dataType = config.dataType;
    this._aliases = config.aliases && config.aliases.length > 0
      ? Object.freeze([...config.aliases])
      : undefined;

    if (this.kind === "entity" && !this._referenceMode) {
      throw new Error(
        `Entity type "${this.name}" must have a reference mode.`,
      );
    }

    if (this.kind === "value" && this._referenceMode) {
      throw new Error(
        `Value type "${this.name}" should not have a reference mode.`,
      );
    }

    if (
      this._valueConstraint
      && this._valueConstraint.values.length === 0
      && (this._valueConstraint.ranges?.length ?? 0) === 0
    ) {
      throw new Error(
        `Value constraint on "${this.name}" must have at least one value or range.`,
      );
    }
  }

  get referenceMode(): string | undefined {
    return this._referenceMode;
  }

  get definition(): string | undefined {
    return this._definition;
  }

  set definition(value: string | undefined) {
    this._definition = value;
  }

  get sourceContext(): string | undefined {
    return this._sourceContext;
  }

  set sourceContext(value: string | undefined) {
    this._sourceContext = value;
  }

  get valueConstraint(): ValueConstraintDef | undefined {
    return this._valueConstraint;
  }

  get dataType(): DataTypeDef | undefined {
    return this._dataType;
  }

  get aliases(): readonly string[] | undefined {
    return this._aliases;
  }

  get isEntity(): boolean {
    return this.kind === "entity";
  }

  get isValue(): boolean {
    return this.kind === "value";
  }
}
