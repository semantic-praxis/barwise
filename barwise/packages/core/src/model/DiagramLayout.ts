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

/**
 * A layout with the references `isGone` names taken out -- the one rule
 * shared by `OrmModel`'s removals and model merge.
 *
 * `elements` is the exception. An empty list means "show every element"
 * (`DiagramSession.applyNamedView`), so pruning a filtered view's last
 * element would silently turn it into a show-all view, and saving would
 * drop the filter for good. When the prune would empty a list that had
 * entries, the list is kept as it was: the view stays narrowed, as it did
 * under 1.x, and `structural/diagram-dangling-reference` reports the id.
 */
export function withoutDiagramReferences(
  layout: DiagramLayout,
  isGone: (id: string) => boolean,
): DiagramLayout {
  const keep = <T>(record: Readonly<Record<string, T>>) =>
    Object.fromEntries(Object.entries(record).filter(([id]) => !isGone(id)));
  const remaining = layout.elements?.filter((id) => !isGone(id));
  const elements = remaining && remaining.length === 0 && layout.elements!.length > 0
    ? layout.elements
    : remaining;
  return {
    ...layout,
    ...(elements ? { elements } : {}),
    positions: keep(layout.positions),
    orientations: keep(layout.orientations),
  };
}
