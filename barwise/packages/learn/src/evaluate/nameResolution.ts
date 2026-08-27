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
 *
 * When the exercise declares a licence (`NameLicence`), a final tier
 * resolves through it: two words the case declares to denote one
 * concept match even though the candidate recorded no alias
 * (docs/specs/eval-name-licensing.spec.md). Synonymy is declared, never
 * inferred -- no substring or edit-distance matching, so "Course" stays
 * distinct from "CourseOffering" unless a set licenses the pair.
 *
 * Every widening tier -- normalization and licence alike -- is
 * append-only: exact matches still win, so a later tier only ever
 * rescues a comparison that would otherwise have failed, never
 * redirects one that succeeded.
 */
import type { ObjectType, OrmModel } from "@barwise/core";
import type { NameLicence } from "../exercise/types.js";

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
 * The licence set containing `name` (compared normalized), if any.
 * The parser rejects a word appearing in two sets, so the first set
 * found is the only one.
 */
function licenceSetFor(name: string, licence: NameLicence): readonly string[] | undefined {
  const key = normalizeForMatch(name);
  return licence.find((set) => set.some((word) => normalizeForMatch(word) === key));
}

/** The four pre-licence tiers: exact name, exact alias, normalized name, normalized alias. */
function resolveDirect(model: OrmModel, name: string): ObjectType | undefined {
  const exact = model.getObjectTypeByName(name)
    ?? model.objectTypes.find((ot) => ot.aliases?.includes(name));
  if (exact) return exact;

  const target = normalizeForMatch(name);
  return model.objectTypes.find((ot) => normalizeForMatch(ot.name) === target)
    ?? model.objectTypes.find((ot) => ot.aliases?.some((a) => normalizeForMatch(a) === target));
}

/**
 * The object type whose name -- or, failing that, an alias -- is `name`.
 *
 * Resolution order is exact name, exact alias, normalized name,
 * normalized alias, then (when a licence is declared) each licensed
 * word of `name`'s set through those same four tiers. Within each tier
 * the first match in declared order wins, keeping the result
 * deterministic.
 */
export function getObjectTypeByNameOrAlias(
  model: OrmModel,
  name: string,
  licence?: NameLicence,
): ObjectType | undefined {
  const direct = resolveDirect(model, name);
  if (direct || licence === undefined) return direct;

  const set = licenceSetFor(name, licence);
  if (!set) return undefined;
  const already = normalizeForMatch(name);
  for (const word of set) {
    if (normalizeForMatch(word) === already) continue;
    const viaLicence = resolveDirect(model, word);
    if (viaLicence) return viaLicence;
  }
  return undefined;
}

/**
 * The name to use when matching this object type against another
 * model's vocabulary: its own name if the vocabulary contains it,
 * otherwise the first alias the vocabulary contains, otherwise (when a
 * licence is declared) the vocabulary word licensed as the same concept
 * as one of its names, otherwise its own name (so a non-match stays
 * visible as a mismatch).
 *
 * Returns the vocabulary's spelling, not the candidate's, so the caller
 * gets a name it can look up on the other side.
 */
export function nameInVocabulary(
  ot: ObjectType,
  vocabulary: ReadonlySet<string>,
  licence?: NameLicence,
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

  // Last tier: a vocabulary word the licence declares to denote the
  // same concept as one of this object type's own names.
  if (licence !== undefined) {
    for (const candidate of candidates) {
      const set = licenceSetFor(candidate, licence);
      if (!set) continue;
      for (const word of set) {
        const match = index.get(normalizeForMatch(word));
        if (match !== undefined) return match;
      }
    }
  }
  return ot.name;
}
