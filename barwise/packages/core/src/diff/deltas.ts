/**
 * Delta and result types produced by the model diff engine.
 */
import type { Definition } from "../model/Definition.js";
import type { FactType } from "../model/FactType.js";
import type { ObjectType } from "../model/ObjectType.js";

export type DeltaKind = "added" | "removed" | "modified" | "unchanged";

export type BreakingLevel = "safe" | "caution" | "breaking";

export interface ObjectTypeDelta {
  readonly kind: DeltaKind;
  readonly elementType: "object_type";
  readonly name: string;
  /** Present for modified, removed, unchanged. */
  readonly existing?: ObjectType;
  /** Present for added, modified, unchanged. */
  readonly incoming?: ObjectType;
  /** Human-readable descriptions of what changed (empty for add/remove). */
  readonly changeDescriptions: readonly string[];
  /** How risky this change is for downstream consumers. */
  readonly breakingLevel: BreakingLevel;
}

export interface FactTypeDelta {
  readonly kind: DeltaKind;
  readonly elementType: "fact_type";
  readonly name: string;
  readonly existing?: FactType;
  readonly incoming?: FactType;
  readonly changeDescriptions: readonly string[];
  /** How risky this change is for downstream consumers. */
  readonly breakingLevel: BreakingLevel;
}

export interface DefinitionDelta {
  readonly kind: DeltaKind;
  readonly elementType: "definition";
  readonly term: string;
  readonly existing?: Definition;
  readonly incoming?: Definition;
  readonly changeDescriptions: readonly string[];
  /** How risky this change is for downstream consumers. */
  readonly breakingLevel: BreakingLevel;
}

export type ModelDelta = ObjectTypeDelta | FactTypeDelta | DefinitionDelta;

/**
 * A pair of removed + added elements that may represent a rename
 * (i.e. the same concept under a different name). Flagged for human
 * resolution -- never auto-linked.
 */
export interface SynonymCandidate {
  /** The element type being compared. */
  readonly elementType: "object_type" | "fact_type";
  /** Name of the removed element. */
  readonly removedName: string;
  /** Name of the added element. */
  readonly addedName: string;
  /** Index of the removed delta in the deltas array. */
  readonly removedIndex: number;
  /** Index of the added delta in the deltas array. */
  readonly addedIndex: number;
  /** Why the pair was flagged (human-readable reasons). */
  readonly reasons: readonly string[];
}

export interface ModelDiffResult {
  readonly deltas: readonly ModelDelta[];
  readonly hasChanges: boolean;
  /** Potential synonym pairs detected from removed + added elements. */
  readonly synonymCandidates: readonly SynonymCandidate[];
}
