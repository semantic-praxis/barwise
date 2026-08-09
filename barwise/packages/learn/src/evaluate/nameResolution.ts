/**
 * Alias-aware object-type name resolution for the evaluator.
 *
 * Rubrics and reference models name concepts in the transcript's
 * vocabulary, but a candidate may record that vocabulary as an alias
 * ("Consignment") while using a synonym as its primary name
 * ("Shipment"). Checks that grade semantics should not fail on that
 * choice, so matching consults aliases -- with the exact name always
 * taking precedence.
 */
import type { ObjectType, OrmModel } from "@barwise/core";

/** The object type whose name -- or, failing that, an alias -- is `name`. */
export function getObjectTypeByNameOrAlias(
  model: OrmModel,
  name: string,
): ObjectType | undefined {
  return model.getObjectTypeByName(name)
    ?? model.objectTypes.find((ot) => ot.aliases?.includes(name));
}

/**
 * The name to use when matching this object type against another
 * model's vocabulary: its own name if the vocabulary contains it,
 * otherwise the first alias the vocabulary contains, otherwise its own
 * name (so a non-match stays visible as a mismatch).
 */
export function nameInVocabulary(
  ot: ObjectType,
  vocabulary: ReadonlySet<string>,
): string {
  if (vocabulary.has(ot.name)) return ot.name;
  const alias = ot.aliases?.find((a) => vocabulary.has(a));
  return alias ?? ot.name;
}
