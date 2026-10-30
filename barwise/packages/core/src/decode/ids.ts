/**
 * The id leaves of a format: what each id and reference field accepts.
 * Formats 3.0 and 4.0 differ in little beyond these (iri-identity WS6,
 * 6b-2b-1): 3.0 takes any non-empty string and requires every id; 4.0
 * takes ids of the shapes their rules give (`model/name.ts`), lets a
 * constraint, subtype fact or objectification leave its id to the model,
 * and states `minted_from` beside an id. Each element's Schema is built
 * from one of these, so the two formats share one statement of everything
 * else, and the 3.0 Schemas are what they were before 4.0 existed.
 */
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import {
  INSTANCE_ID_PATTERN,
  LOCAL_NAME_PATTERN,
  REFERENCE_PATTERN,
  ROLE_ID_PATTERN,
} from "../model/name.js";
import { crossField } from "./harness.js";
import { nonEmpty } from "./leaves.js";

/** A required string leaf. */
type Leaf = ReturnType<typeof nonEmpty>;

export interface FormatIds<Minted extends Schema.Struct.Fields> {
  /** An object type's id. */
  readonly objectType: Leaf;
  /** A fact type's id, and a reference to one. */
  readonly factType: Leaf;
  /** A role's id. */
  readonly role: Leaf;
  /** A role id inside a list, which names itself as one. */
  readonly roleInList: Leaf;
  /** A reference to an object type: a role's player, a subtype end, a diagram's element. */
  readonly objectTypeRef: Leaf;
  /** The same, inside a diagram's list. */
  readonly elementInList: Leaf;
  /** A reference to a constraint (a preferred identifier) or a subtype fact. */
  readonly localRef: Leaf;
  /** A subtype fact id inside a constraint's list. */
  readonly subtypeFactInList: Leaf;
  /** A population's id. */
  readonly population: Leaf;
  /** A fact instance's id. */
  readonly instance: Leaf;
  /** A role id as a key of an instance's values; any string in 3.0. */
  readonly roleKey: Schema.Codec<string>;
  /** The id fields of an element the model can name: a subtype fact or objectification. */
  readonly minted: Minted;
  /** The same for a constraint, whose missing id 3.0 refuses in its own words. */
  readonly constraintMinted: Minted;
  /** The rule an element with `minted` fields obeys, if the format has one. */
  readonly mintedRule:
    | SchemaAST.Filter<{ readonly id?: unknown; readonly minted_from?: unknown; }>
    | undefined;
}

/** Format 3.0: every id a non-empty string, and every one stated. */
export const IDS_30 = {
  objectType: nonEmpty(""),
  factType: nonEmpty(""),
  role: nonEmpty(""),
  roleInList: nonEmpty(" (a role id)"),
  objectTypeRef: nonEmpty(""),
  elementInList: nonEmpty(" (an element)"),
  localRef: nonEmpty(""),
  subtypeFactInList: nonEmpty(" (a subtype fact id)"),
  population: nonEmpty(""),
  instance: nonEmpty(""),
  roleKey: Schema.String,
  minted: { id: nonEmpty("") },
  constraintMinted: {
    id: nonEmpty("").pipe(
      Schema.annotateKey({
        messageMissingKey: "is missing: a 3.0 file states every constraint's id.",
      }),
    ),
  },
  mintedRule: undefined,
} satisfies FormatIds<Schema.Struct.Fields>;

/** A string of one of 4.0's id shapes, refused in the shape's own words. */
const shaped = (pattern: RegExp, shape: string, what = "") =>
  nonEmpty(what).check(
    Schema.makeFilter((id: string) => pattern.test(id), { message: `must be ${shape}${what}.` }),
  );

const LOCAL = "a local name: letters, digits, _ and the characters an IRI keeps, with no space, "
  + "'.' or ':'";
const ROLE = "<fact type>.<role>, two local names joined by '.'";

const MINTED_40 = {
  id: Schema.optionalKey(shaped(LOCAL_NAME_PATTERN, LOCAL)),
  minted_from: Schema.optionalKey(nonEmpty("")),
};

/**
 * Format 4.0: ids of the shapes their rules give, and a constraint's,
 * subtype fact's or objectification's id optional, with the content key it
 * was minted from beside it (`minted_from` without an `id` is refused when
 * the element is read, as the schema's `dependencies` refuses it).
 */
export const IDS_40 = {
  objectType: shaped(REFERENCE_PATTERN, `${LOCAL}, or a shadow's alias:local`),
  factType: shaped(LOCAL_NAME_PATTERN, LOCAL),
  role: shaped(ROLE_ID_PATTERN, ROLE),
  roleInList: shaped(ROLE_ID_PATTERN, ROLE, " (a role id)"),
  objectTypeRef: shaped(REFERENCE_PATTERN, `${LOCAL}, or alias:local`),
  elementInList: shaped(REFERENCE_PATTERN, `${LOCAL}, or alias:local`, " (an element)"),
  localRef: shaped(LOCAL_NAME_PATTERN, LOCAL),
  subtypeFactInList: shaped(LOCAL_NAME_PATTERN, LOCAL, " (a subtype fact id)"),
  population: shaped(ROLE_ID_PATTERN, "<fact type>.population, two local names joined by '.'"),
  instance: shaped(INSTANCE_ID_PATTERN, "<population>.N, three local names joined by '.'"),
  roleKey: Schema.String.check(
    Schema.makeFilter((key: string) => ROLE_ID_PATTERN.test(key), {
      message: `must be a role id: ${ROLE}.`,
    }),
  ),
  minted: MINTED_40,
  constraintMinted: MINTED_40,
  mintedRule: crossField(
    { id: "minted-from-beside-id", reads: ["id", "minted_from"] },
    (e: { readonly id?: unknown; readonly minted_from?: unknown; }) =>
      e.minted_from === undefined || e.id !== undefined
        ? true
        : {
          path: ["minted_from"],
          issue: "must not be given without an id: it is the key the id was minted from.",
        },
    "must not give minted_from without an id.",
  ),
} satisfies FormatIds<Schema.Struct.Fields>;
