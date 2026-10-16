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
import ormModelSchema from "../../schemas/orm-model.schema.json" with { type: "json" };
import { type ConstraintFromSchema, ConstraintYamlCodec } from "./constraintSchema.js";
import { missingField, missingOneOf } from "./problemWording.js";
import { locate, predicateOf, spelledAs } from "./schemaIssues.js";
import { RANGE_BOUND_MESSAGE, RANGE_YAML_KEYS } from "./valueRangeSchema.js";

/** One thing wrong with one constraint. */
export interface ConstraintProblem {
  /** The constraint's position in its fact type's `constraints`. */
  readonly index: number;
  /** The field at fault, in the file's spelling, as a path below the constraint. */
  readonly path: readonly PropertyKey[];
  /** A sentence naming the fact type, the constraint and the field. */
  readonly message: string;
}

/** Everything wrong with one constraint. */
export interface ConstraintFailure {
  /**
   * What the messages call the constraint (`Constraint "c-1" in Fact type
   * "Person has Age"`), for a caller that reports more about the same
   * constraint and must name it the same way.
   */
  readonly subject: string;
  readonly problems: readonly ConstraintProblem[];
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
): Effect.Effect<readonly Result.Result<ConstraintFromSchema, ConstraintFailure>[]> {
  return Effect.forEach(docs, (doc, index) => {
    const label = constraintLabel(doc, index, factType);
    const failure = (problems: readonly ConstraintProblem[]): ConstraintFailure => ({
      subject: label,
      problems,
    });
    if (!isMapping(doc)) {
      return Effect.succeed(
        Result.fail(failure([{ index, path: [], message: `${label} must be a mapping.` }])),
      );
    }
    return Effect.result(
      decodeFile(withId(doc, newId)).pipe(
        Effect.mapError((error) =>
          failure(withPresence(problemsOf(error.issue, doc, index, label), doc, index, label))
        ),
      ),
    );
  });
}

function isMapping(doc: unknown): doc is Record<string, unknown> {
  return typeof doc === "object" && doc !== null && !Array.isArray(doc);
}

// -- Rules Effect skips -------------------------------------------------------

/**
 * The schema's "at least one of these keys" rules, read from the schema
 * rather than restated: per constraint type (a frequency's `role` or
 * `roles`, a value constraint's `values` or `ranges`), and a value range's
 * `min` or `max` on the types that have ranges.
 *
 * The codec states them too, but as struct checks, and Effect runs a struct's
 * checks only once every field of it has passed, so beside any other problem
 * they went unreported. Checked here on the raw input whenever the decode
 * failed, so the report says it in the decoder's words. Nothing depends on
 * this for completeness: the loader keeps every schema error the decoder did
 * not report (`mergeConstraintProblems`). This is wording.
 */
interface Branch {
  readonly properties: { readonly type: { readonly const: string; }; readonly ranges?: unknown; };
  readonly anyOf?: unknown;
}
const schemaDefinitions = (ormModelSchema as {
  definitions: {
    constraint: { oneOf: readonly Branch[]; };
    value_range_def: { anyOf?: unknown; };
  };
}).definitions;

function anyOfKeys(anyOf: unknown): readonly string[] {
  return Array.isArray(anyOf)
    ? anyOf.flatMap((branch: { required?: readonly string[]; }) => branch.required ?? [])
    : [];
}

const PRESENCE_BY_TYPE: ReadonlyMap<string, readonly string[]> = new Map(
  schemaDefinitions.constraint.oneOf
    .map((branch) => [branch.properties.type.const, anyOfKeys(branch.anyOf)] as const)
    .filter(([, keys]) => keys.length > 0),
);
const TYPES_WITH_RANGES: ReadonlySet<string> = new Set(
  schemaDefinitions.constraint.oneOf
    .filter((branch) => branch.properties.ranges !== undefined)
    .map((branch) => branch.properties.type.const),
);
const RANGE_PRESENCE = anyOfKeys(schemaDefinitions.value_range_def.anyOf);

function withPresence(
  problems: ConstraintProblem[],
  raw: Record<string, unknown>,
  index: number,
  label: string,
): ConstraintProblem[] {
  const found: ConstraintProblem[] = [];
  const type = typeof raw.type === "string" ? raw.type : undefined;
  const keys = type === undefined ? undefined : PRESENCE_BY_TYPE.get(type);
  const noneOfKeys = keys !== undefined && !keys.some((k) => k in raw);
  if (keys !== undefined && noneOfKeys) {
    found.push({ index, path: [keys[0]!], message: `${label} ${missingOneOf([], keys)}` });
  }
  if (type !== undefined && TYPES_WITH_RANGES.has(type) && Array.isArray(raw.ranges)) {
    raw.ranges.forEach((range: unknown, i) => {
      if (isMapping(range) && !RANGE_PRESENCE.some((k) => k in range)) {
        // The same words the range's own check uses, so the rule reads one way
        // whichever of the two reported it.
        found.push({ index, path: ["ranges", i], message: `${label} ${RANGE_BOUND_MESSAGE}` });
      }
    });
  }
  // A missing "one of" replaces what the record's rules said about the same
  // keys: a frequency with neither `role` nor `roles` is told that, not that
  // its (empty) role list is too short.
  const covered = new Set(noneOfKeys ? keys : []);
  const rest = problems.filter((p) => !covered.has(String(p.path[0])));
  const seen = new Set(rest.map((p) => p.path.join("/")));
  return [...rest, ...found.filter((p) => !seen.has(p.path.join("/")))];
}

/** A constraint with a missing or empty id filled; anything else as it is. */
function withId(doc: unknown, newId: () => string): unknown {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return doc;
  const fields = doc as Record<string, unknown>;
  return fields.id === undefined || fields.id === "" ? { ...fields, id: newId() } : doc;
}

function problemsOf(
  issue: SchemaIssue.Issue,
  raw: Record<string, unknown>,
  index: number,
  label: string,
): ConstraintProblem[] {
  const problems = locate(issue).map(({ path: decodedPath, issue: leaf }) => {
    // A union that matched no kind fails at the constraint itself; the field
    // at fault is its `type`.
    const atRoot = decodedPath.length === 0 && leaf._tag === "AnyOf";
    const path = atRoot ? ["type"] : spelledAs(raw, decodedPath, spellingsOf, "first");
    return {
      index,
      path,
      message: `${label} ${predicateOf(leaf, atRoot ? [] : path, unknownType(raw))}`,
    };
  });
  return problems.length > 0 ? problems : [{ index, path: [], message: `${label} is malformed.` }];
}

/** A constraint whose `type` matched no kind: the type is what is wrong. */
function unknownType(raw: Record<string, unknown>): string {
  const type = raw.type;
  return type === undefined
    ? missingField(["type"])
    : `has an unknown type ${JSON.stringify(type)}.`;
}

/**
 * What a message calls the constraint: by the id its file gave it, or by its
 * position when it gave none. The position is spelled as a path
 * (`constraints/2`), which is how the rest of a load error spells one.
 */
function constraintLabel(raw: unknown, index: number, factType: string): string {
  const id = raw !== null && typeof raw === "object"
    ? (raw as Record<string, unknown>).id
    : undefined;
  const which = typeof id === "string" && id !== ""
    ? `"${id}"`
    : `at constraints/${index}`;
  return `Constraint ${which} in ${factType}`;
}

/** The file spellings of a record key, in the order to try. */
function spellingsOf(key: string): readonly string[] {
  return CONSTRAINT_FILE_SPELLINGS[key] ?? [];
}
