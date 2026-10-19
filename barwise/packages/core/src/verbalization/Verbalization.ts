/**
 * Structured verbalization output.
 *
 * Each verbalization is composed of segments that can be rendered
 * with formatting, hyperlinks, and contextual annotations by a UI layer.
 */

/**
 * The kind of a verbalization segment, used for formatting.
 */
export type SegmentKind =
  | "text"
  | "object_type_ref"
  | "keyword"
  | "value_literal";

/**
 * A single segment in a verbalization.
 */
export interface VerbalizationSegment {
  /** The display text. */
  readonly text: string;
  /** The semantic kind (for formatting/linking). */
  readonly kind: SegmentKind;
  /** The model element id this segment refers to (for hyperlinking). */
  readonly elementId?: string;
}

/**
 * A complete verbalization of a model element.
 */
export interface Verbalization {
  /** The ordered segments that compose this verbalization. */
  readonly segments: readonly VerbalizationSegment[];
  /** The flattened plain-text representation. */
  readonly text: string;
  /** The id of the model element this verbalization describes. */
  readonly sourceElementId: string;
  /**
   * What kind of element was verbalized. A `section` row is a heading the
   * model verbalization emits before a group of rows, not an element.
   */
  readonly category:
    | "fact_type"
    | "constraint"
    | "subtype"
    | "objectification"
    | "open_question"
    | "section";
  /**
   * On a constraint row: the fact types the constraint applies to, one
   * for an internal constraint, every fact type holding one of its roles
   * for one across fact types, and its `sourceElementId` is the
   * constraint id. The one exception is an object type's cardinality, a
   * property of the object type rather than a constraint in a list: its
   * row names the object type and has no fact types.
   */
  readonly factTypeIds?: readonly string[];
}

/**
 * Whether a row is a statement about the model, as opposed to the
 * `section` heading the model verbalization places over the constraints
 * across fact types. Consumers that count, number or match statements use
 * it, so that heading is never read as a reading. (The "Open questions"
 * block of `verbalizeModelWithAnnotations` is its own category, and keeps
 * its own heading row.)
 */
export function isStatement(v: { readonly category: string; }): boolean {
  return v.category !== "section";
}

/**
 * Helper to build a Verbalization from segments.
 */
export function buildVerbalization(
  sourceElementId: string,
  category: Verbalization["category"],
  segments: readonly VerbalizationSegment[],
): Verbalization {
  return {
    segments,
    text: segments.map((s) => s.text).join(""),
    sourceElementId,
    category,
  };
}

/** Shorthand segment constructors. */
export function textSeg(text: string): VerbalizationSegment {
  return { text, kind: "text" };
}

export function refSeg(
  text: string,
  elementId: string,
): VerbalizationSegment {
  return { text, kind: "object_type_ref", elementId };
}

export function kwSeg(text: string): VerbalizationSegment {
  return { text, kind: "keyword" };
}

export function valSeg(text: string): VerbalizationSegment {
  return { text, kind: "value_literal" };
}
