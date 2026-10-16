/**
 * Decoding one object type into its record, or into every problem with it.
 *
 * The decoder collects (`errors: "all"`), then turns Effect's issue tree into one
 * `ObjectTypeProblem` per problem, each naming the object type and the field.
 * One per problem, not one block of text: a caller -- and the D2 scorer of
 * docs/specs/effect-comparison.spec.md -- reads them as a list.
 *
 * A file's unknown field is refused (`onExcessProperty: "error"`), as its
 * JSON Schema refuses it. A config's is ignored, as main's createObjectType
 * ignored it: a config is often a wider object spread in, and the fields that
 * matter by their absence -- the value-only fields on an entity -- are
 * declared in the schema and refused there, not caught as unknown.
 *
 * Every id is required, and the decoder mints none (effect-adoption.spec.md,
 * decision 8). The boundary for configs, `runObjectTypeConfigDecode`, fills a
 * missing id before decoding; `createObjectType` and `OrmModel.addObjectType`
 * call it. An object type in a file must carry its id, so the loader fills
 * nothing here.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import type * as SchemaIssue from "effect/SchemaIssue";
import {
  type ObjectType,
  ObjectTypeModelCodec,
  ObjectTypeYamlCodec,
  RANGE_YAML_KEYS,
  YAML_KEYS,
} from "./objectTypeSchema.js";
import { locate, predicateOf, spelledAs } from "./schemaIssues.js";

/** One thing wrong with one object type. */
export interface ObjectTypeProblem {
  /** The object type's name as written (trimmed), or its id when the name is the problem. */
  readonly objectType: string;
  /** The top-level field at fault, in the spelling of the input. */
  readonly field: string;
  /** A sentence naming the object type and the field. */
  readonly message: string;
}

/** Every problem one decode found; never empty. */
export class ObjectTypeProblems {
  readonly _tag = "ObjectTypeProblems";
  constructor(readonly problems: readonly [ObjectTypeProblem, ...ObjectTypeProblem[]]) {}
}

/**
 * Thrown at the synchronous boundaries. It carries the list as well as the
 * joined text, so a caller that reports problems one per line need not split
 * a message to get them back.
 */
export class ObjectTypeError extends Error {
  constructor(readonly problems: readonly [ObjectTypeProblem, ...ObjectTypeProblem[]]) {
    super(problems.map((p) => p.message).join("\n"));
    this.name = "ObjectTypeError";
  }
}

const FILE_OPTIONS: SchemaAST.ParseOptions = { errors: "all", onExcessProperty: "error" };
const CONFIG_OPTIONS: SchemaAST.ParseOptions = { errors: "all", onExcessProperty: "ignore" };

const decodeYaml = Schema.decodeUnknownEffect(ObjectTypeYamlCodec, FILE_OPTIONS);
const decodeModel = Schema.decodeUnknownEffect(ObjectTypeModelCodec, CONFIG_OPTIONS);

/** Decode one object type as an `.orm.yaml` file spells it. */
export function decodeObjectType(
  doc: unknown,
): Effect.Effect<ObjectType, ObjectTypeProblems> {
  return decodeWith(decodeYaml, doc);
}

/**
 * main's createObjectType tested the reference mode for truth, so a value
 * type's empty one was absent, not refused. The schema refuses any reference
 * mode on a value type, so the empty string is dropped before that check.
 */
function withoutEmptyValueReferenceMode(config: unknown): unknown {
  if (typeof config !== "object" || config === null) return config;
  const fields = config as Record<string, unknown>;
  if (fields.kind !== "value" || fields.referenceMode !== "") return config;
  return Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "referenceMode"));
}

/**
 * Decode one object type as `ObjectTypeConfig` spells it.
 *
 * A key holding `undefined` is treated as absent first, because that is what
 * it has always meant to a caller: configs are routinely built as
 * `{ referenceMode: other.referenceMode, ... }`, and the schema's optional
 * keys refuse an explicit `undefined`.
 */
export function decodeObjectTypeConfig(
  config: unknown,
): Effect.Effect<ObjectType, ObjectTypeProblems> {
  return decodeWith(decodeModel, prepareConfig(config));
}

/**
 * Decode a file's object types, each to its record or its problems. One
 * object type's problems do not stop the next from being decoded, so a file
 * reports everything wrong with all of them in one pass.
 */
export function decodeObjectTypes(
  docs: readonly unknown[],
): Effect.Effect<readonly Result.Result<ObjectType, ObjectTypeProblems>[]> {
  return Effect.forEach(docs, (doc) => Effect.result(decodeObjectType(doc)));
}

function prepareConfig(config: unknown): unknown {
  return withoutUndefined(withoutEmptyValueReferenceMode(config));
}

/**
 * A config with its missing id filled from `newId`. The one step that mints
 * an id; it runs before the decode, never in it. A key holding `undefined`
 * counts as missing.
 */
function withId(config: unknown, newId: () => string): unknown {
  if (typeof config !== "object" || config === null || Array.isArray(config)) return config;
  const fields = config as Record<string, unknown>;
  return fields.id === undefined ? { ...fields, id: newId() } : config;
}

/**
 * Run one decode, returning the record or throwing every problem at once as
 * an `ObjectTypeError`. The synchronous boundary: a caller that stays out of
 * Effect calls this.
 */
export function runObjectTypeDecode(
  decoded: Effect.Effect<ObjectType, ObjectTypeProblems>,
): ObjectType {
  const result = Effect.runSync(Effect.result(decoded));
  if (Result.isFailure(result)) throw new ObjectTypeError(result.failure.problems);
  return result.success;
}

/**
 * The synchronous boundary for a config whose caller may omit the id: fill it
 * from `newId`, decode, and return the record or throw every problem. The
 * problems name the object type as the caller wrote it, so a message never
 * cites an id the caller did not choose.
 */
export function runObjectTypeConfigDecode(config: unknown, newId: () => string): ObjectType {
  const prepared = prepareConfig(config);
  return runObjectTypeDecode(decodeWith(decodeModel, withId(prepared, newId), prepared));
}

/** `label` is the input as its author wrote it, which the problems name. */
function decodeWith(
  decode: (input: unknown) => Effect.Effect<ObjectType, Schema.SchemaError>,
  input: unknown,
  label: unknown = input,
): Effect.Effect<ObjectType, ObjectTypeProblems> {
  return decode(input).pipe(
    Effect.map(seal),
    Effect.mapError((error) => new ObjectTypeProblems(problemsOf(error.issue, label))),
  );
}

/** Frozen, as `createObjectType` always returned it: a record is a value. */
function seal(ot: ObjectType): ObjectType {
  return Object.freeze({ ...ot, aliases: Object.freeze([...ot.aliases]) });
}

// -- Issues to problems -----------------------------------------------------

function problemsOf(
  issue: SchemaIssue.Issue,
  raw: unknown,
): [ObjectTypeProblem, ...ObjectTypeProblem[]] {
  const subject = subjectOf(raw);
  const located = locate(issue);
  const problems = located.map(({ path: decodedPath, issue: leaf }) => {
    const path = spelledAs(raw, decodedPath, fileSpellingOf);
    const field = path.length > 0 ? String(path[0]) : "kind";
    return {
      objectType: subject.identity,
      field,
      message: `${subject.label} ${predicateOf(leaf, path, `must have kind "entity" or "value".`)}`,
    };
  });
  // A decode that failed always carries at least one leaf; the fallback only
  // keeps the type honest if Effect ever hands back an empty composite.
  return problems.length > 0
    ? (problems as [ObjectTypeProblem, ...ObjectTypeProblem[]])
    : [{ objectType: subject.identity, field: "", message: `${subject.label} is malformed.` }];
}

const FILE_SPELLING: Readonly<Record<string, string>> = { ...YAML_KEYS, ...RANGE_YAML_KEYS };

/**
 * Effect reports a check on a decoded struct at the decoded key, so a file's
 * empty value constraint comes back at `valueConstraint` -- a key the file
 * does not have; this is the file key to report instead.
 */
function fileSpellingOf(key: string): readonly string[] {
  const fileKey = FILE_SPELLING[key];
  return fileKey === undefined ? [] : [fileKey];
}

/**
 * What a message calls the object type: by its name, or by its id when the
 * name is missing or blank -- which is when the name is the problem.
 */
function subjectOf(raw: unknown): { readonly label: string; readonly identity: string; } {
  const doc = raw !== null && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const kind = doc.kind === "entity"
    ? "Entity type"
    : doc.kind === "value"
    ? "Value type"
    : "Object type";
  const name = typeof doc.name === "string" ? doc.name.trim() : "";
  if (name !== "") return { label: `${kind} "${name}"`, identity: name };
  if (typeof doc.id === "string" && doc.id !== "") {
    return { label: `${kind} with id "${doc.id}"`, identity: doc.id };
  }
  return { label: `${kind} with no name or id`, identity: "" };
}

/** A copy with every `undefined`-valued key removed, at any depth. */
function withoutUndefined(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutUndefined);
  if (value === null || typeof value !== "object") return value;
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  );
}
