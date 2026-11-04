/**
 * The items whose key occurs more than once, grouped by that key in first
 * occurrence order, each group in input order. Items whose key is
 * `undefined` are never grouped.
 *
 * One answer to "what is a repeat" for every check that asks it: the 3.0
 * loader over the constraints a file states, `OrmModel.constraintsSharingAnId`
 * over a built model, and `structural/duplicate-subtype-fact` over subtype
 * pairs. Before it, each grouped by hand.
 */
export function groupRepeats<T>(
  items: Iterable<T>,
  keyOf: (item: T) => string | undefined,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    if (key === undefined) continue;
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  for (const [key, group] of groups) if (group.length < 2) groups.delete(key);
  return groups;
}
