/**
 * Intermediate types representing parsed NORMA XML elements.
 *
 * These types mirror the NORMA .orm XML structure and serve as the
 * intermediate representation between raw XML and the in-memory OrmModel.
 * The NormaXmlParser produces these; the NormaToOrmMapper consumes them.
 *
 * We do not embed or redistribute any NORMA source code or XSD schemas.
 * These types are derived from publicly documented file format information.
 */

/** Root document of a parsed NORMA .orm file. */
export interface NormaDocument {
  readonly modelId: string;
  readonly modelName: string;
  readonly entityTypes: NormaEntityType[];
  readonly valueTypes: NormaValueType[];
  readonly objectifiedTypes: NormaObjectifiedType[];
  readonly factTypes: NormaFactType[];
  readonly subtypeFacts: NormaSubtypeFact[];
  readonly constraints: NormaConstraint[];
  /** Data type definitions from the DataTypes section (id -> tag-derived kind). */
  readonly dataTypes: NormaDataType[];
}

/**
 * A data type definition from NORMA's DataTypes section.
 * The kind is derived from the XML tag name (e.g. "VariableLengthTextDataType"
 * becomes "variable_length_text").
 */
export interface NormaDataType {
  readonly id: string;
  readonly kind: string;
}

/** A NORMA EntityType element. */
export interface NormaEntityType {
  readonly id: string;
  readonly name: string;
  readonly referenceMode?: string;
  readonly preferredIdentifier?: string; // ref to UniquenessConstraint id
  readonly playedRoleRefs: readonly string[];
  readonly definition?: string;
}

/** A NORMA ValueType element. */
export interface NormaValueType {
  readonly id: string;
  readonly name: string;
  readonly playedRoleRefs: readonly string[];
  readonly definition?: string;
  readonly valueConstraint?: NormaValueConstraintInline;
  /** Reference to a NormaDataType id from the DataTypes section. */
  readonly dataTypeRef?: string;
  /** Length parameter from ConceptualDataType (e.g. VARCHAR length). */
  readonly dataTypeLength?: number;
  /** Scale parameter from ConceptualDataType (e.g. decimal scale). */
  readonly dataTypeScale?: number;
}

/** Inline value constraint on a ValueType (ValueRestriction). */
export interface NormaValueConstraintInline {
  readonly values: string[];
}

/** A NORMA ObjectifiedType element. */
export interface NormaObjectifiedType {
  readonly id: string;
  readonly name: string;
  readonly nestedFactTypeRef: string; // ref to Fact id
  readonly referenceMode?: string;
  readonly preferredIdentifier?: string;
  readonly playedRoleRefs: readonly string[];
  readonly definition?: string;
}

/** A NORMA Fact (regular fact type). */
export interface NormaFactType {
  readonly id: string;
  readonly name: string;
  readonly roles: NormaRole[];
  readonly readingOrders: NormaReadingOrder[];
  readonly internalConstraintRefs: readonly string[];
  readonly definition?: string;
}

/**
 * NORMA multiplicity annotation on a role.
 * This is derived from uniqueness + mandatory constraints but NORMA
 * stores it as an explicit attribute for convenience.
 */
export type NormaMultiplicity =
  | "ZeroToOne"
  | "ZeroToMany"
  | "ExactlyOne"
  | "OneToMany"
  | "Unspecified";

/** A role within a NORMA fact type. */
export interface NormaRole {
  readonly id: string;
  readonly name: string;
  readonly playerRef: string; // ref to ObjectType id
  readonly isMandatory: boolean;
  readonly multiplicity: NormaMultiplicity;
}

/** A reading order within a NORMA fact type. */
export interface NormaReadingOrder {
  readonly id: string;
  readonly readings: NormaReading[];
  readonly roleSequence: readonly string[]; // ordered role id refs
}

/** A single reading template. */
export interface NormaReading {
  readonly id: string;
  readonly data: string; // e.g. "{0} places {1}"
}

/** A NORMA SubtypeFact element. */
export interface NormaSubtypeFact {
  readonly id: string;
  readonly subtypeRoleId: string;
  readonly subtypePlayerRef: string;
  readonly supertypeRoleId: string;
  readonly supertypePlayerRef: string;
  readonly providesIdentification: boolean;
}

// ---- Constraints ----

/** Discriminated union of all NORMA constraint types. */
export type NormaConstraint =
  | NormaUniquenessConstraint
  | NormaMandatoryConstraint
  | NormaFrequencyConstraint
  | NormaValueConstraint
  | NormaSubsetConstraint
  | NormaExclusionConstraint
  | NormaEqualityConstraint
  | NormaRingConstraint;

export interface NormaUniquenessConstraint {
  readonly type: "uniqueness";
  readonly id: string;
  readonly name: string;
  readonly isInternal: boolean;
  readonly isPreferred: boolean;
  readonly roleRefs: readonly string[];
}

export interface NormaMandatoryConstraint {
  readonly type: "mandatory";
  readonly id: string;
  readonly name: string;
  readonly isSimple: boolean;
  /** True if NORMA auto-generated this constraint (should not be imported). */
  readonly isImplied: boolean;
  readonly roleRefs: readonly string[];
}

export interface NormaFrequencyConstraint {
  readonly type: "frequency";
  readonly id: string;
  readonly name: string;
  readonly min: number;
  readonly max: number | "unbounded";
  readonly roleRefs: readonly string[];
}

export interface NormaValueConstraint {
  readonly type: "value_constraint";
  readonly id: string;
  readonly name: string;
  readonly roleRefs: readonly string[];
  readonly values: string[];
}

export interface NormaSubsetConstraint {
  readonly type: "subset";
  readonly id: string;
  readonly name: string;
  readonly subsetRoleRefs: readonly string[];
  readonly supersetRoleRefs: readonly string[];
}

export interface NormaExclusionConstraint {
  readonly type: "exclusion";
  readonly id: string;
  readonly name: string;
  readonly roleSequences: readonly (readonly string[])[];
}

export interface NormaEqualityConstraint {
  readonly type: "equality";
  readonly id: string;
  readonly name: string;
  readonly roleSequences: readonly (readonly string[])[];
}

export type NormaRingType =
  | "irreflexive"
  | "asymmetric"
  | "antisymmetric"
  | "intransitive"
  | "acyclic"
  | "symmetric"
  | "transitive"
  | "purely_reflexive";

export interface NormaRingConstraint {
  readonly type: "ring";
  readonly id: string;
  readonly name: string;
  readonly ringType: NormaRingType;
  readonly roleRefs: readonly string[];
}
