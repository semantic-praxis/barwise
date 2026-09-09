/**
 * The NORMA id space, separated from the model id space at compile time.
 *
 * NORMA accepts any unique token and conventionally prefixes ids with
 * "_". A model id converted for output becomes `_<model-id>`; an id that
 * already carries the prefix passes through unchanged, because ids
 * IMPORTED from NORMA keep their original token all the way into the
 * model (`mapping/objectTypes.ts` assigns `id: et.id` verbatim) and would
 * otherwise be prefixed twice on a round trip.
 *
 * That overlap is why the brand runs one way only. A `NormaId` is
 * assignable to `string`, so the import path can keep handing NORMA ids
 * to model-id positions, which is what it has always done. A bare
 * `string` is NOT assignable to `NormaId`, which is the direction worth
 * enforcing: every value reaching NORMA output has to pass through
 * `toNormaId` or `asNormaId`, and forgetting is a compile error rather
 * than a token that silently lacks its prefix.
 *
 * This module exists because the conversion was written twice --
 * `NormaXmlWriter.ts` and `populationGraph.ts` held byte-identical
 * copies, the second labelled "Mirrors the writer's id convention" --
 * with no shared owner, no `parity.manifest.json` entry and no drift
 * test. A comment is not a check (root `CLAUDE.md`).
 */

declare const normaIdBrand: unique symbol;

/** A token in NORMA's id space. Carries the "_" prefix. */
export type NormaId = string & { readonly [normaIdBrand]: "NormaId"; };

/**
 * Convert a model id into a NORMA id, prefixing "_" unless it is already
 * there. Idempotent, which is what makes a NORMA -> model -> NORMA round
 * trip stable.
 */
export function toNormaId(modelId: string): NormaId {
  return (modelId.startsWith("_") ? modelId : `_${modelId}`) as NormaId;
}

/**
 * Accept a token that is already in NORMA's id space -- one read from a
 * NORMA document rather than converted from a model id.
 *
 * Separate from `toNormaId` on purpose: this asserts provenance and does
 * not transform, so a parser reading `id="_ot1"` records what the file
 * said. Using `toNormaId` there would be harmless today and wrong the
 * moment a NORMA file carries an id without the prefix, which the format
 * permits.
 */
export function asNormaId(token: string): NormaId {
  return token as NormaId;
}

/**
 * Build a NORMA id derived from another, e.g. `_ft1` -> `_ft1_ro0`.
 *
 * Needed because template concatenation erases the brand: `${id}_ro0` is
 * a plain `string`, so without this every derived id would need its own
 * cast, and a cast per site is how a brand stops meaning anything.
 */
export function derivedNormaId(base: NormaId, suffix: string): NormaId {
  return `${base}${suffix}` as NormaId;
}
