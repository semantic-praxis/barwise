/**
 * Delta and result types produced by the model diff engine.
 */
import type { Definition } from "../model/Definition.js";
import type { FactType } from "../model/FactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { ChangeDescription } from "./changeDescription.js";

export type DeltaKind = "added" | "removed" | "modified" | "unchanged";

export type BreakingLevel = "safe" | "caution" | "breaking";

/**
 * What every delta carries regardless of which element it is about.
 *
 * Shared rather than restated three times: the three element deltas
 * have to agree on these fields, and WS3 adding `changes` to all three
 * is exactly the kind of edit where one of them gets missed.
 */
interface DeltaCommon {
  readonly kind: DeltaKind;
  /**
   * What changed, as data (empty for add/remove).
   *
   * This is the authority; `changeDescriptions` is rendered from it.
   * Breaking-level classification reads these variants, so a change the
   * diff can emit and nobody classified is a compile error rather than
   * a silent `caution` (barwise-946).
   */
  readonly changes: readonly ChangeDescription[];
  /**
   * The same changes as the sentences every surface displays.
   *
   * Derived from `changes` once, at diff time, by `describeChange`.
   * Kept because the CLI's output, the MCP tool's JSON and the VS Code
   * summary all read it; making the structured form available is a
   * separate decision from changing what any of them shows.
   */
  readonly changeDescriptions: readonly string[];
  /** How risky this change is for downstream consumers. */
  readonly breakingLevel: BreakingLevel;
}

export interface ObjectTypeDelta extends DeltaCommon {
  readonly elementType: "object_type";
  readonly name: string;
  /** Present for modified, removed, unchanged. */
  readonly existing?: ObjectType;
  /** Present for added, modified, unchanged. */
  readonly incoming?: ObjectType;
}

export interface FactTypeDelta extends DeltaCommon {
  readonly elementType: "fact_type";
  readonly name: string;
  readonly existing?: FactType;
  readonly incoming?: FactType;
}

export interface DefinitionDelta extends DeltaCommon {
  readonly elementType: "definition";
  readonly term: string;
  readonly existing?: Definition;
  readonly incoming?: Definition;
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
