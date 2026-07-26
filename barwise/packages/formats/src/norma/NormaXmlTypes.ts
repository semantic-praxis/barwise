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
  /** ORMDiagram sections (shape geometry), siblings of the ORMModel. */
  readonly diagrams?: NormaDiagram[];
}

/** Constraint modality: NORMA emits Modality="Deontic"; alethic is the default. */
export type NormaModality = "alethic" | "deontic";

/** One From/To population bound; To omitted means unbounded. */
export interface NormaCardinalityRange {
  readonly from: number;
  readonly to?: number;
}

/** A cardinality constraint (object-type population bound). */
export interface NormaCardinality {
  readonly id: string;
  readonly ranges: readonly NormaCardinalityRange[];
}

/**
 * A fact-type derivation rule. The rule body is carried as the informal
 * DerivationNote text; completeness and storage mirror NORMA's
 * DerivationCompleteness / DerivationStorage attributes.
 */
export interface NormaDerivationRule {
  readonly id: string;
  readonly completeness?: "FullyDerived" | "PartiallyDerived";
  readonly storage?: "NotStored" | "Stored";
  readonly noteId: string;
  readonly noteBody: string;
}

/** One diagram shape: a positioned object-type or fact-type box. */
export interface NormaShape {
  readonly id: string;
  readonly kind: "object_type" | "fact_type";
  /** ref to the ObjectType / Fact element this shape displays. */
  readonly subjectRef: string;
  /** AbsoluteBounds, in NORMA's inch coordinates: x, y, width, height. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One ormDiagram:ORMDiagram section. */
export interface NormaDiagram {
  readonly id: string;
  readonly name: string;
  readonly shapes: readonly NormaShape[];
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
  readonly independent?: boolean;
  readonly cardinality?: NormaCardinality;
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
  readonly independent?: boolean;
  readonly cardinality?: NormaCardinality;
}

/** A value range parsed from a NORMA ValueRange element. */
export interface NormaValueRange {
  readonly min?: string;
  readonly max?: string;
  readonly minInclusive?: boolean;
  readonly maxInclusive?: boolean;
}

/** Inline value constraint on a ValueType (ValueRestriction). */
export interface NormaValueConstraintInline {
  readonly values: string[];
  readonly ranges?: NormaValueRange[];
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
  readonly cardinality?: NormaCardinality;
}

/** A NORMA Fact (regular fact type). */
export interface NormaFactType {
  readonly id: string;
  readonly name: string;
  readonly roles: NormaRole[];
  readonly readingOrders: NormaReadingOrder[];
  readonly internalConstraintRefs: readonly string[];
  readonly definition?: string;
  readonly derivationRule?: NormaDerivationRule;
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
  readonly modality?: NormaModality;
  readonly isInternal: boolean;
  readonly isPreferred: boolean;
  readonly roleRefs: readonly string[];
}

export interface NormaMandatoryConstraint {
  readonly type: "mandatory";
  readonly id: string;
  readonly name: string;
  readonly modality?: NormaModality;
  readonly isSimple: boolean;
  /** True if NORMA auto-generated this constraint (should not be imported). */
  readonly isImplied: boolean;
  readonly roleRefs: readonly string[];
}

export interface NormaFrequencyConstraint {
  readonly type: "frequency";
  readonly id: string;
  readonly name: string;
  readonly modality?: NormaModality;
  readonly min: number;
  readonly max: number | "unbounded";
  readonly roleRefs: readonly string[];
}

export interface NormaValueConstraint {
  readonly type: "value_constraint";
  readonly id: string;
  readonly name: string;
  readonly modality?: NormaModality;
  readonly roleRefs: readonly string[];
  readonly values: string[];
  readonly ranges?: NormaValueRange[];
}

export interface NormaSubsetConstraint {
  readonly type: "subset";
  readonly id: string;
  readonly name: string;
  readonly modality?: NormaModality;
  readonly subsetRoleRefs: readonly string[];
  readonly supersetRoleRefs: readonly string[];
  /** Join path attached to the subset role sequence, if any. */
  readonly subsetJoinPath?: NormaJoinPath;
  /** Join path attached to the superset role sequence, if any. */
  readonly supersetJoinPath?: NormaJoinPath;
}

export interface NormaExclusionConstraint {
  readonly type: "exclusion";
  readonly id: string;
  readonly name: string;
  readonly modality?: NormaModality;
  readonly roleSequences: readonly (readonly string[])[];
  /** Join path per role sequence (parallel to roleSequences), if any. */
  readonly joinPaths?: readonly (NormaJoinPath | undefined)[];
}

export interface NormaEqualityConstraint {
  readonly type: "equality";
  readonly id: string;
  readonly name: string;
  readonly modality?: NormaModality;
  readonly roleSequences: readonly (readonly string[])[];
  /** Join path per role sequence (parallel to roleSequences), if any. */
  readonly joinPaths?: readonly (NormaJoinPath | undefined)[];
}

// ---- Join paths ----

/**
 * How a pathed role attaches to the join path being walked:
 * "None" starts the path at the root object type, "PostInnerJoin" joins
 * into a new fact type from the current path node, and "SameFactType"
 * continues within the entry role's fact type (the hop's exit).
 */
export type NormaPathedRolePurpose = "None" | "PostInnerJoin" | "SameFactType";

/** One purpose-tagged role along a NORMA join path. */
export interface NormaPathedRole {
  readonly id: string;
  readonly roleRef: string;
  readonly purpose: NormaPathedRolePurpose;
}

/** A linear role path: a root object type and its pathed roles, in order. */
export interface NormaRolePathDef {
  readonly id: string;
  readonly rootObjectTypeRef: string;
  readonly pathedRoles: readonly NormaPathedRole[];
}

/**
 * Projection of one constraint role from a pathed role. Listed in the
 * constraint role sequence's order; `pathedRoleRef` names the PathedRole
 * element (by id) whose player the constraint column projects.
 */
export interface NormaJoinProjection {
  readonly constraintRoleRef: string;
  readonly pathedRoleRef: string;
}

/**
 * A join path attached to one role sequence of a set-comparison
 * constraint: the role path plus the projection that selects the
 * compared columns.
 */
export interface NormaJoinPath {
  readonly id: string;
  readonly rolePath: NormaRolePathDef;
  readonly projections: readonly NormaJoinProjection[];
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
  readonly modality?: NormaModality;
  readonly ringType: NormaRingType;
  readonly roleRefs: readonly string[];
}
