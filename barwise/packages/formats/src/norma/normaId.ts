/**
 * The NORMA id space, separated from the model id space at compile time.
 *
 * NORMA types every id `xs:ID` and every reference `xs:IDREF`
 * (`ORM2Core.xsd`, ormsolutions/NORMA at c458441b), so an id is an XML
 * NCName, and conventionally starts with "_". A model id is a local name,
 * which may hold `%`, `:` and characters an NCName refuses, so it is never
 * written as it is: the writer derives a NORMA id from it (iri-identity,
 * decision 12(a)), the same for one model however it was loaded.
 *
 * The brand runs one way only. A `NormaId` is assignable to `string`, so
 * the import path can hand NORMA ids to model-id positions while it builds
 * the model under them, before the replay gives it local names. A bare
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

import { derivedId } from "@barwise/core";

declare const normaIdBrand: unique symbol;

/** A token in NORMA's id space. Carries the "_" prefix. */
export type NormaId = string & { readonly [normaIdBrand]: "NormaId"; };

/**
 * The NORMA id a model id is written under: "_" and core's `derivedId` of
 * it, a UUID, so an NCName whatever the local name holds. One model id
 * always gives one NORMA id, and two give two, so every reference the
 * writer derives from an id meets the element written under it. A NORMA
 * round trip therefore gets new ids (decision 12(a)): the import names each
 * element from its name, and the export derives from that. No id passes
 * through as it is, not even one starting with "_" (a local name such as
 * `_internal` is still a local name).
 */
export function toNormaId(modelId: string): NormaId {
  return `_${derivedId(NORMA_EXPORT_ID_TAG, [modelId])}` as NormaId;
}

/**
 * The domain tag `toNormaId` derives under. Part of every id barwise writes
 * to NORMA, so editing it changes every export; pinned by a test.
 */
export const NORMA_EXPORT_ID_TAG = "barwise.norma-export";

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

/**
 * The id of a cardinality restriction that has none of its own, from the
 * element it restricts: the importer gives it to a unary role's cardinality
 * NORMA wrote without an id, and the writer gives it to an object type's
 * cardinality, which barwise holds as a property and never names. A role
 * cardinality added to a model in code takes the id the model names it
 * with, and the writer exports that.
 */
export function cardinalityId(restricted: NormaId): NormaId {
  return derivedNormaId(restricted, "_card");
}

/**
 * An id the NORMA importer derives for an element its file gives none:
 * core's `derivedId` under one of `NORMA_ID_TAGS`, with NORMA's `_`
 * prefix, so the writer's `toNormaId` leaves it as is and the next import
 * reads the same id. The one spelling, so no site can forget the prefix.
 */
export function derivedNormaElementId(
  tag: (typeof NORMA_ID_TAGS)[keyof typeof NORMA_ID_TAGS],
  inputs: readonly string[],
): NormaId {
  return `_${derivedId(tag, inputs)}` as NormaId;
}

/**
 * The domain tags for ids the NORMA importer derives (core's `derivedId`)
 * where a file states none. Each derived id carries NORMA's `_` prefix, as
 * an id read from a file does, so the writer's `toNormaId` leaves it as is
 * and the next import gets the same id back. A tag is part of every id derived under it, so
 * editing one re-keys that element in every model ever imported; the
 * values are pinned by a test for that reason.
 */
export const NORMA_ID_TAGS = {
  /** A constraint the file gives no id, from its content. */
  constraint: "barwise.norma-constraint",
  /** A population, from its fact type: NORMA writes no population element. */
  population: "barwise.norma-population",
  /** A unary row, from its entity instance and role. */
  unaryInstance: "barwise.norma-unary-instance",
  /** An objectification link, from the fact type and object type it links. */
  objectification: "barwise.norma-objectification",
} as const;
