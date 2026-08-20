/**
 * Alias-aware object-type name resolution for the evaluator.
 *
 * Rubrics and reference models name concepts in the transcript's
 * vocabulary, but a candidate may record that vocabulary as an alias
 * ("Consignment") while using a synonym as its primary name
 * ("Shipment"). Checks that grade semantics should not fail on that
 * choice, so matching consults aliases -- with the exact name always
 * taking precedence.
 *
 * Matching is also insensitive to case and to the separators that
 * distinguish one spelling of a compound term from another. A model
 * that records "Course Offering" as an alias is naming the same concept
 * as a rubric asking for "CourseOffering", and grading it as a miss
 * measures the speaker's spacing rather than the modeller's judgment.
 * Exact matches still win, so normalization only ever rescues a
 * comparison that would otherwise have failed.
 */
import type { ObjectType, OrmModel } from "@barwise/core";

/**
 * Case-folded, separator-stripped form used only for comparison.
 * Spaces, hyphens, underscores, and periods separate words in one
 * spelling of a compound term and are absent in another; nothing else
 * is removed, so "Order" and "Orders" stay distinct.
 */
export function normalizeForMatch(name: string): string {
  return name.toLowerCase().replace(/[\s\-_.]/g, "");
}

/**
 * The object type whose name -- or, failing that, an alias -- is `name`.
 *
 * Resolution order is exact name, exact alias, normalized name,
 * normalized alias, so a model carrying both an exact and an
 * approximate match resolves to the exact one. Within each tier the
 * first match in declared order wins, keeping the result deterministic.
 */
export function getObjectTypeByNameOrAlias(
  model: OrmModel,
  name: string,
): ObjectType | undefined {
  const exact = model.getObjectTypeByName(name)
    ?? model.objectTypes.find((ot) => ot.aliases?.includes(name));
  if (exact) return exact;

  const target = normalizeForMatch(name);
  return model.objectTypes.find((ot) => normalizeForMatch(ot.name) === target)
    ?? model.objectTypes.find((ot) => ot.aliases?.some((a) => normalizeForMatch(a) === target));
}

/**
 * The name to use when matching this object type against another
 * model's vocabulary: its own name if the vocabulary contains it,
 * otherwise the first alias the vocabulary contains, otherwise its own
 * name (so a non-match stays visible as a mismatch).
 *
 * Returns the vocabulary's spelling, not the candidate's, so the caller
 * gets a name it can look up on the other side.
 */
export function nameInVocabulary(
  ot: ObjectType,
  vocabulary: ReadonlySet<string>,
): string {
  if (vocabulary.has(ot.name)) return ot.name;
  const alias = ot.aliases?.find((a) => vocabulary.has(a));
  if (alias !== undefined) return alias;

  // Fall back to a normalized lookup, returning the vocabulary's own
  // spelling so downstream exact lookups against it still succeed.
  const index = new Map<string, string>();
  for (const term of vocabulary) {
    const key = normalizeForMatch(term);
    if (!index.has(key)) index.set(key, term);
  }
  const candidates = [ot.name, ...(ot.aliases ?? [])];
  for (const candidate of candidates) {
    const match = index.get(normalizeForMatch(candidate));
    if (match !== undefined) return match;
  }
  return ot.name;
}
