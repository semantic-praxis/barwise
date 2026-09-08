/**
 * Delta and result types produced by the model diff engine.
 */
import type { Definition } from "../model/Definition.js";
import type { FactType } from "../model/FactType.js";
import type { ObjectifiedFactType } from "../model/ObjectifiedFactType.js";
import type { ObjectType } from "../model/ObjectType.js";
import type { SubtypeFact } from "../model/SubtypeFact.js";
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

/**
 * An element a delta references, as plain data.
 *
 * Both the id and the name, for the reason `RoleSummary` carries both:
 * the two sides of a delta resolve against two DIFFERENT models, so a
 * consumer holding only the delta has no model in which to look the
 * name up. The id is identity; the name is what a person reads.
 */
export interface ElementRef {
  readonly id: string;
  readonly name: string;
}

/**
 * A subtype fact: this entity type is a subtype of that one.
 *
 * It has no name of its own, so its identity is the resolved pair --
 * which is also how `diffModels` matches one across two models, since
 * re-extraction mints fresh ids and only names survive.
 */
export interface SubtypeFactDelta extends DeltaCommon {
  readonly elementType: "subtype_fact";
  readonly subtype: ElementRef;
  readonly supertype: ElementRef;
  readonly existing?: SubtypeFact;
  readonly incoming?: SubtypeFact;
}

/**
 * An objectified fact type: this entity type IS that relationship.
 *
 * `ObjectifiedFactType` carries nothing beyond its two references, so
 * there is no content that could differ between two of them that match.
 * The type says so rather than leaving it to a comment: `kind` excludes
 * `"modified"` and `changes` is the empty tuple, so a `modified`
 * objectification cannot be constructed and a non-empty change list
 * cannot be attached to one.
 */
export interface ObjectifiedFactTypeDelta extends Omit<DeltaCommon, "kind" | "changes"> {
  readonly elementType: "objectified_fact_type";
  readonly kind: Exclude<DeltaKind, "modified">;
  readonly changes: readonly [];
  readonly objectType: ElementRef;
  readonly factType: ElementRef;
  readonly existing?: ObjectifiedFactType;
  readonly incoming?: ObjectifiedFactType;
}

export type ModelDelta =
  | ObjectTypeDelta
  | FactTypeDelta
  | DefinitionDelta
  | SubtypeFactDelta
  | ObjectifiedFactTypeDelta;

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
 * could not see it widen. Seven sites across six files in `cli`, `mcp`
 * and `vscode` chose between kinds without exhaustiveness: three wrote
 * `elementType === "object_type" ? "Object type" : "Fact type"`, two
 * wrote `elementType === "definition" ? d.term : d.name`, and two the
 * duck-type `"name" in d ? d.name : d.term`. A ternary has no
 * exhaustiveness requirement -- so adding a member to
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
  subtype_fact: "Subtype fact",
  objectified_fact_type: "Objectification",
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
 * name. That choice was made at all seven sites above, in four
 * spellings -- inside each copy of the label helper, as a bare
 * `d.elementType === "definition" ? d.term : d.name`, and as the
 * duck-type check -- and none of them has an answer for a kind carrying
 * neither field. One function, one switch the compiler counts.
 */
export function elementName(delta: ModelDelta): string {
  switch (delta.elementType) {
    case "definition":
      return delta.term;
    case "object_type":
    case "fact_type":
      return delta.name;
    // A subtype fact borrows the verbalizer's own words ("X is a subtype
    // of Y"), so the diff names it the way the rest of the product does.
    // An objectification cannot: the verbalizer renders it as "X is
    // where <the fact type's primary reading>", and a delta has the fact
    // type's NAME rather than a reading, so "objectifies" is this
    // module's own word for it.
    case "subtype_fact":
      return `${delta.subtype.name} is a subtype of ${delta.supertype.name}`;
    case "objectified_fact_type":
      return `${delta.objectType.name} objectifies ${delta.factType.name}`;
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
