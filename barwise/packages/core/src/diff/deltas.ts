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
 * Which kind of element a delta is about.
 *
 * Derived from the union rather than listed beside it, so the two
 * cannot disagree about what kinds exist.
 */
export type ElementType = ModelDelta["elementType"];

/**
 * How each kind of element is named in prose a person reads.
 *
 * This table exists because the union was widening under readers that
 * could not see it widen. Four sites across `cli` and `vscode` wrote
 * `elementType === "object_type" ? "Object type" : "Fact type"`, and a
 * ternary has no exhaustiveness requirement -- so adding a member to
 * `ElementType` would not fail a build, it would display a subtype fact
 * as "Fact type" in `barwise diff`, in `barwise history` and in the VS
 * Code review panel. `Record<ElementType, string>` turns that silent
 * mislabel into a missing key, which is the whole reason this ships
 * before any new element kind does
 * (`docs/specs/typed-diff-all-element-kinds.spec.md`, WS1).
 *
 * The same shape as `CHANGE_LEVEL` next door, for the same reason.
 */
const ELEMENT_LABEL = {
  object_type: "Object type",
  fact_type: "Fact type",
  definition: "Definition",
} as const satisfies Record<ElementType, string>;

/** Every element kind a delta can be about. Derived from the label table. */
export const ELEMENT_TYPES = Object.keys(ELEMENT_LABEL) as readonly ElementType[];

/** How this kind of element is named in prose a person reads. */
export function elementLabel(elementType: ElementType): string {
  return ELEMENT_LABEL[elementType];
}

/**
 * How a surface names one delta: the element kind and what it is about.
 *
 * Three files carried this same function -- `cli`'s `diff` and
 * `history` commands and the VS Code import review -- identical in
 * meaning and differing only in line wrapping, with nothing guarding
 * the triplicate. It is one function now, so adding an element kind
 * updates every surface that renders a delta.
 *
 * `import/shared.ts` and `mcp`'s `import.ts` reach the same answer
 * through `elementName`, which is the piece they were hand-rolling as
 * `"name" in d ? d.name : d.term` -- a duck-type check that would pick
 * `name` for any future kind carrying one, right or wrong, and throw on
 * a kind carrying neither.
 */
export function deltaLabel(delta: ModelDelta): string {
  return `${elementLabel(delta.elementType)}: ${elementName(delta)}`;
}

/**
 * What this delta is about, as the text a surface displays.
 *
 * A definition is identified by its term and the other kinds by their
 * name, which four files expressed as `d.elementType === "definition" ?
 * d.term : d.name` -- a two-case expression repeated wherever a delta
 * was rendered, and one that has no answer for a kind carrying neither
 * field. One function, one switch the compiler counts.
 */
export function elementName(delta: ModelDelta): string {
  switch (delta.elementType) {
    case "definition":
      return delta.term;
    case "object_type":
    case "fact_type":
      return delta.name;
  }
}

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
