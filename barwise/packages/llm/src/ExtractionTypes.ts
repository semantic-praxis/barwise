/**
 * Types for the LLM extraction pipeline.
 *
 * These represent the structured output the LLM produces when
 * processing a transcript, and the intermediate forms used to
 * convert that output into an OrmModel.
 */

// ---------------------------------------------------------------------------
// Source references (traceability from model elements back to transcript)
// ---------------------------------------------------------------------------

/**
 * A reference to a specific location in the source transcript.
 * Provides an audit trail from extracted model elements back to
 * the stakeholder's actual words.
 */
export interface SourceReference {
  /** Start and end line numbers in the transcript (1-based, inclusive). */
  readonly lines: readonly [number, number];
  /** Verbatim excerpt from the transcript. */
  readonly excerpt: string;
  /** File path, when source is code rather than a transcript. */
  readonly filePath?: string;
}

// ---------------------------------------------------------------------------
// Extraction response (what the LLM produces)
// ---------------------------------------------------------------------------

export interface ExtractedObjectType {
  readonly name: string;
  readonly kind: "entity" | "value";
  readonly definition?: string;
  /** Reference mode for entity types (e.g. "customer_id"). */
  readonly reference_mode?: string;
  /** Enumerated values for value types. */
  readonly value_constraint?: { readonly values: readonly string[]; };
  /**
   * Conceptual data type for value types (e.g. "text", "integer", "date").
   * Optional length/scale for parameterized types like text(50) or decimal(10,2).
   */
  readonly data_type?: {
    readonly name: string;
    readonly length?: number;
    readonly scale?: number;
  };
  /** Alternative names / synonyms used interchangeably with the primary name. */
  readonly aliases?: readonly string[];
  readonly source_references: readonly SourceReference[];
}

export interface ExtractedRole {
  /** Object type name (not id -- names are resolved during parsing). */
  readonly player: string;
  readonly role_name: string;
}

export interface ExtractedFactType {
  readonly name: string;
  readonly roles: readonly ExtractedRole[];
  /** Reading templates, e.g. ["{0} places {1}", "{1} is placed by {0}"]. */
  readonly readings: readonly string[];
  readonly source_references: readonly SourceReference[];
}

export type InferredConstraintType =
  | "internal_uniqueness"
  | "mandatory"
  | "value_constraint"
  | "external_uniqueness"
  | "disjunctive_mandatory"
  | "exclusion"
  | "exclusive_or"
  | "subset"
  | "equality"
  | "ring"
  | "frequency";

export interface InferredConstraint {
  readonly type: InferredConstraintType;
  /** The name of the fact type this constraint applies to. */
  readonly fact_type: string;
  /**
   * Role player names identifying which roles the constraint covers.
   * For internal_uniqueness: the player names of the unique roles.
   * For mandatory: the player name of the mandatory role.
   * For value_constraint: the player name of the constrained role.
   */
  readonly roles: readonly string[];
  /** Human-readable description of the business rule. */
  readonly description: string;
  readonly confidence: "high" | "medium" | "low";
  /**
   * For internal_uniqueness constraints only: marks this as the entity's
   * preferred identifier (primary reference scheme). At most one uniqueness
   * constraint per entity should be marked as preferred.
   */
  readonly is_preferred?: boolean;
  /**
   * For value_constraint only: the allowed values.
   * Required when type is "value_constraint".
   */
  readonly values?: readonly string[];
  /**
   * For ring constraints only: the ring property being constrained.
   * One of: irreflexive, asymmetric, antisymmetric, intransitive,
   * acyclic, symmetric, transitive, purely_reflexive.
   */
  readonly ring_type?: string;
  /**
   * For frequency constraints only: minimum occurrences.
   */
  readonly min?: number;
  /**
   * For frequency constraints only: maximum occurrences or "unbounded".
   */
  readonly max?: number | "unbounded";
  /**
   * For subset/equality constraints: the second fact type name.
   * The primary fact_type field identifies the first (subset/equality-1) side.
   */
  readonly superset_fact_type?: string;
  /**
   * For subset/equality constraints: role player names for the superset
   * (or second) side. The primary roles field identifies the subset
   * (or first) side.
   */
  readonly superset_roles?: readonly string[];
  readonly source_references: readonly SourceReference[];
}

export interface ExtractedSubtype {
  /** Name of the subtype entity (must match an extracted object type). */
  readonly subtype: string;
  /** Name of the supertype entity (must match an extracted object type). */
  readonly supertype: string;
  /** Whether the subtype uses the supertype's identification scheme. */
  readonly provides_identification?: boolean;
  /** Human-readable description of the subtype relationship. */
  readonly description: string;
  readonly source_references: readonly SourceReference[];
}

export interface ExtractedObjectifiedFactType {
  /** Name of the fact type being objectified (must match an extracted fact type). */
  readonly fact_type: string;
  /** Name of the entity type created by objectification (must match an extracted object type). */
  readonly object_type: string;
  /** Human-readable description of why this relationship is objectified. */
  readonly description: string;
  readonly source_references: readonly SourceReference[];
}

export interface Ambiguity {
  readonly description: string;
  readonly source_references: readonly SourceReference[];
}

/**
 * A single fact instance extracted from an example in the transcript.
 */
export interface ExtractedFactInstance {
  /** Role player name to example value mapping. */
  readonly role_values: Record<string, string>;
}

/**
 * A population (set of sample fact instances) extracted from the transcript.
 */
export interface ExtractedPopulation {
  /** Name of the fact type this population samples. */
  readonly fact_type: string;
  /** Optional description of these examples. */
  readonly description?: string;
  /** Sample fact instances. */
  readonly instances: readonly ExtractedFactInstance[];
  readonly source_references: readonly SourceReference[];
}

/**
 * An alternative framing of the domain: a full candidate model that takes
 * the other side of a structural fork, plus why. Parsed and diffed against
 * the primary model. Carries no nested ambiguities or alternatives.
 */
export interface ExtractionAlternative {
  /** One sentence naming what this framing does differently. */
  readonly rationale: string;
  /** The ambiguity (fork) this framing resolves. */
  readonly ambiguity_description: string;
  readonly object_types: readonly ExtractedObjectType[];
  readonly fact_types: readonly ExtractedFactType[];
  readonly subtypes: readonly ExtractedSubtype[];
  readonly inferred_constraints: readonly InferredConstraint[];
  readonly objectified_fact_types?: readonly ExtractedObjectifiedFactType[];
  readonly populations?: readonly ExtractedPopulation[];
}

/**
 * The complete structured response from the LLM extraction.
 * This is the JSON shape the LLM is instructed to produce.
 */
export interface ExtractionResponse {
  readonly object_types: readonly ExtractedObjectType[];
  readonly fact_types: readonly ExtractedFactType[];
  readonly subtypes: readonly ExtractedSubtype[];
  readonly inferred_constraints: readonly InferredConstraint[];
  readonly objectified_fact_types?: readonly ExtractedObjectifiedFactType[];
  readonly populations?: readonly ExtractedPopulation[];
  readonly ambiguities: readonly Ambiguity[];
  /** Alternative framings, present only when extraction requested them. */
  readonly alternatives?: readonly ExtractionAlternative[];
}

// ---------------------------------------------------------------------------
// Draft model result (what the parser produces)
// ---------------------------------------------------------------------------

/**
 * Metadata attached to a model element tracing it back to the transcript.
 */
export interface ElementProvenance {
  readonly elementName: string;
  readonly sourceReferences: readonly SourceReference[];
}

/**
 * A constraint that the LLM inferred with its confidence level.
 */
export interface ConstraintProvenance {
  readonly description: string;
  readonly confidence: "high" | "medium" | "low";
  readonly sourceReferences: readonly SourceReference[];
  readonly applied: boolean;
  /** If not applied, the reason it was skipped. */
  readonly skipReason?: string;
}

/**
 * Provenance for a subtype relationship extracted by the LLM.
 */
export interface SubtypeProvenance {
  readonly subtype: string;
  readonly supertype: string;
  readonly sourceReferences: readonly SourceReference[];
  readonly applied: boolean;
  /** If not applied, the reason it was skipped. */
  readonly skipReason?: string;
}

/**
 * Provenance for an objectified fact type extracted by the LLM.
 */
export interface ObjectificationProvenance {
  readonly factType: string;
  readonly objectType: string;
  readonly sourceReferences: readonly SourceReference[];
  readonly applied: boolean;
  /** If not applied, the reason it was skipped. */
  readonly skipReason?: string;
}

/**
 * A parsed alternative framing: the rival model and its diff against the
 * primary. Generation is non-deterministic (llm); the diff is
 * deterministic (core).
 */
export interface CandidateFraming {
  /** One sentence naming what this framing does differently. */
  readonly rationale: string;
  /** The ambiguity (fork) this framing resolves. */
  readonly ambiguityDescription: string;
  /** The rival model, parsed via the same path as the primary. */
  readonly model: import("@barwise/core").OrmModel;
  /** The diff of this framing against the primary model. */
  readonly diff: import("@barwise/core/diff").ModelDiffResult;
}

/**
 * The result of parsing an extraction response into an OrmModel.
 */
export interface DraftModelResult {
  /** The constructed ORM model (may be incomplete). */
  readonly model: import("@barwise/core").OrmModel;
  /** Provenance for each extracted object type. */
  readonly objectTypeProvenance: readonly ElementProvenance[];
  /** Provenance for each extracted fact type. */
  readonly factTypeProvenance: readonly ElementProvenance[];
  /** Status of each extracted subtype relationship. */
  readonly subtypeProvenance: readonly SubtypeProvenance[];
  /** Status of each inferred constraint. */
  readonly constraintProvenance: readonly ConstraintProvenance[];
  /** Status of each objectified fact type. */
  readonly objectificationProvenance: readonly ObjectificationProvenance[];
  /** Ambiguities identified by the LLM. */
  readonly ambiguities: readonly Ambiguity[];
  /** Alternative framings, present only when extraction requested them. */
  readonly alternatives?: readonly CandidateFraming[];
  /** Warnings generated during parsing (non-fatal issues). */
  readonly warnings: readonly string[];
  /** The model identifier that handled the extraction, if reported by the provider. */
  readonly modelUsed?: string;
  /** Token usage reported by the provider, if available. */
  readonly usage?: {
    readonly promptTokens?: number;
    readonly completionTokens?: number;
  };
  /** Wall-clock time of the LLM call in milliseconds, if measured. */
  readonly latencyMs?: number;
  /** Raw LLM response content (for verbose logging). */
  readonly rawResponse?: string;
}
