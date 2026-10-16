/**
 * Decoding one object type into its record, or into every problem with it.
 *
 * The decoder collects (`errors: "all"`) and refuses unknown fields
 * (`onExcessProperty: "error"`), then turns Effect's issue tree into one
 * `ObjectTypeProblem` per problem, each naming the object type and the field.
 * One per problem, not one block of text: a caller -- and the D2 scorer of
 * docs/specs/effect-comparison.spec.md -- reads them as a list.
 *
 * The id source is the `IdSource` requirement in each decode's type. Only the
 * boundaries (`createObjectType`, `OrmModel.addObjectType`, the YAML loader)
 * provide it, with the installed generator.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import * as SchemaIssue from "effect/SchemaIssue";
import {
  type IdSource,
  IdSource as IdSourceKey,
  type ObjectType,
  ObjectTypeModelCodec,
  ObjectTypeYamlCodec,
  RANGE_YAML_KEYS,
  YAML_KEYS,
} from "./objectTypeSchema.js";

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

const PARSE_OPTIONS: SchemaAST.ParseOptions = { errors: "all", onExcessProperty: "error" };

const decodeYaml = Schema.decodeUnknownEffect(ObjectTypeYamlCodec, PARSE_OPTIONS);
const decodeModel = Schema.decodeUnknownEffect(ObjectTypeModelCodec, PARSE_OPTIONS);

/** Decode one object type as an `.orm.yaml` file spells it. */
export function decodeObjectType(
  doc: unknown,
): Effect.Effect<ObjectType, ObjectTypeProblems, IdSource> {
  return decodeWith(decodeYaml, doc);
}

/**
 * Decode one object type as `ObjectTypeConfig` spells it.
 *
 * A key holding `undefined` is treated as absent first, because that is what
 * it has always meant to a caller: configs are routinely built as
 * `{ referenceMode: other.referenceMode, ... }`, and the schema's optional
 * keys refuse an explicit `undefined`.
 */
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

export function decodeObjectTypeConfig(
  config: unknown,
): Effect.Effect<ObjectType, ObjectTypeProblems, IdSource> {
  const input = withoutUndefined(withoutEmptyValueReferenceMode(config));
  return decodeWith(decodeModel, input);
}

/**
 * Decode a file's object types, each to its record or its problems. One
 * object type's problems do not stop the next from being decoded, so a file
 * reports everything wrong with all of them in one pass.
 */
export function decodeObjectTypes(
  docs: readonly unknown[],
): Effect.Effect<readonly Result.Result<ObjectType, ObjectTypeProblems>[], never, IdSource> {
  return Effect.forEach(docs, (doc) => Effect.result(decodeObjectType(doc)));
}

/**
 * Run a decode that cannot fail, with ids from `newId`. For the synchronous
 * boundaries; the decoder itself never runs anything.
 */
export function runWithIds<A>(effect: Effect.Effect<A, never, IdSource>, newId: () => string): A {
  return Effect.runSync(Effect.provideService(effect, IdSourceKey, { newId }));
}

/**
 * Run one decode with ids from `newId`, returning the record or throwing
 * every problem at once as an `ObjectTypeError`.
 */
export function runObjectTypeDecode(
  decoded: Effect.Effect<ObjectType, ObjectTypeProblems, IdSource>,
  newId: () => string,
): ObjectType {
  const result = runWithIds(Effect.result(decoded), newId);
  if (Result.isFailure(result)) throw new ObjectTypeError(result.failure.problems);
  return result.success;
}

function decodeWith(
  decode: (input: unknown) => Effect.Effect<ObjectType, Schema.SchemaError, IdSource>,
  input: unknown,
): Effect.Effect<ObjectType, ObjectTypeProblems, IdSource> {
  return decode(input).pipe(
    Effect.map(seal),
    Effect.mapError((error) => new ObjectTypeProblems(problemsOf(error.issue, input))),
  );
}

/** Frozen, as `createObjectType` always returned it: a record is a value. */
function seal(ot: ObjectType): ObjectType {
  return Object.freeze({ ...ot, aliases: Object.freeze([...ot.aliases]) });
}

// -- Issues to problems -----------------------------------------------------

/** One failure in the issue tree, with the path that leads to it. */
interface Located {
  readonly path: readonly PropertyKey[];
  readonly issue: SchemaIssue.Issue;
}

/**
 * The failures in an issue tree, one per problem.
 *
 * A union is descended only when one member was tried: that is the
 * discriminated object-type union picking its variant by `kind`, and the
 * problems are that variant's. A union none of whose members applied, or
 * several, is one problem at its own position -- `max: "lots"` is one bad
 * value, not one per member it failed to match.
 */
function locate(issue: SchemaIssue.Issue, path: readonly PropertyKey[]): Located[] {
  switch (issue._tag) {
    case "Pointer":
      return locate(issue.issue, [...path, ...issue.path]);
    case "Composite":
      return issue.issues.flatMap((child) => locate(child, path));
    case "Encoding":
      return locate(issue.issue, path);
    case "AnyOf":
      return issue.issues.length === 1 ? locate(issue.issues[0]!, path) : [{ path, issue }];
    default:
      return [{ path, issue }];
  }
}

function problemsOf(
  issue: SchemaIssue.Issue,
  raw: unknown,
): [ObjectTypeProblem, ...ObjectTypeProblem[]] {
  const subject = subjectOf(raw);
  const located = locate(issue, []);
  const problems = located.map(({ path: decodedPath, issue: leaf }) => {
    const path = spelledAs(raw, decodedPath);
    const field = path.length > 0 ? String(path[0]) : "kind";
    return {
      objectType: subject.identity,
      field,
      message: `${subject.label} ${predicateOf(leaf, path)}`,
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
 * A path in the spelling of the input it points into.
 *
 * Effect reports a check on a decoded struct at the decoded key, so a file's
 * empty value constraint comes back at `valueConstraint` -- a key the file
 * does not have. Each segment the input lacks is replaced by its file
 * spelling when the input has that instead; an unknown key the input does
 * have, even a camelCase one, is left as written.
 */
function spelledAs(raw: unknown, path: readonly PropertyKey[]): PropertyKey[] {
  const spelled: PropertyKey[] = [];
  let node = raw;
  for (const segment of path) {
    let key = segment;
    if (node !== null && typeof node === "object") {
      const record = node as Record<PropertyKey, unknown>;
      if (typeof segment === "string" && !(segment in record)) {
        const fileKey = FILE_SPELLING[segment];
        if (fileKey !== undefined && fileKey in record) key = fileKey;
      }
      node = record[key];
    } else {
      node = undefined;
    }
    spelled.push(key);
  }
  return spelled;
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

const defaultFormat = SchemaIssue.makeFormatterDefault();

/**
 * The rest of the sentence after the subject.
 *
 * Every rule the schema states carries its own predicate as a `message`
 * annotation; those are used as they are. What is left is Effect's own
 * structural refusals -- a wrong type, a missing key, an unknown key -- which
 * are phrased here around the path, because Effect's text names neither the
 * object type nor, for a key, the field.
 */
function predicateOf(issue: SchemaIssue.Issue, path: readonly PropertyKey[]): string {
  const at = path.map(String).join(".");
  switch (issue._tag) {
    case "UnexpectedKey":
      return `has an unknown field "${at}".`;
    case "MissingKey":
      return issue.annotations?.messageMissingKey ?? `is missing "${at}".`;
    case "AnyOf": {
      if (path.length === 0) return `must have kind "entity" or "value".`;
      const message = issue.ast.annotations?.message;
      if (typeof message === "string") return message;
      break;
    }
    case "Filter": {
      const message = issue.filter.annotations?.message;
      if (typeof message === "string") return message;
      break;
    }
    case "InvalidType":
    case "InvalidValue": {
      const message = issue._tag === "InvalidType"
        ? issue.ast.annotations?.message
        : issue.annotations?.message;
      if (typeof message === "string") return message;
      break;
    }
  }
  return `has an invalid ${at}: ${defaultFormat(issue)}.`;
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
