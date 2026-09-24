/**
 * A persisted diagram layout. Stores user-arranged positions for
 * entity types and orientation overrides for fact types.
 *
 * Every reference is an element id, as everywhere else in the model, so a
 * rename leaves the view intact (orm_version 2.0; 1.x keyed by name, and
 * the 1.1 -> 2.0 migration rewrites those on load).
 *
 * Coordinates are integer pixels in screen convention:
 * (0,0) at top-left, x increases right, y increases down.
 */
export interface DiagramLayout {
  /** Display name for this diagram view. */
  readonly name: string;
  /**
   * Ids of the object types included in this view. When present, only these
   * elements (and fact types connecting them) are shown. When absent
   * or empty, all elements are shown.
   */
  readonly elements?: readonly string[];
  /**
   * Element positions, keyed by object type or fact type id.
   * Values are {x, y} in integer pixels.
   */
  readonly positions: Readonly<Record<string, { x: number; y: number; }>>;
  /**
   * Fact type orientation overrides, keyed by fact type id.
   * Only includes fact types where the user explicitly set orientation.
   */
  readonly orientations: Readonly<Record<string, "horizontal" | "vertical">>;
}
