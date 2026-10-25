/**
 * A ReadingOrder is a natural-language template for verbalizing a fact type.
 *
 * The template uses positional placeholders like "{0}" and "{1}" that
 * correspond to the roles in the fact type by index. For example, a binary
 * fact type with roles [Customer, Order] might have readings:
 *   - "{0} places {1}"          (forward: "Customer places Order")
 *   - "{1} is placed by {0}"    (inverse: "Order is placed by Customer")
 *
 * Every fact type must have at least one reading. Binary fact types
 * typically have two (forward and inverse).
 */
export interface ReadingOrder {
  /** Template string with positional placeholders: "{0}", "{1}", etc. */
  readonly template: string;
}

/**
 * Validates that a reading template's placeholders are consistent with
 * the expected number of roles.
 *
 * @param template - The reading template string.
 * @param roleCount - The number of roles in the fact type.
 * @returns An array of error messages (empty if valid).
 */
export function validateReadingTemplate(
  template: string,
  roleCount: number,
): string[] {
  const errors: string[] = [];

  if (!template || template.trim().length === 0) {
    errors.push("Reading template must be a non-empty string.");
    return errors;
  }

  // Extract all placeholder indices from the template.
  const placeholderPattern = /\{(\d+)\}/g;
  const foundIndices = new Set<number>();
  let match: RegExpExecArray | null;

  while ((match = placeholderPattern.exec(template)) !== null) {
    const index = parseInt(match[1]!, 10);
    foundIndices.add(index);
  }

  // Every role index [0..roleCount-1] should appear at least once.
  for (let i = 0; i < roleCount; i++) {
    if (!foundIndices.has(i)) {
      errors.push(
        `Reading template "${template}" is missing placeholder {${i}} `
          + `(expected ${roleCount} role references).`,
      );
    }
  }

  // No placeholder should reference an index >= roleCount.
  for (const index of foundIndices) {
    if (index >= roleCount) {
      errors.push(
        `Reading template "${template}" references {${index}} but the `
          + `fact type only has ${roleCount} roles.`,
      );
    }
  }

  return errors;
}

/**
 * Expands a reading template by substituting role placeholders with
 * the provided names.
 *
 * @param template - The reading template (e.g. "{0} places {1}").
 * @param roleNames - Array of names to substitute, indexed by position.
 * @returns The expanded reading (e.g. "Customer places Order"), with any
 *   hyphen-bound words before their player ("Listing has sale Currency").
 */
export function expandReading(
  template: string,
  roleNames: readonly string[],
): string {
  // Through splitReading, so a hyphen-bound lead is printed before its
  // player rather than as written (reading-hyphen-binding.spec.md).
  return splitReading(template).parts.map((part) =>
    part.kind === "text"
      ? part.text
      : withLead(part.lead, roleNames[part.index] ?? `{${part.index}}`)
  ).join("");
}

/** One part of a reading: text, or a role placeholder with its bound lead. */
export type ReadingPart =
  | { readonly kind: "text"; readonly text: string; }
  | {
    readonly kind: "role";
    readonly index: number;
    /** The words bound to this role's player, hyphens removed; "" when none. */
    readonly lead: string;
  };

/** A reading split at its placeholders, with ORM hyphen binding applied. */
export interface SplitReading {
  readonly parts: readonly ReadingPart[];
  /** Whether a hyphen in the template looks like binding but binds nothing. */
  readonly unbound: boolean;
}

/**
 * A binding hyphen: one that directly follows a letter or digit and is
 * followed by whitespace or by the end of the stretch of text it is in --
 * the next placeholder, or the end of the template
 * (reading-hyphen-binding.spec.md).
 */
const BINDING_HYPHEN = /([A-Za-z0-9])-(?=\s|$)/g;
/** The same test, without the global flag's lastIndex state. */
const HAS_BINDING_HYPHEN = /[A-Za-z0-9]-(?=\s|$)/;
/** The first token of a stretch that ends in a binding hyphen. */
const BINDING_TOKEN = /(^|\s)(\S*[A-Za-z0-9])-(?=\s|$)/;
/** The trailing form ("{0} -word"), which barwise does not bind. */
const TRAILING_HYPHEN = /(^|\s)-[A-Za-z0-9]/;

/**
 * Split a reading template into text and role parts, applying ORM's hyphen
 * binding: in the text before a placeholder, the first word ending in a
 * binding hyphen and every word after it up to the placeholder qualify that
 * role's player ("{0} has sale- {1}" reads "Listing has sale Currency").
 * Every reader that renders a reading goes through this, so the notation
 * is applied in one place (reading-hyphen-binding.spec.md).
 */
export function splitReading(template: string): SplitReading {
  const pieces = template.split(/\{(\d+)\}/);
  const parts: ReadingPart[] = [];
  let unbound = false;
  for (let i = 0; i < pieces.length; i += 2) {
    const stretch = pieces[i]!;
    const index = pieces[i + 1];
    if (index === undefined) {
      // The text after the last placeholder: a binding hyphen here binds
      // nothing.
      if (HAS_BINDING_HYPHEN.test(stretch)) unbound = true;
      if (TRAILING_HYPHEN.test(stretch)) unbound = true;
      if (stretch) parts.push({ kind: "text", text: stretch });
      continue;
    }
    const token = BINDING_TOKEN.exec(stretch);
    const start = token ? token.index + token[1]!.length : stretch.length;
    const text = stretch.slice(0, start);
    const lead = stretch.slice(start).replace(BINDING_HYPHEN, "$1").replace(/\s+/g, " ").trim();
    if (TRAILING_HYPHEN.test(text)) unbound = true;
    if (text) parts.push({ kind: "text", text });
    parts.push({ kind: "role", index: Number(index), lead });
  }
  return { parts, unbound };
}

/** A player's phrase in a reading: its lead, if any, then its name. */
export function withLead(lead: string, name: string): string {
  return lead ? `${lead} ${name}` : name;
}
