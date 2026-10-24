/**
 * Ids derived from content, for elements a file leaves without one
 * (`docs/specs/orm-format-3.spec.md`, migration step 1 and WS2).
 *
 * A 2.0 file may omit a constraint's id. The loader used to fill it from
 * the installed generator, so the same unchanged file gave its constraints
 * new ids on every load: two NORMA exports of one file differed, and a
 * counterexample cited an id that meant nothing after the run. A derived id
 * is a pure function of the file, so a file loads to the same ids every
 * time, and once the model is saved the id is stated in the file.
 *
 * Content, not position: inserting a constraint changes no other
 * constraint's id, so two revisions of one file agree on every constraint
 * they share. Position-derived ids would hand one id to different
 * constraints across revisions, and diff and merge would pair them.
 *
 * The id is a UUIDv8 (RFC 9562 section 5.8) over a SHA-256, so it reads
 * like every other id. The hash input is a domain tag and then each input
 * with its byte length in front: the tag keeps one derivation's ids apart
 * from another's, and the length prefix keeps inputs within one derivation
 * apart -- without it, the inputs `ft-1`, `mandatory` and `ft-1m`, `andatory`
 * would hash the same bytes.
 */
import { createHash } from "node:crypto";
import type { Constraint } from "../model/Constraint.js";
import { formatUuid } from "../model/id.js";

/** A UUIDv8 derived from a domain tag and an ordered list of inputs. */
export function derivedId(tag: string, inputs: readonly string[]): string {
  const hash = createHash("sha256");
  for (const part of [tag, ...inputs]) {
    hash.update(`${Buffer.byteLength(part, "utf8")}:`);
    hash.update(part, "utf8");
  }
  const bytes = hash.digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x80; // version 8
  bytes[8] = (bytes[8]! & 0x3f) | 0x80; // RFC 9562 variant
  return formatUuid(bytes);
}

/**
 * JSON with every object's keys sorted, so two spellings of one value hash
 * alike whatever order a file wrote its keys in. Array order is kept: a
 * constraint's role order is part of what it says. As in `JSON.stringify`,
 * an undefined object field is left out and an undefined array element is
 * `null`, so `[undefined]` and `[]` stay apart.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

/** The domain tag for constraint ids derived from a fact type's file content. */
export const CONSTRAINT_ID_TAG = "barwise.constraint";

/**
 * The tag merge derives an element's id under where the merged store
 * already holds the one it prefers (`ModelMerge.mergedId`), followed by
 * the element's kind. Named here beside the others so every derivation's
 * domain is in one place.
 */
export const MERGE_ID_TAG = "barwise.merge";

/**
 * One fact type's constraints, as read from a file, each with an id: the
 * file's own, or one derived from the fact type's id and the constraint's
 * content when the file gave none. (`deserializeConstraint` already drops
 * an empty id, so missing and empty arrive here alike.)
 *
 * Content is the constraint as read, not as written: the reader has folded
 * the spellings a file may vary (a frequency's `role` or `roles`, an
 * explicit `modality: alethic` or none), so a file rewritten into another
 * spelling keeps its ids. The kind is part of the content.
 *
 * List order inside a constraint is kept, so reordering a uniqueness's roles
 * in a file that has not been saved yet gives it a new id, as any other edit
 * would. Folding that order away would mean restating, kind by kind, which
 * lists are sets and which are sequences (a subset's roles pair by
 * position) -- the rules diff's `constraintKey` already holds for matching.
 * Once the file is saved the id is stated, and order no longer matters.
 *
 * Identical constraints in one fact type are told apart by their occurrence
 * number among the identical ones, which also steps past an id already
 * taken, so a derived id never repeats a stated one. Constraint ids are
 * model-wide, so a model loader passes one `taken` set for the whole file,
 * holding every id the file states before any is derived: a saved constraint moved to another
 * fact type keeps the id derived under its old one, and an identical
 * constraint added back there must not derive it again.
 * That number is the one positional input, and it matters only between
 * exact duplicates: deleting the first of two moves its id to the other.
 */
export function withDerivedIds(
  factTypeId: string,
  constraints: readonly Constraint[],
  taken: Set<string>,
): Constraint[] {
  const seen = new Map<string, number>();
  return constraints.map((c) => {
    if (c.id !== undefined) return c;
    const content = canonicalJson(c);
    let occurrence = seen.get(content) ?? 0;
    let id: string;
    do {
      id = derivedId(CONSTRAINT_ID_TAG, [factTypeId, content, String(occurrence++)]);
    } while (taken.has(id));
    seen.set(content, occurrence);
    taken.add(id);
    return { ...c, id };
  });
}
