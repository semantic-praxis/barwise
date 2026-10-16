/**
 * Decoding a file's fact types, each to its record or to every problem with
 * it, each problem naming the fact type and the field (S4 of
 * effect-adoption.spec.md). A fact type's constraints are not decoded here;
 * `constraintDecoder.ts` takes them one by one.
 */
import * as Effect from "effect/Effect";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";
import type * as SchemaAST from "effect/SchemaAST";
import { type FactTypeRecord, FactTypeYamlCodec } from "./factTypeSchema.js";
import { locate, predicateOf } from "./schemaIssues.js";

/** One thing wrong with one fact type. */
export interface FactTypeProblem {
  /** The field at fault as a path below the fact type, in the file's spelling. */
  readonly path: readonly PropertyKey[];
  /** A sentence naming the fact type and the field. */
  readonly message: string;
}

/** Everything wrong with one fact type, and what the messages call it. */
export interface FactTypeFailure {
  readonly subject: string;
  readonly problems: readonly FactTypeProblem[];
}

const FILE_OPTIONS: SchemaAST.ParseOptions = { errors: "all", onExcessProperty: "error" };
const decodeFile = Schema.decodeUnknownEffect(FactTypeYamlCodec, FILE_OPTIONS);

/**
 * What a problem calls a fact type: by its name, its id when the name is
 * missing or blank, or its position. Also the fact type part of a
 * constraint's subject, so the two read alike.
 */
export function factTypeLabel(ft: unknown, index: number): string {
  const { name, id } = (ft !== null && typeof ft === "object" ? ft : {}) as {
    name?: unknown;
    id?: unknown;
  };
  if (typeof name === "string" && name.trim() !== "") return `Fact type "${name.trim()}"`;
  if (typeof id === "string" && id !== "") return `Fact type with id "${id}"`;
  return `Fact type at fact_types/${index}`;
}

/**
 * Decode a file's fact types. One fact type's problems do not stop the next
 * from being decoded, so a file reports everything wrong with all of them.
 */
export function decodeFactTypes(
  docs: readonly unknown[],
): Effect.Effect<readonly Result.Result<FactTypeRecord, FactTypeFailure>[]> {
  return Effect.forEach(docs, (doc, index) => {
    const subject = factTypeLabel(doc, index);
    if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
      return Effect.succeed(
        Result.fail({
          subject,
          problems: [{ path: [], message: `${subject} must be a mapping.` }],
        }),
      );
    }
    return Effect.result(
      decodeFile(doc).pipe(
        Effect.map((record) => record as FactTypeRecord),
        Effect.mapError((error): FactTypeFailure => ({
          subject,
          problems: locate(error.issue).map(({ path, issue }) => ({
            path,
            message: `${subject} ${predicateOf(issue, path, "is not a fact type.")}`,
          })),
        })),
      ),
    );
  });
}
