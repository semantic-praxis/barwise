/**
 * The one answer to "does this constraint type match a user-supplied
 * keyword". Both surfaces that take a constraint-type keyword -- the
 * query DSL's `constraints <type>` and describe's constraint focus --
 * call this; each previously owned its own matcher and they disagreed
 * silently ("exclusive-or" matched nothing in one and over-matched
 * `exclusion` in the other; "disjunctive" matched in one only). One
 * decision, one owner (barwise-866).
 */

/**
 * Normalize a user-supplied constraint keyword: lowercase, with
 * hyphens and spaces folded to underscores so "exclusive-or" and
 * "internal uniqueness" line up with the snake_case discriminators.
 */
export function normalizeConstraintKeyword(keyword: string): string {
  return keyword.toLowerCase().replace(/[\s-]+/g, "_");
}

/**
 * Match a constraint's `type` discriminator against a keyword. The
 * keyword matches when, after normalization, it equals the type or is
 * a substring of it -- so "uniqueness" matches both
 * "internal_uniqueness" and "external_uniqueness", and "disjunctive"
 * matches "disjunctive_mandatory".
 */
export function matchesConstraintType(constraintType: string, keyword: string): boolean {
  const normalized = normalizeConstraintKeyword(keyword);
  return constraintType === normalized || constraintType.includes(normalized);
}
