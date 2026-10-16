/**
 * Decoding a file's constraints into records, or into every problem with
 * them, each naming the fact type, the constraint and the field.
 *
 * A file may omit a constraint's id, and today's reader treats an empty one
 * the same way, so the loader fills both before decoding (decision 8 of
 * effect-adoption.spec.md). The fill is the caller's `newId`, never the
 * decoder's. A problem names a constraint by the id the file gave it, or,
 * when it gave none, by its position: a filled id is one the author never
 * wrote and could not find.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import type * as SchemaIssue from "effect/SchemaIssue";
import { type ConstraintFromSchema, ConstraintYamlCodec } from "./constraintSchema.js";
import { locate, predicateOf } from "./schemaIssues.js";
import { RANGE_YAML_KEYS } from "./valueRangeSchema.js";

/** One thing wrong with one constraint. */
export interface ConstraintProblem {
  /** The constraint's position in its fact type's `constraints`. */
  readonly index: number;
  /** The field at fault, in the file's spelling, as a path below the constraint. */
  readonly path: readonly PropertyKey[];
  /** A sentence naming the fact type, the constraint and the field. */
  readonly message: string;
}

const FILE_OPTIONS: SchemaAST.ParseOptions = { errors: "all", onExcessProperty: "error" };
const decodeFile = Schema.decodeUnknownEffect(ConstraintYamlCodec, FILE_OPTIONS);

/**
 * The file spellings a record key may have come from, in the order to try.
 * A rule stated on the record (a role list's minimum length) is reported at
 * the record's key; the file spells it differently, and a frequency spells
 * its roles either way. `constraintDecoder.test.ts` holds this list to the
 * codec, kind by kind, so a renamed key fails there rather than here.
 */
export const CONSTRAINT_FILE_SPELLINGS: Readonly<Record<string, readonly string[]>> = {
  roleId: ["role"],
  roleIds: ["roles", "role"],
  roleId1: ["role_1"],
  roleId2: ["role_2"],
  roleIds1: ["roles_1"],
  roleIds2: ["roles_2"],
  subsetRoleIds: ["subset_roles"],
  supersetRoleIds: ["superset_roles"],
  ringType: ["ring_type"],
  isPreferred: ["is_preferred"],
  ...Object.fromEntries(Object.entries(RANGE_YAML_KEYS).map(([k, v]) => [k, [v]])),
};

/**
 * Decode one fact type's constraints. Each is decoded on its own, so one
 * constraint's problems do not hide the next one's.
 *
 * @param factType What the messages call the fact type, already worded
 *   (`Fact type "Person has Age"`).
 */
export function decodeConstraints(
  docs: readonly unknown[],
  factType: string,
  newId: () => string,
): Effect.Effect<readonly Result.Result<ConstraintFromSchema, readonly ConstraintProblem[]>[]> {
  return Effect.forEach(docs, (doc, index) =>
    Effect.result(
      decodeFile(withId(doc, newId)).pipe(
        Effect.mapError((error) => problemsOf(error.issue, doc, index, factType)),
      ),
    ));
}

/** A constraint with a missing or empty id filled; anything else as it is. */
function withId(doc: unknown, newId: () => string): unknown {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return doc;
  const fields = doc as Record<string, unknown>;
  return fields.id === undefined || fields.id === "" ? { ...fields, id: newId() } : doc;
}

function problemsOf(
  issue: SchemaIssue.Issue,
  raw: unknown,
  index: number,
  factType: string,
): ConstraintProblem[] {
  const label = labelOf(raw, index, factType);
  const problems = locate(issue).map(({ path: decodedPath, issue: leaf }) => {
    // A union that matched no kind fails at the constraint itself; the field
    // at fault is its `type`.
    const atRoot = decodedPath.length === 0 && leaf._tag === "AnyOf";
    const path = atRoot ? ["type"] : spelledAs(raw, decodedPath);
    return {
      index,
      path,
      message: `${label} ${predicateOf(leaf, atRoot ? [] : path, unknownType(raw))}`,
    };
  });
  return problems.length > 0 ? problems : [{ index, path: [], message: `${label} is malformed.` }];
}

/** A constraint whose `type` matched no kind: the type is what is wrong. */
function unknownType(raw: unknown): string {
  const type = raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>).type
    : undefined;
  return type === undefined
    ? `is missing "type".`
    : `has an unknown type ${JSON.stringify(type)}.`;
}

/**
 * What a message calls the constraint: by the id its file gave it, or by its
 * position when it gave none. The position is spelled as a path
 * (`constraints/2`), which is how the rest of a load error spells one.
 */
function labelOf(raw: unknown, index: number, factType: string): string {
  const id = raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>).id
    : undefined;
  const which = typeof id === "string" && id !== ""
    ? `"${id}"`
    : `at constraints/${index}`;
  return `Constraint ${which} in ${factType}`;
}

/**
 * A path in the spelling of the input it points into: each segment the input
 * lacks is replaced by the first file spelling the input has. An unknown key
 * the input does have is left as written.
 */
function spelledAs(raw: unknown, path: readonly PropertyKey[]): PropertyKey[] {
  const spelled: PropertyKey[] = [];
  let node = raw;
  for (const segment of path) {
    let key = segment;
    if (node !== null && typeof node === "object") {
      const record = node as Record<PropertyKey, unknown>;
      if (typeof segment === "string" && !(segment in record)) {
        const found = CONSTRAINT_FILE_SPELLINGS[segment]?.find((k) => k in record);
        if (found !== undefined) key = found;
      }
      node = record[key];
    } else {
      node = undefined;
    }
    spelled.push(key);
  }
  return spelled;
}
