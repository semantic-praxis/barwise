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
   * elements (and fact types connecting them) are shown, so an empty list
   * is an empty view. When absent, all elements are shown.
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

/**
 * Whether a layout is scoped to a list of elements. The one place the
 * 2.0 rule lives: an absent `elements` means "show every element", and
 * any list -- the empty one included -- is the view's whole content.
 * Every reader of `elements` asks here rather than restating the test,
 * because restating it is how "absent" and "empty" came to mean the same
 * thing in the first place (barwise-1066).
 */
export function isScopedView(
  layout: DiagramLayout,
): layout is DiagramLayout & { readonly elements: readonly string[]; } {
  return layout.elements !== undefined;
}

/**
 * A layout with the references `isGone` names taken out -- the one rule
 * shared by `OrmModel`'s removals and model merge. An `elements` list
 * pruned to nothing stays `[]`, an empty view, not absent, which would
 * mean "show every element".
 */
export function withoutDiagramReferences(
  layout: DiagramLayout,
  isGone: (id: string) => boolean,
): DiagramLayout {
  const keep = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => !isGone(id)));
  return {
    ...layout,
    ...(layout.elements ? { elements: layout.elements.filter((id) => !isGone(id)) } : {}),
    positions: keep(layout.positions),
    orientations: keep(layout.orientations),
  };
}
